// model_runtime.cpp — Cubism asset loading and per-output model instances.
#include "model_runtime.hpp"
#include "cubism_env.hpp"

#include <CubismFramework.hpp>
#include <CubismModelSettingJson.hpp>
#include <CubismDefaultParameterId.hpp>
#include <Effect/CubismEyeBlink.hpp>
#include <Id/CubismIdManager.hpp>
#include <Math/CubismModelMatrix.hpp>
#include <Model/CubismModel.hpp>
#include <Model/CubismUserModel.hpp>
#include <Motion/CubismMotion.hpp>
#include <Motion/CubismMotionManager.hpp>
#include <Physics/CubismPhysics.hpp>
#include <Rendering/OpenGL/CubismRenderer_OpenGLES2.hpp>

#include <GLES2/gl2ext.h>

#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#include <stb_image.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <utility>

namespace l2df = Live2D::Cubism::Framework;
namespace Core = Live2D::Cubism::Core;
using namespace l2df;

namespace mizu {

// ------------------------------------------------------------------ helpers

static std::string read_all(const std::string &path, size_t *size) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return {};
    std::string data((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    if (size) *size = data.size();
    return data;
}

static std::string join_path(const std::string &a, const std::string &b) {
    if (b.empty()) return a;
    if (b[0] == '/' || a.empty()) return b;
    return a + "/" + b;
}

// model3.json references come from third-party packs: keep each one inside the model dir.
static bool is_safe_rel(const std::string &p) {
    std::filesystem::path rel(p);
    if (p.empty() || rel.is_absolute() || rel.has_root_directory()) return false;
    for (const auto &part : rel)
        if (part == "..") return false;
    return true;
}

ModelAsset::~ModelAsset() {
    delete setting;
    for (auto *b : buffers) free(b);
    for (auto &kv : motions)
        for (auto *m : kv.second) ACubismMotion::Delete(m);
    // GL textures are intentionally left to context teardown; model switching
    // (with proper disposal) arrives in the next increment.
}

// ------------------------------------------------------------------ runtime

Csm::csmByte *read_csm_file(const std::string &path, csmSizeInt *size) {
    std::string data = read_all(path, nullptr);
    if (data.empty()) return nullptr;
    auto *buf = (csmByte *)malloc(data.size());
    memcpy(buf, data.data(), data.size());
    if (size) *size = (csmSizeInt)data.size();
    return buf;
}

bool ModelRuntime::init() { return cubism_startup(); }

std::shared_ptr<ModelAsset> ModelRuntime::load(const std::string &dir) {
    auto asset = std::make_shared<ModelAsset>();
    asset->dir = dir;
    asset->name = dir.substr(dir.find_last_of('/') + 1);

    csmSizeInt sz = 0;
    csmByte *buf = read_csm_file(join_path(dir, asset->name + ".model3.json"), &sz);
    if (!buf) {
        LOGE("model: %s.model3.json not found in %s", asset->name.c_str(), dir.c_str());
        return nullptr;
    }
    asset->buffers.push_back(buf);
    asset->setting = new CubismModelSettingJson(buf, sz);

    // textures (needs current GL context)
    csmInt32 n = asset->setting->GetTextureCount();
    for (csmInt32 i = 0; i < n; i++) {
        std::string tex = asset->setting->GetTextureFileName(i);
        std::string rel = tex.find('/') != std::string::npos
                              ? tex
                              : join_path(asset->setting->GetTextureDirectory(), tex);
        std::string path = join_path(dir, rel);
        int w, h, comp;
        unsigned char *px = is_safe_rel(rel) ? stbi_load(path.c_str(), &w, &h, &comp, 4) : nullptr;
        if (!px) {
            LOGW("model: texture %s failed to load", path.c_str());
            asset->textures.push_back(0);
            continue;
        }
        // Unity Texture2D is bottom-up; flip to match Cubism's UV convention
        // (v=0 at the image top row).
        {
            const int row = w * 4;
            unsigned char *tmp = (unsigned char *)malloc(row);
            for (int y = 0; y < h / 2; y++) {
                unsigned char *a = px + (size_t)y * row;
                unsigned char *b = px + (size_t)(h - 1 - y) * row;
                memcpy(tmp, a, row);
                memcpy(a, b, row);
                memcpy(b, tmp, row);
            }
            free(tmp);
        }
        for (int p = 0; p < w * h; p++) { // premultiplied alpha
            px[p * 4 + 0] = (unsigned char)(px[p * 4 + 0] * px[p * 4 + 3] / 255);
            px[p * 4 + 1] = (unsigned char)(px[p * 4 + 1] * px[p * 4 + 3] / 255);
            px[p * 4 + 2] = (unsigned char)(px[p * 4 + 2] * px[p * 4 + 3] / 255);
        }
        GLuint id;
        glGenTextures(1, &id);
        glBindTexture(GL_TEXTURE_2D, id);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, px);
        glGenerateMipmap(GL_TEXTURE_2D);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        const char *ext = (const char *)glGetString(GL_EXTENSIONS);
        if (ext && strstr(ext, "GL_EXT_texture_filter_anisotropic")) {
            GLfloat max_ani = 1.0f;
            glGetFloatv(GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT, &max_ani);
            glTexParameterf(GL_TEXTURE_2D, GL_TEXTURE_MAX_ANISOTROPY_EXT,
                            std::min(8.0f, max_ani));
        }
        stbi_image_free(px);
        asset->textures.push_back(id);
        LOGI("model: texture %s (%dx%d) -> tex %u", path.c_str(), w, h, id);
    }

    // physics buffer (shared; instances create stateful CubismPhysics from it)
    const char *phys = asset->setting->GetPhysicsFileName();
    if (phys && phys[0] && is_safe_rel(phys)) {
        asset->phys_buf = read_csm_file(join_path(dir, phys), &asset->phys_size);
    }

    // motions: eager-parse every group (design §4 — no first-tap hitch)
    csmInt32 g = asset->setting->GetMotionGroupCount();
    for (csmInt32 i = 0; i < g; i++) {
        std::string group = asset->setting->GetMotionGroupName(i);
        csmInt32 count = asset->setting->GetMotionCount(group.c_str());
        for (csmInt32 j = 0; j < count; j++) {
            std::string mf = asset->setting->GetMotionFileName(group.c_str(), j);
            if (!mf.empty() && mf.find('/') == std::string::npos)
                mf = "motions/" + mf;
            if (!is_safe_rel(mf)) continue;
            csmSizeInt msz = 0;
            csmByte *mb = read_csm_file(join_path(dir, mf), &msz);
            if (!mb) continue;
            asset->buffers.push_back(mb);
            CubismMotion *m = CubismMotion::Create(mb, msz);
            asset->motions[group].push_back(m);
        }
    }
    LOGI("model: '%s' loaded (%zu groups, %zu textures)", asset->name.c_str(),
         asset->motions.size(), asset->textures.size());
    return asset;
}

// ------------------------------------------------------------------ instance

bool MizuModel::load(std::shared_ptr<ModelAsset> asset, const InteractionConfig &ic) {
    if (!asset || !asset->setting || asset->textures.empty()) return false;
    a_ = asset;
    ic_ = ic;

    // moc buffer: csmReadFromBuffer keeps the buffer alive in the moc, so the
    // instance owns its own copy via instance_buffers_
    csmSizeInt msz = 0;
    csmByte *moc = read_csm_file(join_path(a_->dir, a_->name + ".moc3"), &msz);
    if (!moc) { LOGE("model: moc3 read failed"); return false; }
    instance_buffers_.push_back(moc);
    LoadModel(moc, msz, true);  // moc3 is third-party data: let Core verify it before use
    if (!_model) { LOGE("model: LoadModel failed"); return false; }

    if (a_->phys_buf) LoadPhysics(a_->phys_buf, a_->phys_size);

    canvas_w_ = _model->GetCanvasWidthPixel();
    canvas_h_ = _model->GetCanvasHeightPixel();
    delete _modelMatrix;
    _modelMatrix = new CubismModelMatrix(canvas_w_, canvas_h_);

    // drawable bbox in canvas units (for fitting, hit zones, damage)
    float x0 = 1e9f, y0 = 1e9f, x1 = -1e9f, y1 = -1e9f;
    csmInt32 dc = _model->GetDrawableCount();
    for (csmInt32 i = 0; i < dc; i++) {
        const Core::csmVector2 *v = _model->GetDrawableVertexPositions(i);
        csmInt32 vc = _model->GetDrawableVertexCount(i);
        for (csmInt32 k = 0; k < vc; k++) {
            x0 = std::min(x0, v[k].X); x1 = std::max(x1, v[k].X);
            y0 = std::min(y0, v[k].Y); y1 = std::max(y1, v[k].Y);
        }
    }
    bbox_[0] = x0; bbox_[1] = y0; bbox_[2] = x1; bbox_[3] = y1;
    a_->canvas_w = canvas_w_;
    a_->canvas_h = canvas_h_;
    a_->bbox[0] = x0; a_->bbox[1] = y0; a_->bbox[2] = x1; a_->bbox[3] = y1;

    CreateRenderer(1);
    auto *renderer = GetRenderer<l2df::Rendering::CubismRenderer_OpenGLES2>();
    if (!renderer) { LOGE("model: CreateRenderer failed"); return false; }
    renderer->IsPremultipliedAlpha(true);
    for (size_t i = 0; i < a_->textures.size(); i++)
        renderer->BindTexture((csmUint32)i, a_->textures[i]);

    if (a_->setting->GetEyeBlinkParameterCount() > 0)
        _eyeBlink = CubismEyeBlink::Create(a_->setting);

    idx_angle_x_ = _model->GetParameterIndex(
        CubismFramework::GetIdManager()->GetId(l2df::DefaultParameterId::ParamAngleX));
    idx_angle_y_ = _model->GetParameterIndex(
        CubismFramework::GetIdManager()->GetId(l2df::DefaultParameterId::ParamAngleY));
    idx_angle_z_ = _model->GetParameterIndex(
        CubismFramework::GetIdManager()->GetId(l2df::DefaultParameterId::ParamAngleZ));
    idx_eye_x_ = _model->GetParameterIndex(
        CubismFramework::GetIdManager()->GetId(l2df::DefaultParameterId::ParamEyeBallX));
    idx_eye_y_ = _model->GetParameterIndex(
        CubismFramework::GetIdManager()->GetId(l2df::DefaultParameterId::ParamEyeBallY));
    idx_body_x_ = _model->GetParameterIndex(
        CubismFramework::GetIdManager()->GetId(l2df::DefaultParameterId::ParamBodyAngleX));

    no_motion_ = getenv("MIZU_NO_MOTION") != nullptr;
    if (!no_motion_) play_motion("idle", true);
    LOGI("model instance: canvas %.0fx%.0f bbox [%.2f %.2f %.2f %.2f]",
         canvas_w_, canvas_h_, bbox_[0], bbox_[1], bbox_[2], bbox_[3]);
    return true;
}

void MizuModel::update(double dt) {
    acc_time_ += dt;
    _model->LoadParameters();
    if (!no_motion_) {
        if (_motionManager->IsFinished()) play_motion("idle", true);
        _motionManager->UpdateMotion(_model, (float)dt);
    }
    _model->SaveParameters();
    if (_eyeBlink) _eyeBlink->UpdateParameters(_model, (float)dt);

    _dragManager->Update((float)dt);
    float dx = _dragManager->GetX(), dy = _dragManager->GetY();
    if (idx_angle_x_ >= 0) _model->SetParameterValue(idx_angle_x_, dx * 30);
    if (idx_angle_y_ >= 0) _model->SetParameterValue(idx_angle_y_, dy * 30);
    if (idx_angle_z_ >= 0) _model->SetParameterValue(idx_angle_z_, dx * dx * -30);
    if (idx_eye_x_ >= 0) _model->SetParameterValue(idx_eye_x_, dx);
    if (idx_eye_y_ >= 0) _model->SetParameterValue(idx_eye_y_, dy);
    if (idx_body_x_ >= 0) _model->SetParameterValue(idx_body_x_, dx * 4);

    if (_physics) _physics->Evaluate(_model, (float)dt);
    _model->Update();
}

float MizuModel::view_scale(float view_h, const Camera &cam) const {
    float bh = bbox_[3] - bbox_[1];
    if (bh <= 0) bh = canvas_h_;
    return view_h * ic_.fit * cam.zoom / bh;
}

void MizuModel::view_origin(float view_w, float view_h, const Camera &cam,
                            float *tx, float *ty) const {
    float s = view_scale(view_h, cam);
    float bcx = (bbox_[0] + bbox_[2]) * 0.5f;
    *tx = view_w * 0.5f + cam.x * view_w - bcx * s;
    *ty = view_h * (1.0f + cam.y) - bbox_[3] * s; // bbox bottom anchored at view bottom
}

Rect MizuModel::draw(float view_w, float view_h, const Camera &cam) {
    float s = view_scale(view_h, cam), tx, ty;
    view_origin(view_w, view_h, cam, &tx, &ty);

    static int dbg = 0;
    if (dbg < 2) {
        csmInt32 dc = _model->GetDrawableCount();
        std::map<int, int> tex_count;
        int max_tex = -1, skipped = 0;
        float umin = 1e9f, umax = -1e9f, vmin = 1e9f, vmax = -1e9f;
        for (csmInt32 i = 0; i < dc; i++) {
            int ti = _model->GetDrawableTextureIndex(i);
            tex_count[ti]++;
            if (ti > max_tex) max_tex = ti;
            csmInt32 uvc = _model->GetDrawableVertexCount(i);
            const Core::csmVector2 *uv = _model->GetDrawableVertexUvs(i);
            for (csmInt32 k = 0; k < uvc; k++) {
                umin = std::min(umin, uv[k].X); umax = std::max(umax, uv[k].X);
                vmin = std::min(vmin, uv[k].Y); vmax = std::max(vmax, uv[k].Y);
            }
        }
        LOGI("dbg: dc=%d max_tex_idx=%d tex_dist=[0:%d 1:%d 2:%d] uv=[%.2f..%.2f, %.2f..%.2f] mytex=%zu",
             dc, max_tex, tex_count.count(0) ? tex_count[0] : 0,
             tex_count.count(1) ? tex_count[1] : 0, tex_count.count(2) ? tex_count[2] : 0,
             umin, umax, vmin, vmax, a_->textures.size());
        // per-drawable extents: top 5 largest + canvas info
        std::vector<std::pair<float, int>> ext;
        for (csmInt32 i = 0; i < dc; i++) {
            csmInt32 uvc = _model->GetDrawableVertexCount(i);
            const Core::csmVector2 *v = _model->GetDrawableVertexPositions(i);
            float x0 = 1e9f, x1 = -1e9f, y0 = 1e9f, y1 = -1e9f;
            for (csmInt32 k = 0; k < uvc; k++) {
                x0 = std::min(x0, v[k].X); x1 = std::max(x1, v[k].X);
                y0 = std::min(y0, v[k].Y); y1 = std::max(y1, v[k].Y);
            }
            ext.push_back({x1 - x0, i});
        }
        std::sort(ext.rbegin(), ext.rend());
        for (int i = 0; i < 5 && i < (int)ext.size(); i++) {
            int di = ext[i].second;
            csmInt32 uvc = _model->GetDrawableVertexCount(di);
            const Core::csmVector2 *v = _model->GetDrawableVertexPositions(di);
            LOGI("  drawable %d: w=%.1f vc=%d v0=(%.1f,%.1f) v1=(%.1f,%.1f)",
                 di, ext[i].first, uvc, v[0].X, v[0].Y, v[1].X, v[1].Y);
        }
        (void)skipped; (void)dbg;
    }

    float m[16] = {};
    m[0] = 2 * s / view_w;
    m[5] = -2 * s / view_h;
    m[10] = 1;
    m[12] = 2 * tx / view_w - 1;
    m[13] = 1 - 2 * ty / view_h;
    m[15] = 1;
    CubismMatrix44 mvp;
    mvp.SetMatrix(m);
    auto *renderer = GetRenderer<l2df::Rendering::CubismRenderer_OpenGLES2>();
    renderer->SetMvpMatrix(&mvp);
    renderer->DrawModel();
    if (dbg < 4) {
        GLenum err = glGetError();
        LOGI("dbg post-draw glerr=0x%x", err);
        dbg++;
    }

    // damage: full model bbox mapped to screen, padded
    int px0 = (int)(bbox_[0] * s + tx) - 16, py0 = (int)(bbox_[1] * s + ty) - 16;
    int px1 = (int)(bbox_[2] * s + tx) + 16, py1 = (int)(bbox_[3] * s + ty) + 16;
    return Rect{px0, py0, px1 - px0, py1 - py0};
}

void MizuModel::screen_to_canvas(double px, double py, float view_w, float view_h,
                                 const Camera &cam, float &cx, float &cy) const {
    float s = view_scale(view_h, cam), tx, ty;
    view_origin(view_w, view_h, cam, &tx, &ty);
    cx = (float)((px - tx) / s);
    cy = (float)((py - ty) / s);
}

void MizuModel::pointer_move(double px, double py, float view_w, float view_h,
                             const Camera &cam) {
    if (!ic_.tracking) return;
    float cx, cy;
    screen_to_canvas(px, py, view_w, view_h, cam, cx, cy);
    float bcx = (bbox_[0] + bbox_[2]) * 0.5f;
    float bcy = (bbox_[1] + bbox_[3]) * 0.5f;
    float bwd = std::max(1e-3f, bbox_[2] - bbox_[0]);
    float bhe = std::max(1e-3f, bbox_[3] - bbox_[1]);
    float nx = std::clamp((cx - bcx) / (bwd * 0.5f), -1.0f, 1.0f);
    float ny = std::clamp((cy - bcy) / (bhe * 0.5f), -1.0f, 1.0f);
    _dragManager->Set(nx, ny);
}

bool MizuModel::play_motion(const std::string &group, bool force) {
    auto it = a_->motions.find(group);
    if (it == a_->motions.end() || it->second.empty()) {
        if (group != "idle") return false;
        return false;
    }
    auto &list = it->second;
    ACubismMotion *m = list[rand() % list.size()];
    if (force) _motionManager->StopAllMotions();
    _motionManager->StartMotion(m, false);
    current_ = group;
    return true;
}

std::string MizuModel::tap(double px, double py, float view_w, float view_h,
                           const Camera &cam) {
    tap_count++;
    float cx, cy;
    screen_to_canvas(px, py, view_w, view_h, cam, cx, cy);
    bool head = cy < bbox_[1] + ic_.head_fraction * (bbox_[3] - bbox_[1]);
    double now = now_s();
    std::string group;
    if (head) {
        if (now - last_play_[0] < ic_.cooldown_head) return "";
        group = "touch_head";
        last_play_[0] = now;
    } else {
        if (special_ready_ && now - last_play_[2] >= ic_.cooldown_special) {
            group = "touch_special";
            special_ready_ = false;
            soft_touches_ = 0;
            last_play_[2] = now;
        } else {
            if (now - last_play_[1] < ic_.cooldown_body) return "";
            group = "touch_body";
            last_play_[1] = now;
            if (++soft_touches_ >= (int)ic_.special_after) {
                special_ready_ = true;
                soft_touches_ = 0;
            }
        }
    }
    if (!play_motion(group, true)) return "";
    return group;
}

Rect MizuModel::screen_bbox(float view_w, float view_h, const Camera &cam) const {
    float s = view_scale(view_h, cam), tx, ty;
    view_origin(view_w, view_h, cam, &tx, &ty);
    int px0 = (int)(bbox_[0] * s + tx) - 16, py0 = (int)(bbox_[1] * s + ty) - 16;
    int px1 = (int)(bbox_[2] * s + tx) + 16, py1 = (int)(bbox_[3] * s + ty) + 16;
    return Rect{px0, py0, px1 - px0, py1 - py0};
}

} // namespace mizu
