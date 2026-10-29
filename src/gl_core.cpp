// gl_core.cpp — EGL setup on Wayland. We run a GLES2 context: Cubism's Linux
// shader sources are patched to GLSL ES 1.00 for this target (see
// scripts/patch-cubism.sh, CSM_TARGET_LINUX_GLES2), and the GLES2 renderer's
// client-side vertex arrays are legal on ES2 (they were removed in ES3).
#include "gl_core.hpp"
#include "app.hpp"
#include "common.hpp"

#include <EGL/eglext.h>
#include <wayland-egl.h>
#include <cstring>

#ifndef EGL_PLATFORM_WAYLAND_EXT
#define EGL_PLATFORM_WAYLAND_EXT 0x31E8
#endif

bool GlCore::init(void *wl_display) {
    auto get_pd = (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
    if (!get_pd) { LOGE("eglGetPlatformDisplayEXT unavailable"); return false; }
    dpy_ = get_pd(EGL_PLATFORM_WAYLAND_EXT, wl_display, NULL);
    if (dpy_ == EGL_NO_DISPLAY || !eglInitialize(dpy_, nullptr, nullptr)) {
        LOGE("eglInitialize failed"); return false;
    }
    eglBindAPI(EGL_OPENGL_ES_API);

    EGLint attr[] = {EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
                     EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
                     EGL_RENDERABLE_TYPE, (EGLint)EGL_OPENGL_ES2_BIT,
                     EGL_NONE};
    EGLConfig c; EGLint n = 0;
    if (!eglChooseConfig(dpy_, attr, &c, 1, &n) || n != 1) {
        LOGE("no GLES2 EGL config");
        return false;
    }
    cfg_ = c;

    EGLint cattr[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
    ctx_ = eglCreateContext(dpy_, cfg_, EGL_NO_CONTEXT, cattr);
    if (ctx_ == EGL_NO_CONTEXT) {
        LOGE("GLES2 context failed (0x%x)", eglGetError());
        return false;
    }
    LOGI("egl: GLES2 context (%s)", eglQueryString(dpy_, EGL_VENDOR));

    const char *exts = eglQueryString(dpy_, EGL_EXTENSIONS);
    have_swap_damage_ = strstr(exts, "EGL_KHR_swap_buffers_with_damage") ||
                        strstr(exts, "EGL_EXT_swap_buffers_with_damage");
    have_buffer_age_ = strstr(exts, "EGL_EXT_buffer_age");
    LOGI("egl: swap_buffers_with_damage=%d buffer_age=%d", have_swap_damage_, have_buffer_age_);
    return true;
}

bool GlCore::add_output(OutputState &o) {
    o.egl_window = wl_egl_window_create(o.surface, o.width, o.height);
    if (!o.egl_window) { LOGE("wl_egl_window_create failed for output %s", o.name.c_str()); return false; }
    o.egl_surface = eglCreateWindowSurface(dpy_, cfg_, (EGLNativeWindowType)o.egl_window, nullptr);
    if (o.egl_surface == EGL_NO_SURFACE) {
        LOGE("eglCreateWindowSurface failed for output %s", o.name.c_str());
        return false;
    }
    return true;
}

void GlCore::make_current(OutputState &o) {
    if (o.egl_surface)
        eglMakeCurrent(dpy_, o.egl_surface, o.egl_surface, ctx_);
}

void GlCore::swap_with_damage(OutputState &o, const Rect &dmg) {
    if (!o.egl_surface) return;
    EGLBoolean ok;
    if (have_swap_damage_ && !dmg.empty()) {
        // EGL damage rects: bottom-left origin (y flip vs wayland buffer coords)
        EGLint er[4] = {dmg.x, o.height - (dmg.y + dmg.h), dmg.w, dmg.h};
        auto fn = (PFNEGLSWAPBUFFERSWITHDAMAGEKHRPROC)eglGetProcAddress("eglSwapBuffersWithDamageKHR");
        ok = fn(dpy_, o.egl_surface, er, 1);
    } else {
        ok = eglSwapBuffers(dpy_, o.egl_surface);
    }
    if (ok != EGL_TRUE) {
        static int err_logged = 0;
        if (err_logged++ < 5)
            LOGE("swap failed: egl error 0x%x dmg=%d,%d %dx%d", eglGetError(),
                 dmg.x, dmg.y, dmg.w, dmg.h);
    }
}
