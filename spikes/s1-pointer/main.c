/* mizu-s1 — Spike S1+S2 for mizu-l2d.
 *
 * S1: does niri deliver pointer enter/motion/button to a BACKGROUND-layer
 *     layer-shell surface with a full input region? (one surface per output)
 * S2: can we get a GLES3 (fallback GLES2) EGL context on a Wayland layer
 *     surface, and are the damage extensions present?
 *
 * Renders a navy background with a small moving accent disc per output,
 * driven by frame callbacks, using swap_buffers_with_damage +
 * wl_surface.damage_buffer. Prints verdict lines (S1_* and S2_*).
 * Exits after --secs (default 12).
 */
#define _GNU_SOURCE
#include <errno.h>
#include <math.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include <wayland-client.h>
#include <wayland-egl.h>

#include "zwlr-layer-shell-unstable-v1-client-protocol.h"
#include "wlr-virtual-pointer-unstable-v1-client-protocol.h"

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>

#ifndef EGL_PLATFORM_WAYLAND_EXT
#define EGL_PLATFORM_WAYLAND_EXT 0x31E8
#endif

#define MAX_OUTS 8

struct Out {
    struct wl_output *wl;
    struct wl_surface *surf;
    struct zwlr_layer_surface_v1 *ls;
    struct wl_egl_window *win;
    EGLSurface esurf;
    struct wl_callback *cb;
    char name[64];
    int w, h, scale, configured, acked;
    int prev_bbox[4]; /* buffer coords, top-left origin; x<0 = unset */
    unsigned frames;
};

static struct wl_display *disp;
static struct wl_compositor *compositor;
static struct wl_seat *seat;
static struct wl_pointer *pointer;
static struct zwlr_layer_shell_v1 *shell;
static struct zwlr_virtual_pointer_manager_v1 *vpm;
static struct zwlr_virtual_pointer_v1 *vp;
static enum zwlr_layer_shell_v1_layer layer = ZWLR_LAYER_SHELL_V1_LAYER_BACKGROUND;
static struct Out outs[MAX_OUTS];
static int n_out;

static unsigned n_enter, n_motion, n_button;
static double frame_ms[512];
static unsigned frame_ms_n;

static volatile sig_atomic_t running = 1;
static double secs = 12.0;

static EGLDisplay edpy(void); /* defined after EGL setup */

static double now_s(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec / 1e9;
}
static void on_sigint(int sig) { (void)sig; running = 0; }

/* ------------------------------------------------------------------ GLES2 */

static GLuint prog_bg, prog_disc, vbo;

static GLint make_prog(const char *vs, const char *fs) {
    GLint c = glCreateShader(GL_VERTEX_SHADER);
    glShaderSource(c, 1, &vs, NULL);
    glCompileShader(c);
    GLint f = glCreateShader(GL_FRAGMENT_SHADER);
    glShaderSource(f, 1, &fs, NULL);
    glCompileShader(f);
    GLint p = glCreateProgram();
    glAttachShader(p, c);
    glAttachShader(p, f);
    glLinkProgram(p);
    return p;
}

static void gl_init(void) {
    const char *vs =
        "attribute vec2 a_pos;"
        "uniform vec2 u_center, u_half;"
        "varying vec2 v_uv;"
        "void main(){ v_uv = a_pos * 0.5 + 0.5;"
        " gl_Position = vec4(u_center + a_pos * u_half, 0.0, 1.0); }";
    const char *fs_bg =
        "precision mediump float;"
        "varying vec2 v_uv;"
        "uniform vec3 u_col1, u_col2;"
        "void main(){ gl_FragColor = vec4(mix(u_col1, u_col2, v_uv.y), 1.0); }";
    const char *fs_disc =
        "precision mediump float;"
        "varying vec2 v_uv;"
        "uniform vec3 u_color;"
        "void main(){ float d = length(v_uv * 2.0 - 1.0);"
        " float a = smoothstep(1.0, 0.90, d);"
        " gl_FragColor = vec4(u_color, a); }";

    prog_bg = make_prog(vs, fs_bg);
    prog_disc = make_prog(vs, fs_disc);

    static const float quad[8] = {-1, -1, 1, -1, -1, 1, 1, 1};
    glGenBuffers(1, &vbo);
    glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(quad), quad, GL_STATIC_DRAW);
}

static void disc_rect(int w, int h, double t, double *cx, double *cy, double *r) {
    *r = fmin(w, h) * 0.055;
    *cx = w * (0.5 + 0.20 * sin(t * 2.0 * M_PI / 6.0));
    *cy = h * (0.5 + 0.008 * sin(t * 2.0 * M_PI / 2.5));
}

static void draw_out(struct Out *o, double t) {
    double cx, cy, r;
    disc_rect(o->w, o->h, t, &cx, &cy, &r);
    glViewport(0, 0, o->w, o->h);

    glUseProgram(prog_bg);
    glBindBuffer(GL_ARRAY_BUFFER, vbo);
    GLint ap = glGetAttribLocation(prog_bg, "a_pos");
    glEnableVertexAttribArray(ap);
    glVertexAttribPointer(ap, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glUniform2f(glGetUniformLocation(prog_bg, "u_center"), 0, 0);
    glUniform2f(glGetUniformLocation(prog_bg, "u_half"), 1, 1);
    glUniform3f(glGetUniformLocation(prog_bg, "u_col1"), 0.043, 0.106, 0.200);
    glUniform3f(glGetUniformLocation(prog_bg, "u_col2"), 0.016, 0.043, 0.090);
    glDisable(GL_BLEND);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);

    glUseProgram(prog_disc);
    ap = glGetAttribLocation(prog_disc, "a_pos");
    glEnableVertexAttribArray(ap);
    glVertexAttribPointer(ap, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glUniform2f(glGetUniformLocation(prog_disc, "u_center"),
                (float)(2.0 * cx / o->w - 1.0), (float)(1.0 - 2.0 * cy / o->h));
    glUniform2f(glGetUniformLocation(prog_disc, "u_half"),
                (float)(2 * r / o->w), (float)(2 * r / o->h));
    glUniform3f(glGetUniformLocation(prog_disc, "u_color"), 0.831, 0.690, 0.416);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);

    /* damage = old ∪ new disc bbox (buffer coords, top-left origin), inflated.
     * EGL damage rects use bottom-left origin -> y flip when swapping. */
    int pad = 12;
    int bx = (int)(cx - r) - pad, by = (int)(cy - r) - pad;
    int bw = (int)(2 * r) + 2 * pad, bh = (int)(2 * r) + 2 * pad;
    int dmg[4];
    if (o->prev_bbox[0] < 0) {
        dmg[0] = 0; dmg[1] = 0; dmg[2] = o->w; dmg[3] = o->h;
    } else {
        int x0 = o->prev_bbox[0] < bx ? o->prev_bbox[0] : bx;
        int y0 = o->prev_bbox[1] < by ? o->prev_bbox[1] : by;
        int x1 = o->prev_bbox[0] + o->prev_bbox[2] > bx + bw ? o->prev_bbox[0] + o->prev_bbox[2] : bx + bw;
        int y1 = o->prev_bbox[1] + o->prev_bbox[3] > by + bh ? o->prev_bbox[1] + o->prev_bbox[3] : by + bh;
        dmg[0] = x0; dmg[1] = y0; dmg[2] = x1 - x0; dmg[3] = y1 - y0;
    }
    o->prev_bbox[0] = bx; o->prev_bbox[1] = by; o->prev_bbox[2] = bw; o->prev_bbox[3] = bh;
    if (dmg[0] < 0) { dmg[2] += dmg[0]; dmg[0] = 0; }
    if (dmg[1] < 0) { dmg[3] += dmg[1]; dmg[1] = 0; }
    if (dmg[0] + dmg[2] > o->w) dmg[2] = o->w - dmg[0];
    if (dmg[1] + dmg[3] > o->h) dmg[3] = o->h - dmg[1];

    wl_surface_damage_buffer(o->surf, dmg[0], dmg[1], dmg[2], dmg[3]);

    PFNEGLSWAPBUFFERSWITHDAMAGEKHRPROC swap_dmg =
        (PFNEGLSWAPBUFFERSWITHDAMAGEKHRPROC)eglGetProcAddress("eglSwapBuffersWithDamageKHR");
    if (swap_dmg) {
        EGLint er[4] = {dmg[0], o->h - (dmg[1] + dmg[3]), dmg[2], dmg[3]};
        swap_dmg(edpy(), o->esurf, er, 1);
    } else {
        eglSwapBuffers(edpy(), o->esurf);
    }
    o->frames++;
}

/* ---------------------------------------------------------------- wayland */

static void ptr_enter(void *d, struct wl_pointer *p, uint32_t serial, struct wl_surface *s,
                      wl_fixed_t sx, wl_fixed_t sy) {
    (void)d; (void)p; (void)serial; (void)sx; (void)sy;
    n_enter++;
    for (int i = 0; i < n_out; i++)
        if (outs[i].surf == s) fprintf(stderr, "S1 pointer enter on output %s\n", outs[i].name);
}
static void ptr_leave(void *d, struct wl_pointer *p, uint32_t serial, struct wl_surface *s) {
    (void)d; (void)p; (void)serial; (void)s;
}
static void ptr_motion(void *d, struct wl_pointer *p, uint32_t time, wl_fixed_t sx, wl_fixed_t sy) {
    (void)d; (void)p; (void)time;
    n_motion++;
    if (n_motion % 64 == 1)
        fprintf(stderr, "S1 pointer motion %u at %.1f,%.1f\n", n_motion,
                wl_fixed_to_double(sx), wl_fixed_to_double(sy));
}
static void ptr_button(void *d, struct wl_pointer *p, uint32_t serial, uint32_t time,
                       uint32_t btn, uint32_t state) {
    (void)d; (void)p; (void)serial; (void)time;
    n_button++;
    fprintf(stderr, "S1 pointer button %u state %u\n", btn, state);
}
static void ptr_axis(void *d, struct wl_pointer *p, uint32_t time, uint32_t axis, wl_fixed_t v) {
    (void)d; (void)p; (void)time; (void)axis; (void)v;
}
static void ptr_frame(void *d, struct wl_pointer *p) { (void)d; (void)p; }
static void ptr_axis_src(void *d, struct wl_pointer *p, uint32_t s) { (void)d; (void)p; (void)s; }
static void ptr_axis_stop(void *d, struct wl_pointer *p, uint32_t t, uint32_t a) {
    (void)d; (void)p; (void)t; (void)a;
}
static void ptr_axis_disc(void *d, struct wl_pointer *p, uint32_t a, int32_t v) {
    (void)d; (void)p; (void)a; (void)v;
}
static const struct wl_pointer_listener ptr_listener = {
    .enter = ptr_enter, .leave = ptr_leave, .motion = ptr_motion, .button = ptr_button,
    .axis = ptr_axis, .frame = ptr_frame, .axis_source = ptr_axis_src,
    .axis_stop = ptr_axis_stop, .axis_discrete = ptr_axis_disc,
};

static void seat_caps(void *d, struct wl_seat *s, uint32_t caps) {
    (void)d;
    if ((caps & WL_SEAT_CAPABILITY_POINTER) && !pointer) {
        pointer = wl_seat_get_pointer(s);
        wl_pointer_add_listener(pointer, &ptr_listener, NULL);
    }
}
static void seat_name(void *d, struct wl_seat *s, const char *name) { (void)d; (void)s; (void)name; }
static const struct wl_seat_listener seat_listener = {.capabilities = seat_caps, .name = seat_name};

static void out_geom(void *d, struct wl_output *o, int32_t x, int32_t y, int32_t pw, int32_t ph,
                     int32_t sub, const char *mk, const char *mdl, int32_t transform) {
    (void)d; (void)o; (void)x; (void)y; (void)pw; (void)ph; (void)sub; (void)mk; (void)mdl; (void)transform;
}
static void out_mode(void *d, struct wl_output *o, uint32_t f, int32_t w, int32_t h, int32_t ref) {
    (void)d; (void)o; (void)f; (void)w; (void)h; (void)ref;
}
static void out_done(void *d, struct wl_output *o) { (void)d; (void)o; }
static void out_scale(void *d, struct wl_output *o, int32_t s) { (void)d; (void)o; (void)s; }
static void out_name(void *d, struct wl_output *o, const char *name) {
    struct Out *out = d; (void)o;
    snprintf(out->name, sizeof(out->name), "%s", name);
}
static void out_desc(void *d, struct wl_output *o, const char *desc) { (void)d; (void)o; (void)desc; }
static const struct wl_output_listener out_listener = {
    .geometry = out_geom, .mode = out_mode, .done = out_done, .scale = out_scale, .name = out_name,
    .description = out_desc,
};

static void reg_global(void *d, struct wl_registry *r, uint32_t name,
                       const char *iface, uint32_t ver) {
    (void)d;
    if (!strcmp(iface, wl_compositor_interface.name)) {
        compositor = wl_registry_bind(r, name, &wl_compositor_interface, ver < 5 ? ver : 5);
    } else if (!strcmp(iface, wl_seat_interface.name)) {
        seat = wl_registry_bind(r, name, &wl_seat_interface, ver < 7 ? ver : 7);
        /* attach here: the capabilities event is dispatched on the very next
         * roundtrip, before any later listener attach would see it */
        wl_seat_add_listener(seat, &seat_listener, NULL);
    } else if (!strcmp(iface, zwlr_layer_shell_v1_interface.name)) {
        shell = wl_registry_bind(r, name, &zwlr_layer_shell_v1_interface, ver < 5 ? ver : 5);
    } else if (!strcmp(iface, zwlr_virtual_pointer_manager_v1_interface.name)) {
        vpm = wl_registry_bind(r, name, &zwlr_virtual_pointer_manager_v1_interface, ver < 2 ? ver : 2);
    } else if (!strcmp(iface, wl_output_interface.name) && n_out < MAX_OUTS) {
        struct Out *o = &outs[n_out++];
        memset(o, 0, sizeof(*o));
        o->prev_bbox[0] = -1;
        o->wl = wl_registry_bind(r, name, &wl_output_interface, ver < 4 ? ver : 4);
        wl_output_add_listener(o->wl, &out_listener, o);
    }
}
static void reg_global_remove(void *d, struct wl_registry *r, uint32_t name) { (void)d; (void)r; (void)name; }

static const struct wl_registry_listener reg_listener = {
    .global = reg_global, .global_remove = reg_global_remove,
};

static void ls_configure(void *d, struct zwlr_layer_surface_v1 *ls, uint32_t serial,
                         uint32_t w, uint32_t h) {
    struct Out *o = d;
    o->w = (int)w; o->h = (int)h; o->configured = 1;
    zwlr_layer_surface_v1_ack_configure(ls, serial);
    o->acked = 1;
}
static void ls_closed(void *d, struct zwlr_layer_surface_v1 *ls) { (void)d; (void)ls; running = 0; }
static const struct zwlr_layer_surface_v1_listener ls_listener = {
    .configure = ls_configure, .closed = ls_closed,
};

static void cb_done(void *d, struct wl_callback *c, uint32_t ms) {
    struct Out *o = d;
    (void)ms;
    wl_callback_destroy(c);
    o->cb = NULL;
    if (frame_ms_n < sizeof(frame_ms) / sizeof(frame_ms[0])) {
        static double last = 0;
        double now = now_s();
        if (last > 0) frame_ms[frame_ms_n++] = (now - last) * 1000.0;
        last = now;
    }
}
static const struct wl_callback_listener cb_listener = {.done = cb_done};

static EGLDisplay g_edpy;
static EGLContext g_ctx;
static EGLDisplay edpy(void) { return g_edpy; }

/* sweep the cursor in small steps over time via wlr virtual pointer —
 * spreading events lets the compositor evaluate surface crossings per step */
static void sweep_cursor(int dir) {
    if (!vp) return;
    for (int i = 0; i < 200; i++) {
        zwlr_virtual_pointer_v1_motion(vp, (uint32_t)(now_s() * 1000.0),
                                       wl_fixed_from_int(dir * 20),
                                       wl_fixed_from_int((i % 2) ? 5 : -5));
        wl_display_flush(disp);
        usleep(15000);
    }
}

static int cmp_dbl(const void *a, const void *b) {
    double x = *(const double *)a, y = *(const double *)b;
    return x < y ? -1 : x > y ? 1 : 0;
}

int main(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--secs") && i + 1 < argc) secs = atof(argv[++i]);
        else if (!strcmp(argv[i], "--layer") && i + 1 < argc) {
            i++;
            if (!strcmp(argv[i], "bottom")) layer = ZWLR_LAYER_SHELL_V1_LAYER_BOTTOM;
            else layer = ZWLR_LAYER_SHELL_V1_LAYER_BACKGROUND;
        }
    }

    signal(SIGINT, on_sigint);
    setvbuf(stdout, NULL, _IOLBF, 0);

    disp = wl_display_connect(NULL);
    if (!disp) { fprintf(stderr, "no wayland display\n"); return 1; }
    struct wl_registry *reg = wl_display_get_registry(disp);
    static const struct wl_registry_listener reg_listener = {
        .global = reg_global, .global_remove = reg_global_remove};
    wl_registry_add_listener(reg, &reg_listener, NULL);
    wl_display_roundtrip(disp);
    wl_display_roundtrip(disp);
    if (!compositor || !shell || !seat || n_out == 0) {
        fprintf(stderr, "missing globals (compositor=%p shell=%p seat=%p outputs=%d)\n",
                (void *)compositor, (void *)shell, (void *)seat, n_out);
        return 1;
    }
    if (!pointer) fprintf(stderr, "warning: no pointer capability\n");
    wl_display_roundtrip(disp);
    printf("S1_OUTS n=%d\n", n_out);

    /* create layer surfaces for every output */
    for (int i = 0; i < n_out; i++) {
        struct Out *o = &outs[i];
        o->surf = wl_compositor_create_surface(compositor);
        o->ls = zwlr_layer_shell_v1_get_layer_surface(shell, o->surf, o->wl, layer, "mizu-s1");
        zwlr_layer_surface_v1_set_anchor(o->ls, ZWLR_LAYER_SURFACE_V1_ANCHOR_TOP |
                                               ZWLR_LAYER_SURFACE_V1_ANCHOR_BOTTOM |
                                               ZWLR_LAYER_SURFACE_V1_ANCHOR_LEFT |
                                               ZWLR_LAYER_SURFACE_V1_ANCHOR_RIGHT);
        zwlr_layer_surface_v1_set_exclusive_zone(o->ls, -1);
        zwlr_layer_surface_v1_add_listener(o->ls, &ls_listener, o);
        wl_surface_commit(o->surf);
    }
    wl_display_roundtrip(disp);
    for (int i = 0; i < n_out; i++) {
        if (!outs[i].configured) { fprintf(stderr, "output %d: no configure\n", i); return 1; }
        printf("S1_LAYER output=%s layer=%s size=%dx%d acked=%d\n",
               outs[i].name[0] ? outs[i].name : "?",
               layer == ZWLR_LAYER_SHELL_V1_LAYER_BOTTOM ? "bottom" : "background",
               outs[i].w, outs[i].h, outs[i].acked);
    }

    /* ---- S2: EGL ---- */
    PFNEGLGETPLATFORMDISPLAYEXTPROC get_pd =
        (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
    if (!get_pd) { fprintf(stderr, "no eglGetPlatformDisplayEXT\n"); return 1; }
    g_edpy = get_pd(EGL_PLATFORM_WAYLAND_EXT, disp, NULL);
    eglInitialize(g_edpy, NULL, NULL);
    eglBindAPI(EGL_OPENGL_ES_API);

    EGLConfig cfg = 0;
    for (int es3 = 1; es3 >= 0 && !cfg; es3--) {
        EGLint attr[] = {
            EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
            EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
            EGL_RENDERABLE_TYPE, es3 ? EGL_OPENGL_ES3_BIT : EGL_OPENGL_ES2_BIT,
            EGL_NONE};
        EGLConfig c; EGLint n = 0;
        if (eglChooseConfig(g_edpy, attr, &c, 1, &n) && n == 1) cfg = c;
    }
    if (!cfg) { fprintf(stderr, "no EGL config\n"); return 1; }

    EGLint a3[] = {EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE};
    g_ctx = eglCreateContext(g_edpy, cfg, EGL_NO_CONTEXT, a3);
    if (g_ctx == EGL_NO_CONTEXT) {
        EGLint a2[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
        g_ctx = eglCreateContext(g_edpy, cfg, EGL_NO_CONTEXT, a2);
        printf("S2_EGL es3_context=no (fell back to GLES2)\n");
    } else {
        printf("S2_EGL es3_context=yes\n");
    }

    const char *exts = eglQueryString(g_edpy, EGL_EXTENSIONS);
    int have_swap_dmg = !!strstr(exts, "EGL_KHR_swap_buffers_with_damage") ||
                        !!strstr(exts, "EGL_EXT_swap_buffers_with_damage");
    int have_buffer_age = !!strstr(exts, "EGL_EXT_buffer_age");
    printf("S2_EXT swap_buffers_with_damage=%d buffer_age=%d\n", have_swap_dmg, have_buffer_age);

    for (int i = 0; i < n_out; i++) {
        struct Out *o = &outs[i];
        o->win = wl_egl_window_create(o->surf, o->w, o->h);
        o->esurf = eglCreateWindowSurface(g_edpy, cfg, (EGLNativeWindowType)o->win, NULL);
    }
    if (eglMakeCurrent(g_edpy, outs[0].esurf, outs[0].esurf, g_ctx) != EGL_TRUE) {
        fprintf(stderr, "eglMakeCurrent failed\n"); return 1;
    }
    printf("S2_EGL vendor=%s renderer=%s version=%s\n",
           eglQueryString(g_edpy, EGL_VENDOR), glGetString(GL_RENDERER), glGetString(GL_VERSION));
    printf("S2_RESULT PASS (EGL context on layer surface works)\n");

    gl_init();
    if (vpm && seat) {
        vp = zwlr_virtual_pointer_manager_v1_create_virtual_pointer(vpm, seat);
        fprintf(stderr, "S1 virtual pointer: available (will sweep cursor)\n");
    } else {
        fprintf(stderr, "S1 virtual pointer: not available\n");
    }
    fprintf(stderr, ">>> move the cursor over the desktop background now\n");

    /* ---- main loop: request the frame callback and commit it in the same
     * cycle (draw+swap commits it); it then fires on the next vsync. ---- */
    double t0 = now_s(), last_report = t0;
    int swept[4] = {0, 0, 0, 0};
    int dfd = wl_display_get_fd(disp);
    while (running && now_s() - t0 < secs) {
        while (wl_display_prepare_read(disp) != 0) wl_display_dispatch_pending(disp);
        wl_display_flush(disp);
        double remain = t0 + secs - now_s();
        struct pollfd pfd = {.fd = dfd, .events = POLLIN};
        int pr = poll(&pfd, 1, remain > 0 ? (int)(remain * 1000) : 0);
        if (pr > 0 && (pfd.revents & POLLIN)) wl_display_read_events(disp);
        else wl_display_cancel_read(disp);
        wl_display_dispatch_pending(disp);

        /* scripted cursor sweeps to make the S1 test deterministic */
        double t = now_s() - t0;
        if (vp) {
            if (!swept[0] && t > 1.5) { swept[0] = 1; sweep_cursor(+1); }
            if (!swept[1] && t > 5.0) { swept[1] = 1; sweep_cursor(-1); }
            if (!swept[2] && t > 9.0) { swept[2] = 1; sweep_cursor(+1); }
            if (!swept[3] && t > 13.0) { swept[3] = 1; sweep_cursor(-1); }
        }

        for (int i = 0; i < n_out; i++)
            if (!outs[i].cb) { /* callback fired (or first frame) -> render */
                outs[i].cb = wl_surface_frame(outs[i].surf);
                wl_callback_add_listener(outs[i].cb, &cb_listener, &outs[i]);
                eglMakeCurrent(g_edpy, outs[i].esurf, outs[i].esurf, g_ctx);
                draw_out(&outs[i], now_s() - t0);
            }
        if (now_s() - last_report > 3.0) {
            fprintf(stderr, "S1 tick: enter=%u motion=%u button=%u\n", n_enter, n_motion, n_button);
            last_report = now_s();
        }
    }

    qsort(frame_ms, frame_ms_n, sizeof(double), cmp_dbl);
    double avg = 0;
    for (unsigned i = 0; i < frame_ms_n; i++) avg += frame_ms[i];
    avg = frame_ms_n ? avg / frame_ms_n : 0;
    printf("S1_FRAMES drawn=%u avg_ms=%.2f p95_ms=%.2f (callbacks = vsync alive)\n",
           frame_ms_n, avg, frame_ms_n ? frame_ms[(int)(frame_ms_n * 0.95)] : 0);
    printf("S1_POINTER enter=%u motion=%u button=%u\n", n_enter, n_motion, n_button);
    printf("S1_RESULT %s\n", n_enter > 0 ? "PASS: input reaches background layer"
                                          : "INCONCLUSIVE: no pointer over exposed background");
    return 0;
}
