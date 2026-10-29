// config.cpp — TOML config loading via tomlplusplus.
#include "config.hpp"
#include "common.hpp"

#include <unistd.h>
#include <cstdlib>
#include <toml++/toml.hpp>

Config Config::load(const std::string &path_override) {
    Config c;
    const char *home = getenv("HOME");
    std::string def = home ? std::string(home) + "/.config/mizu-l2d/config.toml"
                           : "config.toml";
    c.config_path = path_override.empty() ? def : path_override;

    if (access(c.config_path.c_str(), R_OK) != 0) {
        LOGI("config: %s not found, using defaults", c.config_path.c_str());
        return c;
    }
    try {
        auto tbl = toml::parse_file(c.config_path);
        if (auto v = tbl["model"]["path"].value<std::string>()) c.model_path = *v;
        if (auto v = tbl["ipc"]["socket"].value<std::string>()) c.socket_name = *v;
        c.idle_fps = tbl["render"]["idle_fps"].value_or(c.idle_fps);
        c.quiet_time_s = tbl["render"]["quiet_time_s"].value_or(c.quiet_time_s);
        c.tracking = tbl["interaction"]["tracking"].value_or(c.tracking);
        c.model_fit = tbl["model"]["fit"].value_or(c.model_fit);
        c.head_fraction = tbl["interaction"]["head_fraction"].value_or(c.head_fraction);
        c.special_after = tbl["interaction"]["special_after"].value_or(c.special_after);
        c.cooldown_head = tbl["interaction"]["cooldown_head"].value_or(c.cooldown_head);
        c.cooldown_body = tbl["interaction"]["cooldown_body"].value_or(c.cooldown_body);
        c.cooldown_special = tbl["interaction"]["cooldown_special"].value_or(c.cooldown_special);
        if (!c.model_path.empty() && c.model_path[0] == '~' && home) {
            c.model_path = std::string(home) + c.model_path.substr(1);
        }
        if (auto arr = tbl["placeholder"]["accent"].as_array()) {
            int i = 0;
            for (auto &&e : *arr) {
                if (i >= 3) break;
                c.accent[i++] = (float)e.value_or(0.0);
            }
        }
        LOGI("config: %s (idle_fps=%d quiet_time=%.1fs model='%s')",
             c.config_path.c_str(), c.idle_fps, c.quiet_time_s, c.model_path.c_str());
    } catch (const toml::parse_error &e) {
        LOGW("config parse failed (%s), using defaults", c.config_path.c_str());
    }
    return c;
}
