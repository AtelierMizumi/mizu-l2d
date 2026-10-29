// ipc.hpp — JSON-lines unix-socket control server (flat JSON v0).
#pragma once

#include <functional>
#include <string>

class IpcServer {
public:
    // Request handler: receives the parsed command (flat key/value pairs),
    // returns the JSON response body (without trailing newline).
    using Handler = std::function<std::string(const class Json &)>;

    bool listen(const std::string &xdg_runtime_dir, const std::string &socket_name);
    int fd() const { return listen_fd_; }
    void drain(const Handler &on_request); // accept + serve all pending clients

private:
    int listen_fd_ = -1;
};

// Minimal flat-JSON value container: string | number | bool, plus
// number arrays. Enough for v0 control commands; no nesting.
class Json {
public:
    enum class Type { String, Number, Bool, NumberArray, None };

    static Json parse(const std::string &line, bool *ok);
    bool has(const std::string &key) const;
    std::string get_str(const std::string &key, const std::string &def = {}) const;
    double get_num(const std::string &key, double def = 0) const;
    bool get_bool(const std::string &key, bool def = false) const;
    std::vector<double> get_arr(const std::string &key) const;

    void set(const std::string &key, const std::string &v) { pairs_.push_back({key, v, Type::String, {}}); }
    void set(const std::string &key, double v) { pairs_.push_back({key, {}, Type::Number, {v}}); }
    void set(const std::string &key, bool v) { pairs_.push_back({key, {}, Type::Bool, {(double)v}}); }
    void set(const std::string &key, const std::vector<double> &v) {
        pairs_.push_back({key, {}, Type::NumberArray, v});
    }
    std::string serialize() const;

private:
    struct Pair {
        std::string key, str;
        Type type = Type::None;
        std::vector<double> nums;
    };
    std::vector<Pair> pairs_;
};
