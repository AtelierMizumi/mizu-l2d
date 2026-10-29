// main.cpp — mizu-l2d daemon skeleton.
//
// Phase-1 core: per-output background layer surfaces, EGL/GLES3, vsync frame
// loop with partial damage, pointer tracking, placeholder scene with a camera,
// JSON-lines IPC. The Cubism model runtime slots in behind the scene.
#include "app.hpp"
#include "config.hpp"
#include "gl_core.hpp"
#include "ipc.hpp"
#include "scene.hpp"

#ifdef CUBISM_AVAILABLE
#include "model/model_runtime.hpp"
#include <memory>
#endif

#include <stb_image.h>
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include <GLES2/gl2.h>

#include <sys/resource.h>
#include <unistd.h>

#include <algorithm>
#include <cstdlib>
#include <csignal>
#include <cstring>

static App *g_app = nullptr;
static void on_signal(int) { if (g_app) g_app->stop(); }

static volatile sig_atomic_t g_shot = 0;
static std::string g_shot_path;
static void on_usr1(int) { g_shot = 1; }

static long rss_kb() {
    struct rusage ru;
    getrusage(RUSAGE_SELF, &ru);
    return ru.ru_maxrss;
}

static double pctl(std::vector<double> v, double p) {
    if (v.empty()) return 0;
    std::sort(v.begin(), v.end());
    return v[(size_t)(v.size() * p)];
}

int main(int argc, char **argv) {
    std::string cfg_override;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--config") && i + 1 < argc) cfg_override = argv[++i];
        else if (!strcmp(argv[i], "--layer") && i + 1 < argc) { /* used below */ i++; }
    }
    const char *layer = "background";
    for (int i = 1; i < argc; i++)
        if (!strcmp(argv[i], "--layer") && i + 1 < argc) layer = argv[i + 1];
        else if (!strcmp(argv[i], "--screenshot") && i + 1 < argc) g_shot_path = argv[++i];

    Config cfg = Config::load(cfg_override);
    LOGI("mizu-l2d skeleton starting (placeholder scene; Cubism runtime lands next)");

    App app;
    g_app = &app;
    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);
    if (!g_shot_path.empty()) signal(SIGUSR1, on_usr1);

    auto maybe_screenshot = [&](OutputState &o) {
        if (!g_shot) return;
        g_shot = 0;
        std::vector<unsigned char> px((size_t)o.width * o.height * 4);
        glReadPixels(0, 0, o.width, o.height, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
        std::vector<unsigned char> flip(px.size());
        for (int y = 0; y < o.height; y++)
            memcpy(&flip[(size_t)(o.height - 1 - y) * o.width * 4],
                   &px[(size_t)y * o.width * 4], (size_t)o.width * 4);
        // numbered sequence: /tmp/shot.png -> /tmp/shot-003.png
        static unsigned shot_n = 0;
        std::string path = g_shot_path;
        std::string ext = path.size() > 4 && path.substr(path.size() - 4) == ".png"
                              ? ".png" : "";
        if (!ext.empty()) path = path.substr(0, path.size() - 4);
        char tail[16];
        snprintf(tail, sizeof tail, "-%03u%s", ++shot_n, ext.c_str());
        path += tail;
        stbi_write_png(path.c_str(), o.width, o.height, 4, flip.data(), o.width * 4);
        LOGI("screenshot -> %s", path.c_str());
    };

    if (!app.init(layer)) return 1;

    GlCore gl;
    if (!gl.init(app.disp_)) return 1;
    for (auto &o : app.outputs)
        if (!gl.add_output(o)) return 1;

#ifdef CUBISM_AVAILABLE
    // model runtime: shared asset + one instance per output
    mizu::ModelRuntime runtime;
    std::shared_ptr<mizu::ModelAsset> asset;
    mizu::InteractionConfig icfg;
    icfg.tracking = cfg.tracking;
    icfg.fit = cfg.model_fit;
    icfg.head_fraction = cfg.head_fraction;
    icfg.special_after = cfg.special_after;
    icfg.cooldown_head = cfg.cooldown_head;
    icfg.cooldown_body = cfg.cooldown_body;
    icfg.cooldown_special = cfg.cooldown_special;
    if (!cfg.model_path.empty()) {
        if (!runtime.init()) LOGW("cubism startup failed — placeholder scene continues");
        else {
            gl.make_current(app.outputs[0]);
            asset = runtime.load(cfg.model_path);
        }
    }
    std::vector<std::unique_ptr<mizu::MizuModel>> models(app.outputs.size());
    if (asset)
        for (size_t i = 0; i < app.outputs.size(); i++) {
            gl.make_current(app.outputs[i]);
            models[i] = std::make_unique<mizu::MizuModel>();
            if (!models[i]->load(asset, icfg)) models[i].reset();
        }
    if (asset) LOGI("model runtime active on %zu output(s)", app.outputs.size());
#else
    if (!cfg.model_path.empty())
        LOGW("built without Cubism SDK (scripts/fetch-thirdparty.sh) — placeholder scene");
#endif

    Scene scene;
    std::vector<bool> scene_ready(app.outputs.size(), false);
    std::vector<double> last_frame(app.outputs.size(), 0.0);
    const char *xdg = getenv("XDG_RUNTIME_DIR");
    IpcServer ipc;
    if (!xdg || !ipc.listen(xdg, cfg.socket_name)) {
        LOGW("ipc unavailable (continuing without control socket)");
    }

    // interaction state (global; per-output model instances come later)
    double last_input = now_s();
    bool pointer_over = false;
    unsigned skip_counter = 0;

    auto record_frame_ms = [](OutputState &o) {
        double now = now_s();
        if (o.last_ms_ts > 0 && o.frame_ms_n < 256)
            o.frame_ms[o.frame_ms_n++] = (now - o.last_ms_ts) * 1000.0;
        o.last_ms_ts = now;
        o.frames_drawn++;
    };

    auto on_pointer = [&](const PointerEvent &e) {
        last_input = now_s();
        if (e.kind == PointerEventKind::Enter) pointer_over = true;
        if (e.kind == PointerEventKind::Leave) pointer_over = false;
#ifdef CUBISM_AVAILABLE
        if (models.empty() || e.output_index >= models.size()) return;
        auto &m = models[e.output_index];
        if (!m) return;
        OutputState &o = app.outputs[e.output_index];
        Camera cam{o.cam_zoom, o.cam_x, o.cam_y};
        if (e.kind == PointerEventKind::Motion) m->pointer_move(e.x, e.y, (float)o.width, (float)o.height, cam);
        if (e.kind == PointerEventKind::Button && e.state == 1) {
            std::string g = m->tap(e.x, e.y, (float)o.width, (float)o.height, cam);
            if (!g.empty()) LOGI("tap -> motion '%s'", g.c_str());
        }
#endif
    };

    auto on_request = [&](const Json &req) -> std::string {
        std::string cmd = req.get_str("cmd");
        Json out;
        out.set("ok", true);
        if (cmd == "ping") {
            out.set("pong", now_s() - app.start_time());
        } else if (cmd == "status") {
#ifdef CUBISM_AVAILABLE
            unsigned live = 0;
            for (auto &m : models) if (m) live++;
            out.set("model", asset ? asset->name : std::string("placeholder-skeleton"));
            out.set("outputs", (double)app.outputs.size());
            out.set("instances", (double)live);
            out.set("taps", (double)(models[0] ? models[0]->tap_count : 0));
            out.set("motion", models[0] ? models[0]->current_group() : std::string("-"));
#else
            out.set("model", "placeholder-skeleton");
            out.set("outputs", (double)app.outputs.size());
#endif
            out.set("pointer_over", pointer_over);
        } else if (cmd == "camera") {
            if (req.has("reset")) {
                for (auto &o : app.outputs) { o.cam_zoom = 1.0f; o.cam_x = 0; o.cam_y = 0; }
            }
            if (req.has("zoom")) {
                double z = req.get_num("zoom", 1.0);
                if (z < 0.5) z = 0.5;
                if (z > 3.0) z = 3.0;
                for (auto &o : app.outputs) o.cam_zoom = (float)z;
            }
            auto pos = req.get_arr("pos");
            if (pos.size() == 2)
                for (auto &o : app.outputs) { o.cam_x = (float)pos[0]; o.cam_y = (float)pos[1]; }
            out.set("zoom", (double)app.outputs[0].cam_zoom);
            out.set("pos", std::vector<double>{app.outputs[0].cam_x, app.outputs[0].cam_y});
        } else if (cmd == "perf") {
            std::vector<double> all_ms;
            unsigned frames = 0;
            for (auto &o : app.outputs) {
                frames += o.frames_drawn;
                for (unsigned k = 0; k < o.frame_ms_n; k++) all_ms.push_back(o.frame_ms[k]);
            }
            double elapsed = now_s() - app.start_time();
            out.set("frames", (double)frames);
            out.set("outputs", (double)app.outputs.size());
            out.set("fps_per_output", elapsed > 0 && app.outputs.size()
                                          ? frames / elapsed / app.outputs.size() : 0.0);
            out.set("p50_ms", pctl(all_ms, 0.5));
            out.set("p95_ms", pctl(all_ms, 0.95));
            out.set("rss_kb", (double)rss_kb());
        } else if (cmd == "motion") {
            std::string group = req.get_str("group", "idle");
            bool played = false;
#ifdef CUBISM_AVAILABLE
            for (auto &m : models)
                if (m) played |= m->play_motion(group, true);
#endif
            out.set("played", played);
            out.set("group", group);
        } else {
            out.set("ok", false);
            out.set("error", "unknown cmd '" + cmd + "'");
        }
        return out.serialize();
    };

    auto on_frame = [&](size_t idx, double t) {
        if (idx >= app.outputs.size()) return;
        OutputState &o = app.outputs[idx];

        // idle fps ramp: after quiet_time without input, skip frames
        bool interactive = pointer_over || (now_s() - last_input) < cfg.quiet_time_s;
        int skip_every = interactive ? 1 : std::max(1, 60 / std::max(1, cfg.idle_fps));
        if (skip_every > 1 && (skip_counter++ % (unsigned)skip_every) != 0) {
            app.commit_empty(idx);
            return;
        }

        gl.make_current(o);
#ifdef CUBISM_AVAILABLE
        if (models[idx]) {
            if (!scene_ready[idx]) {
                scene.init(o.width, o.height, cfg.accent);
                scene_ready[idx] = true;
            }
            double dt = last_frame[idx] > 0 ? std::clamp(t - last_frame[idx], 0.0, 0.1) : 0.016;
            models[idx]->update(dt);
            scene.bg(o.width, o.height);
            Rect disc = models[idx]->draw((float)o.width, (float)o.height,
                                          {o.cam_zoom, o.cam_x, o.cam_y});
            Rect dmg;
            if (o.prev_bbox[0] < 0) dmg = {0, 0, o.width, o.height};
            else {
                Rect prev{o.prev_bbox[0], o.prev_bbox[1], o.prev_bbox[2], o.prev_bbox[3]};
                dmg = disc;
                dmg.unite(prev);
            }
            dmg.clamp_to(o.width, o.height);
            o.prev_bbox[0] = disc.x; o.prev_bbox[1] = disc.y;
            o.prev_bbox[2] = disc.w; o.prev_bbox[3] = disc.h;
            wl_surface_damage_buffer(o.surface, dmg.x, dmg.y, dmg.w, dmg.h);
            maybe_screenshot(o); // pre-swap: the back buffer is undefined after swap
            gl.swap_with_damage(o, dmg);
            last_frame[idx] = t;
            record_frame_ms(o);
            return;
        }
#endif
        if (!scene_ready[idx]) {
            scene.init(o.width, o.height, cfg.accent);
            scene_ready[idx] = true;
        }
        double t0 = now_s();
        (void)t0;
        Rect disc = scene.render(o.width, o.height, t, {o.cam_zoom, o.cam_x, o.cam_y});
        Rect dmg;
        if (o.prev_bbox[0] < 0) dmg = {0, 0, o.width, o.height}; // first frame: full
        else {
            Rect prev{o.prev_bbox[0], o.prev_bbox[1], o.prev_bbox[2], o.prev_bbox[3]};
            dmg = disc;
            dmg.unite(prev);
        }
        dmg.clamp_to(o.width, o.height);
        o.prev_bbox[0] = disc.x; o.prev_bbox[1] = disc.y;
        o.prev_bbox[2] = disc.w; o.prev_bbox[3] = disc.h;
        wl_surface_damage_buffer(o.surface, dmg.x, dmg.y, dmg.w, dmg.h);
        maybe_screenshot(o);
        gl.swap_with_damage(o, dmg);
        record_frame_ms(o);
    };

    auto on_ipc = [&]() {
        if (xdg) ipc.drain(on_request);
    };

    app.run(on_pointer, on_frame, xdg ? ipc.fd() : -1, on_ipc);
    LOGI("exiting");
    return 0;
}
