// gl_core.hpp — EGL/GLES context management for layer surfaces.
#pragma once

#include <EGL/egl.h>

struct OutputState;
struct Rect;

class GlCore {
public:
    bool init(void *wl_display);
    bool add_output(OutputState &o);       // egl window + surface for a configured output
    void make_current(OutputState &o);
    // Swap with damage (buffer coords, top-left origin); full swap if empty.
    void swap_with_damage(OutputState &o, const Rect &dmg);
    bool have_swap_damage() const { return have_swap_damage_; }
    bool have_buffer_age() const { return have_buffer_age_; }

private:
    EGLDisplay dpy_ = EGL_NO_DISPLAY;
    EGLContext ctx_ = EGL_NO_CONTEXT;
    EGLConfig cfg_ = nullptr;
    bool have_swap_damage_ = false;
    bool have_buffer_age_ = false;
};
