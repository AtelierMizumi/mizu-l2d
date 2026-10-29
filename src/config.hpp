// config.hpp — runtime configuration (TOML).
#pragma once

#include <string>

struct Config {
    // paths
    std::string config_path;   // resolved config file (may not exist -> defaults)
    std::string model_path;    // model dir (unused until the Cubism runtime lands)
    std::string socket_name = "mizu-l2d.sock"; // inside $XDG_RUNTIME_DIR

    // render
    int idle_fps = 30;
    double quiet_time_s = 5.0;

    // interaction (model runtime)
    bool tracking = true;
    float model_fit = 0.92f;     // character bbox height / viewport height at zoom 1
    float head_fraction = 0.34f; // top fraction of bbox counting as head
    float special_after = 4.0f;
    float cooldown_head = 4.0f, cooldown_body = 6.0f, cooldown_special = 30.0f;

    // placeholder scene accent
    float accent[3] = {0.831f, 0.690f, 0.416f}; // AL gold

    // Load config from the default location (or the given override). Missing
    // file is fine: defaults are kept, and config_path records what was read.
    static Config load(const std::string &path_override = {});
};
