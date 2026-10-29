/* vptr-click — test-only virtual pointer for R2a.2 (wallpaper input check).
 *
 * Moves a zwlr virtual pointer onto one output and clicks, so the wallpaper
 * surface gets real pointer enter/motion/press/release from the compositor.
 * Usage: vptr-click <connector> <x> <y> [hold_ms]
 *   connector  e.g. eDP-1 or HDMI-A-1 (wl_output name)
 *   x, y       output-local logical px (scale 1 assumed)
 * Not part of the product. Built against build/protocols/ from the main build.
 */
#define _GNU_SOURCE
#include <linux/input-event-codes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <wayland-client.h>
#include <wayland-client-protocol.h>
#include "wlr-virtual-pointer-unstable-v1-client-protocol.h"

#define MAX_OUTS 8

struct out {
    struct wl_output *wl;
    char name[64];
    int32_t x, y, w, h;
};

static struct out outs[MAX_OUTS];
static int nouts;
static struct wl_seat *seat;
static struct zwlr_virtual_pointer_manager_v1 *mgr;

static void out_geometry(void *data, struct wl_output *o, int32_t x, int32_t y,
                         int32_t pw, int32_t ph, int32_t sub, const char *make,
                         const char *model, int32_t transform) {
    struct out *s = data;
    (void)o; (void)pw; (void)ph; (void)sub; (void)make; (void)model; (void)transform;
    s->x = x;
    s->y = y;
}

static void out_mode(void *data, struct wl_output *o, uint32_t flags, int32_t w,
                     int32_t h, int32_t refresh) {
    struct out *s = data;
    (void)o; (void)refresh;
    if (flags & WL_OUTPUT_MODE_CURRENT) {
        s->w = w;
        s->h = h;
    }
}

static void out_done(void *data, struct wl_output *o) { (void)data; (void)o; }
static void out_scale(void *data, struct wl_output *o, int32_t f) { (void)data; (void)o; (void)f; }

static void out_name(void *data, struct wl_output *o, const char *name) {
    struct out *s = data;
    (void)o;
    snprintf(s->name, sizeof s->name, "%s", name);
}

static void out_description(void *data, struct wl_output *o, const char *d) {
    (void)data; (void)o; (void)d;
}

static const struct wl_output_listener out_listener = {
    .geometry = out_geometry,
    .mode = out_mode,
    .done = out_done,
    .scale = out_scale,
    .name = out_name,
    .description = out_description,
};

static void registry_global(void *data, struct wl_registry *reg, uint32_t name,
                            const char *iface, uint32_t version) {
    (void)data;
    if (!strcmp(iface, wl_seat_interface.name)) {
        seat = wl_registry_bind(reg, name, &wl_seat_interface, 1);
    } else if (!strcmp(iface, wl_output_interface.name) && nouts < MAX_OUTS) {
        struct out *s = &outs[nouts++];
        uint32_t v = version < 4 ? version : 4;
        s->wl = wl_registry_bind(reg, name, &wl_output_interface, v);
        wl_output_add_listener(s->wl, &out_listener, s);
    } else if (!strcmp(iface, zwlr_virtual_pointer_manager_v1_interface.name)) {
        /* create_virtual_pointer_with_output needs manager version 2 */
        mgr = wl_registry_bind(reg, name, &zwlr_virtual_pointer_manager_v1_interface,
                               version < 2 ? version : 2);
    }
}

static void registry_remove(void *data, struct wl_registry *reg, uint32_t name) {
    (void)data; (void)reg; (void)name;
}

static const struct wl_registry_listener registry_listener = {
    .global = registry_global,
    .global_remove = registry_remove,
};

int main(int argc, char **argv) {
    if (argc < 4) {
        fprintf(stderr, "usage: %s <connector> <x> <y> [hold_ms]\n", argv[0]);
        return 1;
    }
    const char *want = argv[1];
    int32_t x = atoi(argv[2]), y = atoi(argv[3]);
    useconds_t hold = (argc > 4 ? atoi(argv[4]) : 150) * 1000u;

    struct wl_display *disp = wl_display_connect(NULL);
    if (!disp) {
        fprintf(stderr, "no wayland display\n");
        return 1;
    }
    struct wl_registry *reg = wl_display_get_registry(disp);
    wl_registry_add_listener(reg, &registry_listener, NULL);
    wl_display_roundtrip(disp);
    wl_display_roundtrip(disp); /* wl_output name/mode events arrive after bind */

    struct out *target = NULL;
    for (int i = 0; i < nouts; i++)
        if (!strcmp(outs[i].name, want)) target = &outs[i];
    if (!target || !seat || !mgr) {
        fprintf(stderr, "output %s not found (outputs: %d, seat: %p, vpm: %p)\n",
                want, nouts, (void *)seat, (void *)mgr);
        return 1;
    }
    printf("target %s %dx%d at %d,%d\n", target->name, target->w, target->h,
           target->x, target->y);

    struct zwlr_virtual_pointer_v1 *vp =
        zwlr_virtual_pointer_manager_v1_create_virtual_pointer_with_output(mgr, seat, target->wl);
    /* motion over the surface first, so the compositor sends enter + motion */
    zwlr_virtual_pointer_v1_motion_absolute(vp, 0, x, y, target->w, target->h);
    zwlr_virtual_pointer_v1_frame(vp);
    wl_display_roundtrip(disp);
    usleep(300 * 1000);

    zwlr_virtual_pointer_v1_button(vp, 1, BTN_LEFT, WL_POINTER_BUTTON_STATE_PRESSED);
    zwlr_virtual_pointer_v1_frame(vp);
    wl_display_roundtrip(disp);
    usleep(hold);
    zwlr_virtual_pointer_v1_button(vp, 2, BTN_LEFT, WL_POINTER_BUTTON_STATE_RELEASED);
    zwlr_virtual_pointer_v1_frame(vp);
    wl_display_roundtrip(disp);

    printf("clicked %s at %d,%d\n", target->name, x, y);
    zwlr_virtual_pointer_v1_destroy(vp);
    wl_display_roundtrip(disp);
    wl_display_disconnect(disp);
    return 0;
}
