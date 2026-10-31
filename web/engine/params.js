// Engine module 3/4 (PARITY-PLAN Task 8): parameter drag writer, relations
// (101-104) and listener bands/change hooks. Pure logic — no PIXI, no DOM, no
// timers: all easing runs inside tick() on the caller's dt and the clock is
// injected via ctx.now(). Zones come from zones.js (raw drags[] entries with
// null-ed missing numerics also work — every zone field is read defensively).
//
// Documented interpretations (fixture evidence in .superpowers/sdd/PARITY-PLAN/
// task8-report.md):
// - dragDirect 1 = horizontal, 2 = vertical; zone-level mode 2 follows the same
//   1=x/2=y convention (luoma_2 dragDirect 2, banerwei_3/xinzexi_3/tiancheng_3
//   dragDirect 1, yuanchou_3 TouchFa mode 2).
// - rangeAbs deltas are absolute param units; without rangeAbs the px delta is
//   normalized by ctx.dragSpanPx (default 100 px = one full unit) — Task 11's
//   probe calibrates the real span.
// - relation 101/102 write the normalized drag offset in [-1,1] (all fixture
//   101/102 relations carry only {name, type} and sit on zones with range
//   [-1,1]); relation 103 writes values[actionIndex] (all three fixture 103
//   relations are self-referential and paired with type-6 actionList triggers,
//   so they are sequence-driven, not drag-driven); 104 is inferred (no fixture).
// - listener change: mode 1 = rising edge to >= value, mode 2 = falling edge to
//   <= value (jinshi_2/suweiaitongmeng_3 fixtures); listener apply.bands fires
//   ctx.setIdleByIndex once per band entry, with load-time membership as a
//   silent baseline.
(function (root) {
    'use strict';

    const SETTLE_EPS = 1e-5;       // snap easing to the target inside this band
    const DEFAULT_DRAG_SPAN = 100; // px mapped to one normalized unit when the zone is not rangeAbs

    function isFiniteNum(v) {
        return typeof v === 'number' && Number.isFinite(v);
    }

    function clamp(v, lo, hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    function clampRange(v, r) {
        return Array.isArray(r) && r.length >= 2 ? clamp(v, Math.min(r[0], r[1]), Math.max(r[0], r[1])) : v;
    }

    function snapTo(steps, v) {
        let best = steps[0];
        for (const s of steps) {
            if (isFiniteNum(s) && Math.abs(s - v) < Math.abs(best - v)) best = s;
        }
        return best;
    }

    function approach(v, target, smooth, dtSec) {
        if (!isFiniteNum(smooth) || smooth <= 0) return target; // snap
        const k = Math.min(1, dtSec / smooth);
        let next = v + (target - v) * k;
        if (Math.abs(target - next) <= SETTLE_EPS) next = target;
        return next;
    }

    function createParamEngine({ zones, core, ctx } = {}) {
        const zoneList = Array.isArray(zones) ? zones : [];
        const state = new Map();       // zone object -> runtime state
        const writerByParam = new Map(); // param name -> state (for relation write sync)

        function stateFor(zone) {
            let st = state.get(zone);
            if (!st) {
                st = {
                    zone,
                    writable: false,     // core reported a finite value for zone.param
                    dragging: false,
                    startX: 0, startY: 0, lastX: 0, lastY: 0,
                    startValue: 0, target: 0, current: 0,
                    revertGateStep: null, // revertActionIndex: actionIndex() recorded at dragEnd
                    lastBand: null,       // listener band index the param currently sits in
                    prevListener: null,   // listener crossing baseline
                    rel104: new Map(),    // relation object -> { stableSince, written }
                };
                state.set(zone, st);
                if (typeof zone.param === 'string' && zone.param) writerByParam.set(zone.param, st);
            }
            return st;
        }

        // Ticks only touch zones that carry a param, a listener or relations.
        function ensureState(zone) {
            const hasParam = typeof zone.param === 'string' && zone.param;
            if (!hasParam && !zone.listener && !(Array.isArray(zone.relations) && zone.relations.length)) return null;
            return stateFor(zone);
        }

        function spanPx() {
            return isFiniteNum(ctx.dragSpanPx) && ctx.dragSpanPx > 0 ? ctx.dragSpanPx : DEFAULT_DRAG_SPAN;
        }

        function dragTarget(zone, st) {
            const vertical = zone.dragDirect === 2 || zone.mode === 2;
            let delta = vertical ? st.lastY - st.startY : st.lastX - st.startX;
            if (isFiniteNum(zone.rate) && zone.rate > 0) delta *= zone.rate;
            if (Array.isArray(zone.range) && !zone.rangeAbs) delta /= spanPx(); // normalized units
            let v = st.startValue + delta;
            v = clampRange(v, zone.range);
            if (Array.isArray(zone.snap) && zone.snap.length && zone.snapMode === 2) {
                v = snapTo(zone.snap, v); // continuous detents (wuzang_3 shape)
            }
            return v;
        }

        function onDragStart(zone, x, y) {
            const st = stateFor(zone);
            st.dragging = true;
            st.startX = st.lastX = x;
            st.startY = st.lastY = y;
            st.revertGateStep = null;
            if (typeof zone.param === 'string' && zone.param) {
                const cur = core.getParam(zone.param);
                if (isFiniteNum(cur)) {
                    st.writable = true;
                    st.startValue = cur;
                    st.current = cur;
                    st.target = cur;
                } else {
                    st.writable = false; // unknown param: the drag is a no-op
                }
            } else {
                st.writable = false; // param-less zone: relations may still follow the drag
            }
        }

        function onDragMove(zone, x, y, dt) {
            void dt; // easing lives in tick()
            const st = state.get(zone);
            if (!st || !st.dragging) return;
            st.lastX = x;
            st.lastY = y;
            if (st.writable) st.target = dragTarget(zone, st);
        }

        function onDragEnd(zone) {
            const st = state.get(zone);
            if (!st || !st.dragging) return;
            st.dragging = false;
            if (!st.writable) return;
            let target = st.target;
            if (Array.isArray(zone.snap) && zone.snap.length && zone.snapMode !== 2) {
                target = snapTo(zone.snap, target); // snap-on-release detents
            }
            const revert = isFiniteNum(zone.revert) ? zone.revert : -1;
            if (revert >= 0) {
                target = revert;
                // revertActionIndex: boolean true gates against the step at release;
                // a number gates against that step (qiye_10 ships `true`).
                st.revertGateStep = zone.revertActionIndex
                    ? (isFiniteNum(zone.revertActionIndex) ? zone.revertActionIndex : ctx.actionIndex())
                    : null;
            } else {
                st.revertGateStep = null;
            }
            st.target = target;
        }

        function bandIndex(listener, cur) {
            const bands = listener.apply && Array.isArray(listener.apply.bands) ? listener.apply.bands : null;
            if (!bands) return null;
            for (let i = 0; i < bands.length; i++) {
                const b = bands[i];
                if (Array.isArray(b) && b.length >= 2 && cur >= b[0] && cur <= b[1]) return i;
            }
            return null;
        }

        function fireChange(entry) {
            if (typeof ctx.onListenerChange === 'function') ctx.onListenerChange(entry);
            else if (typeof ctx.onAction === 'function') ctx.onAction(entry.keys);
        }

        function evalListener(zone, st, cur) {
            const listener = zone.listener;
            if (st.prevListener === null) {
                // Baseline on first observation: load-time band membership is not a crossing.
                st.prevListener = cur;
                st.lastBand = bandIndex(listener, cur);
                return;
            }
            const prev = st.prevListener;
            st.prevListener = cur;
            const bi = bandIndex(listener, cur);
            if (bi !== st.lastBand) {
                st.lastBand = bi;
                if (bi !== null && typeof ctx.setIdleByIndex === 'function') {
                    ctx.setIdleByIndex(listener.apply.bands[bi][2]);
                }
            }
            const changes = Array.isArray(listener.change) ? listener.change : [];
            for (const entry of changes) {
                if (!isFiniteNum(entry.value)) continue;
                const hit = entry.mode === 2
                    ? prev > entry.value && cur <= entry.value
                    : prev < entry.value && cur >= entry.value;
                if (hit) fireChange(entry);
            }
        }

        function tick(dtMs) {
            const dtSec = (isFiniteNum(dtMs) && dtMs > 0 ? dtMs : 0) / 1000;
            for (const zone of zoneList) {
                const st = ensureState(zone);
                if (!st) continue;
                if (st.writable) {
                    if (st.dragging) {
                        const next = approach(st.current, st.target, zone.smooth, dtSec);
                        if (next !== st.current) {
                            st.current = next;
                            core.setParam(zone.param, st.current);
                        }
                    } else if (Math.abs(st.target - st.current) > SETTLE_EPS) {
                        // Reverting. revertActionIndex gate: skip while the current
                        // actionList step differs from the recorded one (the game
                        // re-triggers the param via the action instead).
                        if (st.revertGateStep === null || ctx.actionIndex() === st.revertGateStep) {
                            const next = approach(st.current, st.target, zone.revertSmooth, dtSec);
                            if (next !== st.current) {
                                st.current = next;
                                core.setParam(zone.param, st.current);
                            }
                        }
                    }
                }
                if (zone.listener && typeof zone.param === 'string' && zone.param) {
                    const cur = core.getParam(zone.param);
                    if (isFiniteNum(cur)) evalListener(zone, st, cur);
                }
            }
        }

        // A 103 write must not be undone by the writer's own easing on the same param.
        function syncWriter(name, v) {
            const st = writerByParam.get(name);
            if (st && st.writable) {
                st.current = v;
                st.target = v;
            }
        }

        function applyRelations(now) {
            const t = isFiniteNum(now) ? now : (typeof ctx.now === 'function' ? ctx.now() : 0);
            const step = typeof ctx.actionIndex === 'function' ? ctx.actionIndex() : -1;
            for (const zone of zoneList) {
                const rels = Array.isArray(zone.relations) ? zone.relations : null;
                if (!rels || !rels.length) continue;
                const st = stateFor(zone);
                const dragging = st.dragging;
                const reverting = st.writable && !st.dragging && Math.abs(st.target - st.current) > SETTLE_EPS;
                for (const rel of rels) {
                    if (!rel || typeof rel.name !== 'string' || !rel.name) continue;
                    if (rel.type === 101 || rel.type === 102) {
                        if (!dragging) { st.rel104.delete(rel); continue; }
                        const from = rel.type === 101 ? st.lastX - st.startX : st.lastY - st.startY;
                        let v = clamp(from / spanPx(), -1, 1);
                        v = clampRange(v, rel.range);
                        core.setParam(rel.name, v);
                    } else if (rel.type === 103) {
                        // Sequence-driven: needs a live actionList step.
                        if (step < 0) continue;
                        const vals = Array.isArray(rel.values) ? rel.values : null;
                        if (!vals || !vals.length) continue;
                        const v = vals[clamp(step, 0, vals.length - 1)];
                        if (!isFiniteNum(v)) continue;
                        core.setParam(rel.name, clampRange(v, rel.range));
                        syncWriter(rel.name, clampRange(v, rel.range));
                    } else if (rel.type === 104) {
                        // Inferred shape (no fixture sample): { delay, value } — write
                        // value once after the zone has been stable (not dragging,
                        // not reverting) for delay ms.
                        if (!isFiniteNum(rel.value)) continue;
                        const stable = !dragging && !reverting;
                        let track = st.rel104.get(rel);
                        if (!stable) {
                            st.rel104.set(rel, { stableSince: null, written: false });
                            continue;
                        }
                        if (!track) {
                            st.rel104.set(rel, { stableSince: t, written: false });
                        } else if (!track.written && t - track.stableSince >= (isFiniteNum(rel.delay) ? rel.delay : 0)) {
                            core.setParam(rel.name, clampRange(rel.value, rel.range));
                            track.written = true;
                        }
                    }
                }
            }
        }

        function activeCount() {
            let n = 0;
            for (const st of state.values()) {
                if (st.writable && (st.dragging || Math.abs(st.target - st.current) > SETTLE_EPS)) n++;
            }
            return n;
        }

        // Type-5 constFit zones: host calls on action start/end; the constFit
        // idle->target mapping itself stays with the host/state engine.
        function applyVisibility(zone, active) {
            const list = zone && zone.trigger && Array.isArray(zone.trigger.removeComList)
                ? zone.trigger.removeComList
                : null;
            if (!list || typeof core.setPartOpacity !== 'function') return;
            for (const name of list) {
                if (typeof name === 'string' && name) core.setPartOpacity(name, active ? 0 : 1);
            }
        }

        return { onDragStart, onDragMove, onDragEnd, tick, applyRelations, activeCount, applyVisibility };
    }

    root.MizuEngine = root.MizuEngine || {};
    root.MizuEngine.createParamEngine = createParamEngine;
})(typeof window !== 'undefined' ? window : globalThis);
