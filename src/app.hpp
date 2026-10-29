// app.hpp — Wayland side: globals, per-output background layer surfaces,
// pointer input, and the event loop (poll over display fd + external fds).
#pragma once

#include <wayland-client.h>
#include <wayland-egl.h>
#include <EGL/egl.h>

#include <functional>
#include <string>
#include <vector>

struct zwlr_layer_surface_v1; // full header included in app.cpp (C++ keyword clash)

struct OutputState {
    struct wl_output *wl = nullptr;
    struct wl_surface *surface = nullptr;
    struct zwlr_layer_surface_v1 *layer_surface = nullptr;
    struct wl_egl_window *egl_window = nullptr;
    EGLSurface egl_surface = EGL_NO_SURFACE;
    struct wl_callback *frame_cb = nullptr;

    std::string name;
    int width = 0, height = 0, scale = 1;
    bool configured = false;
    bool frame_pending = false;   // callback fired, needs redraw
    int prev_bbox[4] = {-1, 0, 0, 0};
    unsigned frames_drawn = 0;
    double frame_ms[256];
    unsigned frame_ms_n = 0;
    double last_ms_ts = 0;

    // per-output camera pose (placeholder scene)
    float cam_zoom = 1.0f, cam_x = 0.0f, cam_y = 0.0f;
};

enum class PointerEventKind { Enter, Leave, Motion, Button };

struct PointerEvent {
    PointerEventKind kind;
    size_t output_index;
    double x, y;              // surface-local
    uint32_t button = 0;      // Button only
    uint32_t state = 0;       // 0 release, 1 press
};

struct App {
    using PointerFn = std::function<void(const PointerEvent &)>;
    using FrameFn = std::function<void(size_t, double)>; // (output index, t seconds)

    bool init(const std::string &layer = "background");
    void run(const PointerFn &on_pointer, const FrameFn &on_frame,
             int extra_fd = -1, const std::function<void()> &on_extra = {});
    void stop() { running_ = false; }
    void commit_empty(size_t index);
    size_t hover_output() const { return hover_output_; }

    std::vector<OutputState> outputs;
    void destroy_output(size_t index);
    double start_time() const { return start_time_; }

    // (wayland internals; public so the static C callbacks can reach them)
    struct wl_display *disp_ = nullptr;
    struct wl_registry *reg_ = nullptr;
    struct wl_compositor *compositor_ = nullptr;
    struct wl_seat *seat_ = nullptr;
    struct wl_pointer *pointer_ = nullptr;
    struct zwlr_layer_shell_v1 *shell_ = nullptr;
    struct zwlr_virtual_pointer_manager_v1 *vpm_ = nullptr;
    size_t hover_output_ = 0;

    static void reg_global(void *data, struct wl_registry *reg, uint32_t name,
                           const char *iface, uint32_t version);
    static void reg_global_remove(void *data, struct wl_registry *reg, uint32_t name);

    void dispatch_pointer(const PointerEvent &e) { pointer_cb_(e); }

    PointerFn pointer_cb_;
    FrameFn frame_cb_;
    bool running_ = true;
    double start_time_ = 0;
    std::string layer_ = "background";
};
