// ipc.cpp — unix socket server + flat JSON. Requests are newline-terminated
// JSON objects; responses likewise. Socket lives in $XDG_RUNTIME_DIR, 0600.
#include "ipc.hpp"
#include "common.hpp"

#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>
#include <cstring>
#include <cstdio>
#include <vector>

// --------------------------------------------------------------------- Json

namespace {
struct Tok {
    std::string key;
    std::string str;
    double num = 0;
    bool b = false;
    std::vector<double> arr;
    Json::Type type = Json::Type::None;
};

void skip_ws(const std::string &s, size_t &i) {
    while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++;
}
std::string parse_string(const std::string &s, size_t &i, bool &ok) {
    if (s[i] != '"') { ok = false; return {}; }
    i++;
    std::string out;
    while (i < s.size() && s[i] != '"') {
        if (s[i] == '\\' && i + 1 < s.size()) { i++; }
        out += s[i++];
    }
    if (i >= s.size()) { ok = false; return {}; }
    i++;
    return out;
}
} // namespace

Json Json::parse(const std::string &line, bool *ok) {
    Json j;
    size_t i = 0;
    *ok = true;
    skip_ws(line, i);
    if (i >= line.size() || line[i] != '{') { *ok = false; return j; }
    i++;
    while (true) {
        skip_ws(line, i);
        if (i < line.size() && line[i] == '}') break;
        std::string key = parse_string(line, i, *ok);
        if (!*ok) return j;
        skip_ws(line, i);
        if (i >= line.size() || line[i] != ':') { *ok = false; return j; }
        i++;
        skip_ws(line, i);
        if (i < line.size() && line[i] == '"') {
            j.set(key, parse_string(line, i, *ok));
        } else if (i < line.size() && (line[i] == '[')) {
            i++;
            std::vector<double> arr;
            while (i < line.size() && line[i] != ']') {
                if (line[i] == ',') { i++; continue; }
                char *end = nullptr;
                double v = strtod(line.c_str() + i, &end);
                if (end == line.c_str() + i) { *ok = false; return j; }
                arr.push_back(v);
                i = end - line.c_str();
            }
            i++; // ']'
            j.set(key, arr);
        } else if (i < line.size() && !strncmp(line.c_str() + i, "true", 4)) {
            j.set(key, true); i += 4;
        } else if (i < line.size() && !strncmp(line.c_str() + i, "false", 5)) {
            j.set(key, false); i += 5;
        } else if (i < line.size() && (isdigit((unsigned char)line[i]) || line[i] == '-')) {
            char *end = nullptr;
            double v = strtod(line.c_str() + i, &end);
            i = end - line.c_str();
            j.set(key, v);
        } else if (i < line.size() && !strncmp(line.c_str() + i, "null", 4)) {
            i += 4;
        } else {
            *ok = false; return j;
        }
        skip_ws(line, i);
        if (i < line.size() && line[i] == ',') { i++; continue; }
        if (i < line.size() && line[i] == '}') break;
        if (i >= line.size()) { *ok = false; return j; }
    }
    return j;
}

bool Json::has(const std::string &key) const {
    for (auto &p : pairs_) if (p.key == key) return true;
    return false;
}
std::string Json::get_str(const std::string &key, const std::string &def) const {
    for (auto &p : pairs_) if (p.key == key && p.type == Type::String) return p.str;
    return def;
}
double Json::get_num(const std::string &key, double def) const {
    for (auto &p : pairs_) if (p.key == key && p.type == Type::Number) return p.nums[0];
    return def;
}
bool Json::get_bool(const std::string &key, bool def) const {
    for (auto &p : pairs_) if (p.key == key && p.type == Type::Bool) return p.nums[0] != 0;
    return def;
}
std::vector<double> Json::get_arr(const std::string &key) const {
    for (auto &p : pairs_) if (p.key == key && p.type == Type::NumberArray) return p.nums;
    return {};
}

std::string Json::serialize() const {
    std::string out = "{";
    bool first = true;
    for (auto &p : pairs_) {
        if (!first) out += ",";
        first = false;
        out += "\"" + p.key + "\":";
        switch (p.type) {
        case Type::String: out += "\"" + p.str + "\""; break;
        case Type::Number: { char b[40]; snprintf(b, sizeof b, "%.4g", p.nums[0]); out += b; break; }
        case Type::Bool: out += p.nums[0] ? "true" : "false"; break;
        case Type::NumberArray: {
            out += "[";
            for (size_t i = 0; i < p.nums.size(); i++) {
                char b[40]; snprintf(b, sizeof b, "%.4g", p.nums[i]);
                out += b;
                if (i + 1 < p.nums.size()) out += ",";
            }
            out += "]";
            break;
        }
        default: break;
        }
    }
    out += "}";
    return out;
}

// ------------------------------------------------------------------- server

bool IpcServer::listen(const std::string &runtime_dir, const std::string &socket_name) {
    std::string path = runtime_dir + "/" + socket_name;
    listen_fd_ = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    if (listen_fd_ < 0) { LOGE("socket() failed"); return false; }
    unlink(path.c_str()); // stale socket from a crashed previous run
    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", path.c_str());
    if (bind(listen_fd_, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        LOGE("bind %s failed", path.c_str());
        return false;
    }
    chmod(path.c_str(), 0600);
    if (::listen(listen_fd_, 4) < 0) { LOGE("listen failed"); return false; }
    LOGI("ipc: listening on %s", path.c_str());
    return true;
}

void IpcServer::drain(const Handler &on_request) {
    // accept everything pending; each client sends one request, gets one reply
    while (true) {
        int c = accept4(listen_fd_, nullptr, nullptr, SOCK_CLOEXEC);
        if (c < 0) break;
        std::string buf;
        char tmp[1024];
        ssize_t n;
        bool done = false;
        while (!done && (n = recv(c, tmp, sizeof tmp - 1, 0)) > 0) {
            buf.append(tmp, n);
            if (buf.find('\n') != std::string::npos) done = true;
            if (buf.size() > 64 * 1024) break; // abuse guard
        }
        std::string line = buf.substr(0, buf.find('\n'));
        bool ok = false;
        Json req = Json::parse(line, &ok);
        std::string resp = ok ? on_request(req)
                              : std::string("{\"ok\":false,\"error\":\"bad json\"}");
        resp += "\n";
        (void)!::send(c, resp.c_str(), resp.size(), MSG_NOSIGNAL);
        close(c);
    }
}
