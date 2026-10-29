// model_runtime.hpp — Cubism model loading and per-output instances.
//
// ModelAsset = parsed, shared, immutable data (setting, motions, textures,
// physics buffer). MizuModel = CubismUserModel subclass, one per output,
// holding its own motion queue / blink / focus / renderer. The GL context
// must be current on the target surface for load() and draw().
#pragma once

#include "common.hpp"
#include "scene.hpp" // Camera

#include <GLES2/gl2.h>

#include <CubismFramework.hpp>
#include <CubismModelSettingJson.hpp>
#include <Model/CubismUserModel.hpp>
#include <Type/CubismBasicType.hpp>

#include <map>
#include <memory>
#include <string>
#include <vector>

namespace l2df = Live2D::Cubism::Framework;

namespace mizu {

struct InteractionConfig {
    bool tracking = true;
    float fit = 0.92f;           // character bbox height / viewport height at zoom 1
    float head_fraction = 0.34f; // top fraction of bbox counting as head zone
    float special_after = 4.0f;  // soft touches before special unlocks
    float cooldown_head = 4.0f;
    float cooldown_body = 6.0f;
    float cooldown_special = 30.0f;
};

struct ModelAsset {
    std::string name, dir;
    l2df::CubismModelSettingJson *setting = nullptr;
    std::vector<l2df::csmByte *> buffers; // raw file contents kept alive
    std::map<std::string, std::vector<l2df::ACubismMotion *>> motions;
    std::vector<GLuint> textures; // GL textures shared across instances
    l2df::csmByte *phys_buf = nullptr;
    l2df::csmSizeInt phys_size = 0;
    float canvas_w = 0, canvas_h = 0;
    float bbox[4] = {0, 0, 0, 0}; // drawable bounds in canvas units, y down
    ~ModelAsset();
};

class ModelRuntime {
public:
    bool init(); // CubismFramework::StartUp + Initialize
    // Loads shared data for a model directory (model3.json). Textures need a
    // current GL context.
    std::shared_ptr<ModelAsset> load(const std::string &dir);
};

// Reads a file into a malloc'd buffer the Cubism side can hold on to.
l2df::csmByte *read_csm_file(const std::string &path, l2df::csmSizeInt *size);

class MizuModel : public l2df::CubismUserModel {
public:
    bool load(std::shared_ptr<ModelAsset> asset, const InteractionConfig &ic);
    void update(double dt);
    // Renders one frame; returns the screen-space damage bbox in px.
    Rect draw(float view_w, float view_h, const Camera &cam);
    void pointer_move(double px, double py, float view_w, float view_h, const Camera &cam);
    // Hit-test + zone pacing; returns the motion group played ("" if none).
    std::string tap(double px, double py, float view_w, float view_h, const Camera &cam);
    bool play_motion(const std::string &group, bool force);
    void screen_to_canvas(double px, double py, float view_w, float view_h,
                          const Camera &cam, float &cx, float &cy) const;
    Rect screen_bbox(float view_w, float view_h, const Camera &cam) const;
    const std::string &current_group() const { return current_; }
    unsigned tap_count = 0;

private:
    float view_scale(float view_h, const Camera &cam) const;
    void view_origin(float view_w, float view_h, const Camera &cam, float *tx, float *ty) const;

    std::shared_ptr<ModelAsset> a_;
    bool no_motion_ = false;
    InteractionConfig ic_;
    std::string current_ = "idle";
    double acc_time_ = 0;
    double last_play_[3] = {-1e9, -1e9, -1e9}; // head, body, special
    int soft_touches_ = 0;
    bool special_ready_ = false;
    int idx_angle_x_ = -1, idx_angle_y_ = -1, idx_angle_z_ = -1;
    int idx_eye_x_ = -1, idx_eye_y_ = -1, idx_body_x_ = -1;
    // per-instance state (csmReadFromBuffer keeps the moc buffer alive)
    std::vector<l2df::csmByte *> instance_buffers_;
    float canvas_w_ = 0, canvas_h_ = 0;
    float bbox_[4] = {0, 0, 0, 0};
};

} // namespace mizu
