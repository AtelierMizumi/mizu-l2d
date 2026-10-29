// scene.cpp — placeholder scene. The damage discipline from the design doc
// applies here too: we advertise only the disc's old∪new bbox, never the
// full surface (except the first frame).
#include "scene.hpp"
#include <cmath>

static GLint compile(GLenum type, const char *src) {
    GLint s = glCreateShader(type);
    glShaderSource(s, 1, &src, nullptr);
    glCompileShader(s);
    return s;
}

static GLint link(const char *vs, const char *fs) {
    GLint p = glCreateProgram();
    glAttachShader(p, compile(GL_VERTEX_SHADER, vs));
    glAttachShader(p, compile(GL_FRAGMENT_SHADER, fs));
    glLinkProgram(p);
    return p;
}

void Scene::init(int w, int h, const float accent[3]) {
    (void)w; (void)h;
    accent_[0] = accent[0]; accent_[1] = accent[1]; accent_[2] = accent[2];
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
    prog_bg_ = link(vs, fs_bg);
    prog_disc_ = link(vs, fs_disc);
    static const float quad[8] = {-1, -1, 1, -1, -1, 1, 1, 1};
    glGenBuffers(1, &vbo_);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_);
    glBufferData(GL_ARRAY_BUFFER, sizeof(quad), quad, GL_STATIC_DRAW);
    inited_ = true;
}

void Scene::bg(int w, int h) {
    if (!inited_) return;
    glViewport(0, 0, w, h);
    glUseProgram(prog_bg_);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_);
    GLint ap = glGetAttribLocation(prog_bg_, "a_pos");
    glEnableVertexAttribArray(ap);
    glVertexAttribPointer(ap, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
    glUniform2f(glGetUniformLocation(prog_bg_, "u_center"), 0, 0);
    glUniform2f(glGetUniformLocation(prog_bg_, "u_half"), 1, 1);
    glUniform3f(glGetUniformLocation(prog_bg_, "u_col1"), 0.043f, 0.106f, 0.200f);
    glUniform3f(glGetUniformLocation(prog_bg_, "u_col2"), 0.016f, 0.043f, 0.090f);
    glDisable(GL_BLEND);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
}

static void disc_rect(int w, int h, double t, const Camera &cam,
                      double *cx, double *cy, double *r) {
    // base slow drift; camera zoom grows the disc, pan shifts it
    *r = fmin(w, h) * 0.055 * cam.zoom;
    *cx = w * (0.5 + cam.x + 0.20 * cam.zoom * sin(t * 2.0 * M_PI / 6.0));
    *cy = h * (0.5 - cam.y - 0.008 * sin(t * 2.0 * M_PI / 2.5));
}

Rect Scene::render(int w, int h, double t, const Camera &cam) {
    double cx, cy, r;
    disc_rect(w, h, t, cam, &cx, &cy, &r);
    glViewport(0, 0, w, h);

    glUseProgram(prog_bg_);
    glBindBuffer(GL_ARRAY_BUFFER, vbo_);
    GLint ap = glGetAttribLocation(prog_bg_, "a_pos");
    glEnableVertexAttribArray(ap);
    glVertexAttribPointer(ap, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
    glUniform2f(glGetUniformLocation(prog_bg_, "u_center"), 0, 0);
    glUniform2f(glGetUniformLocation(prog_bg_, "u_half"), 1, 1);
    glUniform3f(glGetUniformLocation(prog_bg_, "u_col1"), 0.043f, 0.106f, 0.200f);
    glUniform3f(glGetUniformLocation(prog_bg_, "u_col2"), 0.016f, 0.043f, 0.090f);
    glDisable(GL_BLEND);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);

    glUseProgram(prog_disc_);
    ap = glGetAttribLocation(prog_disc_, "a_pos");
    glEnableVertexAttribArray(ap);
    glVertexAttribPointer(ap, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
    glUniform2f(glGetUniformLocation(prog_disc_, "u_center"),
                (float)(2.0 * cx / w - 1.0), (float)(1.0 - 2.0 * cy / h));
    glUniform2f(glGetUniformLocation(prog_disc_, "u_half"),
                (float)(2 * r / w), (float)(2 * r / h));
    glUniform3f(glGetUniformLocation(prog_disc_, "u_color"), accent_[0], accent_[1], accent_[2]);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);

    static const int PAD = 12;
    Rect now{(int)(cx - r) - PAD, (int)(cy - r) - PAD, (int)(2 * r) + 2 * PAD,
             (int)(2 * r) + 2 * PAD};
    return now;
}

// The per-output "previous bbox" lives in OutputState (app.hpp); main.cpp
// computes the final damage union with it. Kept out of Scene to keep this
// class stateless across outputs (one GL context, many surfaces).
