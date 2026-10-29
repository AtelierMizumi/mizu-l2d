// scene.hpp — placeholder renderer: navy gradient + accent disc, driven by a
// lightweight camera (zoom/pan). Stands in for the Cubism model runtime.
#pragma once

#include "common.hpp"

#include <GLES2/gl2.h>

struct Camera {
    float zoom = 1.0f;   // 1.0 = default framing
    float x = 0.0f;      // pan, fraction of output width
    float y = 0.0f;
};

class Scene {
public:
    void init(int w, int h, const float accent[3]);
    // Background gradient only (drawn under the model path too).
    void bg(int w, int h);
    // Render one frame at time t; returns the damage rect in buffer coords
    // (top-left origin). Caller swaps with this damage.
    Rect render(int w, int h, double t, const Camera &cam);

private:
    bool inited_ = false;
    GLuint prog_bg_ = 0, prog_disc_ = 0, vbo_ = 0;
    float accent_[3] = {0.831f, 0.690f, 0.416f};
};
