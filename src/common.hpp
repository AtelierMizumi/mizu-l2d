// common.hpp — shared small utilities for mizu-l2d.
#pragma once

#include <cstdio>
#include <ctime>

#define LOGI(...) do { fprintf(stdout, "[mizu-l2d] " __VA_ARGS__); fputc('\n', stdout); } while (0)
#define LOGW(...) do { fprintf(stderr, "[mizu-l2d][W] " __VA_ARGS__); fputc('\n', stderr); } while (0)
#define LOGE(...) do { fprintf(stderr, "[mizu-l2d][E] " __VA_ARGS__); fputc('\n', stderr); } while (0)

inline double now_s() {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec / 1e9;
}

// Axis-aligned rect in buffer pixel coordinates, top-left origin.
struct Rect {
    int x = 0, y = 0, w = 0, h = 0;
    bool empty() const { return w <= 0 || h <= 0; }
    void unite(const Rect &o) {
        if (o.empty()) return;
        if (empty()) { *this = o; return; }
        int x0 = x < o.x ? x : o.x, y0 = y < o.y ? y : o.y;
        int x1 = (x + w) > (o.x + o.w) ? (x + w) : (o.x + o.w);
        int y1 = (y + h) > (o.y + o.h) ? (y + h) : (o.y + o.h);
        x = x0; y = y0; w = x1 - x0; h = y1 - y0;
    }
    void clamp_to(int bw, int bh) {
        if (x < 0) { w += x; x = 0; }
        if (y < 0) { h += y; y = 0; }
        if (x + w > bw) w = bw - x;
        if (y + h > bh) h = bh - y;
        if (w < 0) w = 0;
        if (h < 0) h = 0;
    }
};
