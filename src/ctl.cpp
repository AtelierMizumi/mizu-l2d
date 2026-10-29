// ctl.cpp — mizu-l2d-ctl: send one JSON-lines command to the daemon socket.
#include <sys/socket.h>
#include <sys/un.h>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <string>

int main(int argc, char **argv) {
    // argv[1..] joined into: {"cmd":"<argv1>","<argv2>":<value>...}
    // supported: ping | status | perf | camera [zoom N | pos X Y | reset] | motion GROUP
    if (argc < 2) {
        fprintf(stderr, "usage: mizu-l2d-ctl ping|status|perf|camera [zoom N|pos X Y|reset]|motion GROUP\n");
        return 2;
    }
    std::string cmd = argv[1];
    std::string line = "{\"cmd\":\"" + cmd + "\"";
    if (cmd == "camera" && argc >= 3) {
        if (!strcmp(argv[2], "zoom") && argc >= 4) line += ",\"zoom\":" + std::string(argv[3]);
        else if (!strcmp(argv[2], "pos") && argc >= 5)
            line += std::string(",\"pos\":[") + argv[3] + "," + argv[4] + "]";
        else if (!strcmp(argv[2], "reset")) line += ",\"reset\":true";
    } else if (cmd == "motion" && argc >= 3) {
        line += ",\"group\":\"" + std::string(argv[2]) + "\"";
    }
    line += "}";

    const char *xdg = getenv("XDG_RUNTIME_DIR");
    if (!xdg) { fprintf(stderr, "XDG_RUNTIME_DIR not set\n"); return 1; }
    std::string path = std::string(xdg) + "/mizu-l2d.sock";

    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) { perror("socket"); return 1; }
    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", path.c_str());
    if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("connect (daemon not running?)");
        return 1;
    }
    std::string out = line + "\n";
    send(fd, out.c_str(), out.size(), 0);
    char buf[4096];
    ssize_t n = recv(fd, buf, sizeof buf - 1, 0);
    if (n > 0) fwrite(buf, 1, (size_t)n, stdout);
    return 0;
}
