// app.cpp — Wayland implementation.
//
// Ordering rule learned the hard way in the spike: protocol event listeners
// are attached immediately at bind time, because the first dispatch roundtrip
// delivers events (seat capabilities, output name) that a later attach would
// never see.
#include "app.hpp"
#include "common.hpp"

#include <poll.h>
#include <unistd.h>
#include <cstring>

// The generated header names a get_layer_surface parameter `namespace`, which
// is a C++ keyword. Rename it for the duration of the include; wayland-client
// headers pulled in by it are C-only, so nothing else is affected.
#define namespace surface_namespace
#include "zwlr-layer-shell-unstable-v1-client-protocol.h"
#undef namespace

// ------------------------------------------------------------------ outputs

static void out_name(void *d, struct wl_output *, const char *name) {
    static_cast<OutputState *>(d)->name = name;
}
static void out_geom(void *, struct wl_output *, int32_t, int32_t, int32_t, int32_t,
                     int32_t, const char *, const char *, int32_t) {}
static void out_mode(void *d, struct wl_output *, uint32_t flags, int32_t w, int32_t h, int32_t) {
    auto *o = static_cast<OutputState *>(d);
    if (flags & WL_OUTPUT_MODE_CURRENT) { o->width = w; o->height = h; }
}
static void out_done(void *, struct wl_output *) {}
static void out_scale(void *d, struct wl_output *, int32_t s) {
    static_cast<OutputState *>(d)->scale = s;
}
static void out_desc(void *, struct wl_output *, const char *) {}

static const struct wl_output_listener out_listener = {
    .geometry = out_geom, .mode = out_mode, .done = out_done, .scale = out_scale,
    .name = out_name, .description = out_desc,
};

// ------------------------------------------------------------ layer surface

static void ls_configure(void *d, struct zwlr_layer_surface_v1 *ls, uint32_t serial,
                         uint32_t w, uint32_t h) {
    auto *o = static_cast<OutputState *>(d);
    o->width = (int)w;
    o->height = (int)h;
    o->configured = true;
    o->frame_pending = true;
    zwlr_layer_surface_v1_ack_configure(ls, serial);
}
static void ls_closed(void *d, struct zwlr_layer_surface_v1 *ls) {
    (void)d; (void)ls;
    LOGW("layer surface closed by compositor");
}
static const struct zwlr_layer_surface_v1_listener ls_listener = {
    .configure = ls_configure, .closed = ls_closed,
};

// ------------------------------------------------------------------ pointer

static void ptr_enter(void *d, struct wl_pointer *, uint32_t, struct wl_surface *s,
                      wl_fixed_t sx, wl_fixed_t sy) {
    auto *app = static_cast<App *>(d);
    for (size_t i = 0; i < app->outputs.size(); i++)
        if (app->outputs[i].surface == s) {
            app->hover_output_ = i;
            app->dispatch_pointer({PointerEventKind::Enter, i,
                                   wl_fixed_to_double(sx), wl_fixed_to_double(sy)});
            return;
        }
}
static void ptr_leave(void *d, struct wl_pointer *, uint32_t, struct wl_surface *s) {
    auto *app = static_cast<App *>(d);
    for (size_t i = 0; i < app->outputs.size(); i++)
        if (app->outputs[i].surface == s) {
            app->dispatch_pointer({PointerEventKind::Leave, i, 0, 0});
            return;
        }
}
static void ptr_motion(void *d, struct wl_pointer *, uint32_t, wl_fixed_t sx, wl_fixed_t sy) {
    auto *app = static_cast<App *>(d);
    // motion events carry no surface; they belong to the last entered surface
    app->dispatch_pointer({PointerEventKind::Motion, app->hover_output(),
                           wl_fixed_to_double(sx), wl_fixed_to_double(sy)});
}
static void ptr_button(void *d, struct wl_pointer *, uint32_t, uint32_t, uint32_t btn,
                       uint32_t state) {
    auto *app = static_cast<App *>(d);
    app->dispatch_pointer({PointerEventKind::Button, app->hover_output(), 0, 0, btn, state});
}
static void ptr_axis(void *, struct wl_pointer *, uint32_t, uint32_t, wl_fixed_t) {}
static void ptr_frame(void *, struct wl_pointer *) {}
static void ptr_axis_src(void *, struct wl_pointer *, uint32_t) {}
static void ptr_axis_stop(void *, struct wl_pointer *, uint32_t, uint32_t) {}
static void ptr_axis_disc(void *, struct wl_pointer *, uint32_t, int32_t) {}
static void ptr_axis_value120(void *, struct wl_pointer *, uint32_t, int32_t) {}
static void ptr_axis_rel_dir(void *, struct wl_pointer *, uint32_t, uint32_t) {}
static void ptr_warp(void *, struct wl_pointer *, wl_fixed_t, wl_fixed_t) {}

static const struct wl_pointer_listener ptr_listener = {
    .enter = ptr_enter, .leave = ptr_leave, .motion = ptr_motion, .button = ptr_button,
    .axis = ptr_axis, .frame = ptr_frame, .axis_source = ptr_axis_src,
    .axis_stop = ptr_axis_stop, .axis_discrete = ptr_axis_disc,
    .axis_value120 = ptr_axis_value120, .axis_relative_direction = ptr_axis_rel_dir,
    .warp = ptr_warp,
};

static void seat_caps(void *d, struct wl_seat *s, uint32_t caps) {
    auto *app = static_cast<App *>(d);
    if ((caps & WL_SEAT_CAPABILITY_POINTER) && !app->pointer_) {
        app->pointer_ = wl_seat_get_pointer(s);
        wl_pointer_add_listener(app->pointer_, &ptr_listener, app);
    }
}
static void seat_name(void *, struct wl_seat *, const char *) {}
static const struct wl_seat_listener seat_listener = {.capabilities = seat_caps, .name = seat_name};

// ------------------------------------------------------------------ frames

static void cb_done(void *d, struct wl_callback *cb, uint32_t) {
    auto *o = static_cast<OutputState *>(d);
    wl_callback_destroy(cb);
    o->frame_cb = nullptr;
    o->frame_pending = true;
}
static const struct wl_callback_listener cb_listener = {.done = cb_done};

// ---------------------------------------------------------------- registry

void App::reg_global(void *data, struct wl_registry *r, uint32_t name,
                     const char *iface, uint32_t version) {
    auto *app = static_cast<App *>(data);
    if (!strcmp(iface, wl_compositor_interface.name)) {
        app->compositor_ = (struct wl_compositor *)wl_registry_bind(
            r, name, &wl_compositor_interface, version < 5 ? version : 5);
    } else if (!strcmp(iface, wl_seat_interface.name)) {
        app->seat_ = (struct wl_seat *)wl_registry_bind(r, name, &wl_seat_interface,
                                                        version < 7 ? version : 7);
        wl_seat_add_listener(app->seat_, &seat_listener, app);
    } else if (!strcmp(iface, zwlr_layer_shell_v1_interface.name)) {
        app->shell_ = (struct zwlr_layer_shell_v1 *)wl_registry_bind(
            r, name, &zwlr_layer_shell_v1_interface, version < 5 ? version : 5);
    } else if (!strcmp(iface, wl_output_interface.name) && app->outputs.size() < 8) {
        app->outputs.emplace_back();
        OutputState &o = app->outputs.back();
        o.wl = (struct wl_output *)wl_registry_bind(r, name, &wl_output_interface,
                                                    version < 4 ? version : 4);
        wl_output_add_listener(o.wl, &out_listener, &o);
    }
}
void App::reg_global_remove(void *data, struct wl_registry *r, uint32_t name) {
    (void)data; (void)r; (void)name; // hotplug removal is P2; outputs persist
}

static const struct wl_registry_listener reg_listener = {
    .global = App::reg_global, .global_remove = App::reg_global_remove,
};

// --------------------------------------------------------------------- init

bool App::init(const std::string &layer) {
    layer_ = layer;
    // OutputState addresses are captured as listener data at bind time; a
    // later reallocation would dangle them. The registry caps outputs at 8.
    outputs.reserve(8);
    disp_ = wl_display_connect(nullptr);
    if (!disp_) { LOGE("wl_display_connect failed (no wayland session?)"); return false; }
    reg_ = wl_display_get_registry(disp_);
    wl_registry_add_listener(reg_, &reg_listener, this);
    wl_display_roundtrip(disp_);
    wl_display_roundtrip(disp_);
    if (!compositor_ || !shell_ || outputs.empty()) {
        LOGE("missing globals (compositor=%p shell=%p outputs=%zu)",
             (void *)compositor_, (void *)shell_, outputs.size());
        return false;
    }
    LOGI("wayland: %zu output(s), layer=%s", outputs.size(), layer_.c_str());

    for (auto &o : outputs) {
        o.surface = wl_compositor_create_surface(compositor_);
        enum zwlr_layer_shell_v1_layer l = layer_ == "bottom"
            ? ZWLR_LAYER_SHELL_V1_LAYER_BOTTOM : ZWLR_LAYER_SHELL_V1_LAYER_BACKGROUND;
        o.layer_surface = zwlr_layer_shell_v1_get_layer_surface(shell_, o.surface, o.wl, l,
                                                                "mizu-l2d");
        zwlr_layer_surface_v1_set_anchor(o.layer_surface, ZWLR_LAYER_SURFACE_V1_ANCHOR_TOP |
                                                        ZWLR_LAYER_SURFACE_V1_ANCHOR_BOTTOM |
                                                        ZWLR_LAYER_SURFACE_V1_ANCHOR_LEFT |
                                                        ZWLR_LAYER_SURFACE_V1_ANCHOR_RIGHT);
        zwlr_layer_surface_v1_set_exclusive_zone(o.layer_surface, -1);
        zwlr_layer_surface_v1_add_listener(o.layer_surface, &ls_listener, &o);
        wl_surface_commit(o.surface);
    }
    wl_display_roundtrip(disp_);
    for (auto &o : outputs) {
        if (!o.configured) { LOGE("output '%s': no configure", o.name.c_str()); return false; }
        LOGI("output '%s': %dx%d", o.name.c_str(), o.width, o.height);
    }
    start_time_ = now_s();
    return true;
}

void App::destroy_output(size_t index) {
    if (index >= outputs.size()) return;
    OutputState &o = outputs[index];
    if (o.frame_cb) wl_callback_destroy(o.frame_cb);
    if (o.egl_window) wl_egl_window_destroy(o.egl_window);
    if (o.layer_surface) zwlr_layer_surface_v1_destroy(o.layer_surface);
    if (o.surface) wl_surface_destroy(o.surface);
    outputs.erase(outputs.begin() + index);
}

void App::commit_empty(size_t index) {
    if (index < outputs.size()) wl_surface_commit(outputs[index].surface);
}

// ----------------------------------------------------------------- run loop

void App::run(const PointerFn &on_pointer, const FrameFn &on_frame,
              int extra_fd, const std::function<void()> &on_extra) {
    pointer_cb_ = on_pointer;
    frame_cb_ = on_frame;
    int dfd = wl_display_get_fd(disp_);
    start_time_ = now_s();

    while (running_) {
        while (wl_display_prepare_read(disp_) != 0) wl_display_dispatch_pending(disp_);
        wl_display_flush(disp_);
        struct pollfd fds[2] = {{dfd, POLLIN, 0}, {extra_fd, POLLIN, 0}};
        nfds_t n = extra_fd >= 0 ? 2 : 1;
        int pr = poll(fds, n, 200);
        if (pr > 0 && (fds[0].revents & POLLIN)) wl_display_read_events(disp_);
        else wl_display_cancel_read(disp_);
        wl_display_dispatch_pending(disp_);

        if (extra_fd >= 0 && pr > 0 && (fds[1].revents & POLLIN) && on_extra) on_extra();

        double t = now_s() - start_time_;
        for (size_t i = 0; i < outputs.size(); i++) {
            if (!outputs[i].frame_pending) continue;
            outputs[i].frame_pending = false;
            outputs[i].frame_cb = wl_surface_frame(outputs[i].surface);
            wl_callback_add_listener(outputs[i].frame_cb, &cb_listener, &outputs[i]);
            frame_cb_(i, t); // must draw+swap (commits the request) or commit_empty
        }
    }
}
