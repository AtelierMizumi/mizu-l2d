// Trigger recognition engine (P1-5b): pointer recognition + busy/cooldown
// policy over the normalized zone registry from zones.js. Pure JS — no PIXI,
// no DOM, no timers: every time comparison runs against the injected ctx.now()
// clock (driven from tick()/onEvent), so tests use a fake clock and the host
// drives everything from its frame loop.
//
// Gate order for every pointer fire (PARITY-PLAN Task 7 contract):
//   1. cooldown (limitTimeMs since the zone last fired)
//   2. busy (ctx.isMotionPlaying(), unless trigger type 6)
//   3. ctx.canFire(zone) (host state gate)
//   4. type-specific conditions
// A blocked pending click is dropped, not re-queued. Engine-initiated fires
// (type 10 animationPlay, xiaqi win/lose results) skip the pointer gates: they
// are scripted consequences rather than pointer events (the fixture overlays
// result triggers on cell parts and makes them watch the very groups their
// ignore lists contain, so a busy/ignore gate here could never fire).
(function (root) {
    'use strict';

    const CLICK_MOVE_TOLERANCE = 30; // model units: click move budget / drag-target radius
    const CLICK_MAX_HOLD_MS = 500;   // down->up window for a click
    const CLICK_FIRE_DELAY_MS = 100; // a click fires this long after its down
    const PARAM_EPS = 0.01;          // param equality tolerance (types 1/11)
    const LINES = [                 // the 8 xiaqi win lines over cells 1..9
        [1, 2, 3], [4, 5, 6], [7, 8, 9],
        [1, 4, 7], [2, 5, 8], [3, 6, 9],
        [1, 5, 9], [3, 5, 7],
    ];

    function finiteNumber(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    // Watched param name: skins carry `trigger.parameter` on the
    // param-conditioned types (9/11/12/13 fixtures); the contract also allows
    // `trigger.param`; the type-1 fixtures rely on the zone's own param.
    function watchedParam(trigger, zone) {
        const cands = [trigger && trigger.parameter, trigger && trigger.param, zone && zone.param];
        for (const c of cands) if (typeof c === 'string' && c) return c;
        return null;
    }

    function createTriggerEngine({ zones, ctx } = {}) {
        const zoneList = Array.isArray(zones) ? zones : [];
        const host = ctx || {};
        const now = typeof host.now === 'function' ? host.now
            : (typeof performance !== 'undefined' && typeof performance.now === 'function')
                ? () => performance.now()
                : () => Date.now();
        const paramValue = typeof host.paramValue === 'function' ? host.paramValue : () => 0;
        const isMotionPlaying = typeof host.isMotionPlaying === 'function' ? host.isMotionPlaying : () => false;
        const canFire = typeof host.canFire === 'function' ? host.canFire : () => true;
        const fire = typeof host.fire === 'function' ? host.fire : () => {};

        // ---- classification --------------------------------------------------
        const cells = [];        // type 15 board cells (trigger.index 1..9)
        const resultZones = [];  // type 16 win/lose overlays
        const animZones = [];    // type 10 animationPlay subscriptions
        const extendRules = [];  // type 12 extend-rule gating
        for (const z of zoneList) {
            if (!z || !z.trigger) continue;
            const t = z.trigger.type;
            if (t === 15 && finiteNumber(z.trigger.index) !== null) cells.push(z);
            else if (t === 16) resultZones.push(z);
            else if (t === 10) animZones.push(z);
            else if (t === 12) extendRules.push(z);
        }

        // ---- per-zone runtime ------------------------------------------------
        const rt = new Map(); // zone -> { lastFired, cycle, accum8, drag }
        function rec(z) {
            let r = rt.get(z);
            if (!r) {
                r = { lastFired: -Infinity, cycle: 0, accum8: 0, drag: null };
                rt.set(z, r);
            }
            return r;
        }
        function cooldownMs(z) {
            const n = Number(z && z.limitTimeMs);
            if (!Number.isFinite(n)) return 1000; // mirrors zones.js default
            return n > 0 ? n : 0;
        }

        // ---- pointer state ---------------------------------------------------
        let press = null;                // { zone, x0, y0, lastX, lastY, downT, firedHold, nextStep3 }
        const pendingClicks = new Map(); // zone -> fireAt (click fires 0.1 s after its down)
        let frameDrags = [];             // type-13 deltas for the window ending at the last tick
        let lastTickT = now();

        const firedLog = [];
        const board = { cells: [0, 0, 0, 0, 0, 0, 0, 0, 0], moves: 0 };

        // ---- gates + firing --------------------------------------------------
        function gatesPass(z, t) {
            const r = rec(z);
            if (t - r.lastFired < cooldownMs(z)) return false;  // 1. cooldown
            if ((z.trigger && z.trigger.type) !== 6 && isMotionPlaying()) return false; // 2. busy
            if (!canFire(z)) return false;                      // 3. state gate
            return true;                                        // 4. type-specific: caller
        }

        function doFire(z, action, t) {
            rec(z).lastFired = t;
            firedLog.push({ zoneId: z.id, action: action === undefined ? null : action, t });
            fire(z, action);
        }

        // ---- click recognition (types 2/6/15 share it) -----------------------
        // type 6 cycles its actionList per click (poke counter); entries may be
        // empty strings — fired as-is, the host/relations layer gives them meaning.
        function cycleAction(z, tr) {
            const list = Array.isArray(tr.actionList) ? tr.actionList : [];
            if (!list.length) return z.action;
            const r = rec(z);
            const step = list[r.cycle % list.length];
            r.cycle++;
            return step && typeof step.action === 'string' ? step.action : null;
        }

        function paramConditionOk(tr, z) {
            const v = paramValue(watchedParam(tr, z));
            if (tr.type === 9) {
                const lo = finiteNumber(tr.num);
                if (lo === null) return false;
                const hi = finiteNumber(tr.num2);
                return v >= lo && v < (hi === null ? Infinity : hi); // num2 absent -> lower bound only
            }
            if (Array.isArray(tr.num)) { // type 11 fixture pairs partition the range: half-open
                const lo = finiteNumber(tr.num[0]);
                const hi = finiteNumber(tr.num[1]);
                return lo !== null && hi !== null && v >= lo && v < hi;
            }
            const num = finiteNumber(tr.num); // type 11 scalar: equality +-0.01
            return num !== null && Math.abs(v - num) <= PARAM_EPS;
        }

        function fireClick(z, t) {
            const tr = z.trigger || {};
            if (!gatesPass(z, t)) return;
            if (tr.type === 15) {
                placeMark(z, t);
                return;
            }
            if ((tr.type === 9 || tr.type === 11) && !paramConditionOk(tr, z)) return;
            doFire(z, tr.type === 6 ? cycleAction(z, tr) : z.action, t);
        }

        // ---- xiaqi board (types 15/16) ---------------------------------------
        function resetBoard() {
            board.cells = [0, 0, 0, 0, 0, 0, 0, 0, 0];
            board.moves = 0;
        }

        function winLineFor(owner) {
            return LINES.some(line => line.every(i => board.cells[i - 1] === owner));
        }

        function placeMark(z, t) {
            const idx = Math.round(finiteNumber(z.trigger.index) || 0);
            if (idx < 1 || idx > 9) return;
            if (board.cells[idx - 1] !== 0) return; // occupied — swallow
            const owner = Number(z.trigger.target) === -1 ? -1 : 1; // target absent -> player
            board.cells[idx - 1] = owner;
            board.moves++;
            doFire(z, z.action, t); // fixture cells carry no trigger.action -> null
            if (winLineFor(owner)) {
                const rz = resultZones.find(w => w.trigger && w.trigger.win === (owner === 1));
                if (rz) doFire(rz, rz.action, t);
                resetBoard();
            } else if (board.moves >= 9) {
                resetBoard();
            }
        }

        // AI policy: win-if-possible -> block -> centre -> corner -> first empty.
        // Returns a cell index 1..9 (or null when full); the host dispatches the
        // click on its own AI cell zone (trigger.target === -1) for that index.
        function aiMove() {
            const c = board.cells;
            const empty = [];
            for (let i = 0; i < 9; i++) if (c[i] === 0) empty.push(i + 1);
            if (!empty.length) return null;
            const tryLine = (owner) => {
                for (const i of empty) {
                    c[i - 1] = owner;
                    const win = winLineFor(owner);
                    c[i - 1] = 0;
                    if (win) return i;
                }
                return null;
            };
            const corner = [1, 3, 7, 9].find(i => c[i - 1] === 0);
            return tryLine(-1) ?? tryLine(1) ?? (c[4] === 0 ? 5 : null) ?? (corner === undefined ? null : corner) ?? empty[0];
        }

        // ---- held-zone checks (types 1/4/7/8) --------------------------------
        function checkParamEquals(z, t) {
            const tr = z.trigger || {};
            const num = finiteNumber(tr.num);
            if (num === null) return;
            const v = paramValue(watchedParam(tr, z));
            if (Math.abs(v - num) > PARAM_EPS) return;
            if (gatesPass(z, t)) {
                press.firedHold = true; // once per hold
                doFire(z, z.action, t);
            }
        }

        // type 4 target: fixture zhenzhuhao_2 carries num as an [x, y] pair; the
        // contract's scalar shape is num/num2 (or x/y when present).
        function dragTargetOf(tr) {
            if (Array.isArray(tr.num)) {
                return { x: finiteNumber(tr.num[0]), y: finiteNumber(tr.num[1]) };
            }
            return {
                x: finiteNumber(tr.x !== undefined ? tr.x : tr.num),
                y: finiteNumber(tr.y !== undefined ? tr.y : tr.num2),
            };
        }

        function checkDragTarget(z, dx, dy, t) {
            const tgt = dragTargetOf(z.trigger || {});
            if (tgt.x === null || tgt.y === null) return;
            if (Math.hypot(dx - tgt.x, dy - tgt.y) > CLICK_MOVE_TOLERANCE) return;
            if (gatesPass(z, t)) {
                press.firedHold = true; // once per hold
                doFire(z, z.action, t);
            }
        }

        // ---- event intake ----------------------------------------------------
        function onEvent(ev, hitZone) {
            if (!ev || typeof ev.type !== 'string') return;
            const t = now(); // the injectable clock is authoritative; ev.t is not used
            if (ev.type === 'down') {
                press = hitZone ? {
                    zone: hitZone,
                    x0: ev.x, y0: ev.y, lastX: ev.x, lastY: ev.y,
                    downT: t, firedHold: false, nextStep3: 0,
                } : null;
                if (!hitZone || !hitZone.trigger) return;
                const type = hitZone.trigger.type;
                // click recognition covers 2/6 and the param-conditioned
                // clicks (9/11) and xiaqi cells (15); the type-specific
                // conditions are applied when the pending fire comes due
                if (type === 2 || type === 6 || type === 9 || type === 11 || type === 15) {
                    pendingClicks.set(hitZone, t + CLICK_FIRE_DELAY_MS);
                } else if (type === 1) {
                    checkParamEquals(hitZone, t); // contract: checked on down and in tick
                } else if (type === 4) {
                    checkDragTarget(hitZone, 0, 0, t); // the press position is drag position 0
                }
                return;
            }
            if (!press || !press.zone) return;
            const z = press.zone;
            const tr = z.trigger || {};
            if (ev.type === 'move') {
                const dx = ev.x - press.x0;
                const dy = ev.y - press.y0;
                if (tr.type === 13) {
                    const r = rec(z);
                    if (!r.drag) r.drag = { dx: 0, dy: 0 };
                    r.drag.dx += ev.x - press.lastX;
                    r.drag.dy += ev.y - press.lastY;
                }
                press.lastX = ev.x;
                press.lastY = ev.y;
                if (Math.hypot(dx, dy) > CLICK_MOVE_TOLERANCE && pendingClicks.has(z)) {
                    pendingClicks.delete(z); // it became a drag, not a click
                }
                if (tr.type === 4 && !press.firedHold) checkDragTarget(z, dx, dy, t);
                return;
            }
            if (ev.type === 'up') {
                const elapsed = t - press.downT;
                const dist = Math.hypot(ev.x - press.x0, ev.y - press.y0);
                const validClick = dist <= CLICK_MOVE_TOLERANCE && elapsed <= CLICK_MAX_HOLD_MS;
                if (pendingClicks.has(z) && !validClick) pendingClicks.delete(z); // too slow / too far
                if (tr.type === 3) {
                    const list = Array.isArray(tr.actionList) ? tr.actionList : [];
                    if (press.nextStep3 < list.length && typeof tr.last === 'string' && tr.last &&
                        gatesPass(z, t)) {
                        doFire(z, tr.last, t); // release before the list completed
                    }
                }
                if (tr.type === 8) rec(z).accum8 += elapsed; // bank this hold
                press = null;
            }
        }

        // ---- frame tick ------------------------------------------------------
        function tick(nowArg) {
            const t = typeof nowArg === 'number' ? nowArg : now();
            // 1. due click fires (0.1 s after their down; valid releases keep them pending)
            for (const [z, fireAt] of pendingClicks) {
                if (t < fireAt) continue;
                pendingClicks.delete(z);
                fireClick(z, t);
            }
            // 2. held-zone progress checks
            if (press && press.zone) {
                const z = press.zone;
                const tr = z.trigger || {};
                const held = t - press.downT;
                if (tr.type === 1 && !press.firedHold) checkParamEquals(z, t);
                if (tr.type === 3) {
                    const list = Array.isArray(tr.actionList) ? tr.actionList : [];
                    while (press.nextStep3 < list.length) {
                        const step = list[press.nextStep3];
                        const at = (finiteNumber(step && step.time) || 0) * 1000;
                        if (held < at) break;
                        press.nextStep3++; // advance even when gated — steps never retro-fire
                        if (step && typeof step.action === 'string' && step.action && gatesPass(z, t)) {
                            doFire(z, step.action, t);
                        }
                    }
                }
                if (tr.type === 7 && !press.firedHold &&
                    typeof tr.action === 'string' && tr.action &&
                    held >= (finiteNumber(tr.time) || 0) * 1000 && gatesPass(z, t)) {
                    press.firedHold = true; // continuous hold reached trigger.time
                    doFire(z, tr.action, t);
                }
                if (tr.type === 8) {
                    const r = rec(z);
                    const delta = (finiteNumber(tr.delta) || 0) * 1000; // seconds, per fixture
                    if (delta > 0 && r.accum8 + held >= delta && gatesPass(z, t)) {
                        r.accum8 = 0;    // accumulated hold resets after a fire
                        press.downT = t; // ...and the current hold starts counting anew
                        doFire(z, z.action, t);
                    }
                }
            }
            // 3. type-13 deltas accumulated since the previous tick
            frameDrags = [];
            for (const [z, r] of rt) {
                if (r.drag && (r.drag.dx !== 0 || r.drag.dy !== 0)) {
                    frameDrags.push({
                        zone: z,
                        dx: r.drag.dx,
                        dy: r.drag.dy,
                        dt: Math.max(0, t - lastTickT),
                        rate: finiteNumber(z.trigger && z.trigger.rate),
                    });
                    r.drag = { dx: 0, dy: 0 };
                }
            }
            lastTickT = t;
        }

        // ---- type 10: animationPlay subscriptions (pointer-independent) ------
        const animState = new Map(); // zone -> { key, armed, lastN }
        function setMotionProgress(info) {
            if (!info || typeof info !== 'object') return;
            const n = Number(info.normalized);
            if (!Number.isFinite(n)) return;
            const t = now();
            for (const z of animZones) {
                const tr = z.trigger || {};
                // fixture field names (meikelunbao_2): triggerName/triggerIndex/triggerRate
                const g = tr.triggerName !== undefined ? tr.triggerName : tr.name;
                const ix = tr.triggerIndex !== undefined ? tr.triggerIndex : tr.index;
                const rate = finiteNumber(tr.triggerRate !== undefined ? tr.triggerRate : tr.rate) || 0;
                const st = animState.get(z) || { key: null, armed: true, lastN: -1 };
                const key = String(info.group) + ':' + String(info.index);
                if (key !== st.key) st.armed = true;  // new stream = new chance
                else if (n < st.lastN) st.armed = true; // progress went backwards: loop restart
                st.lastN = n;
                st.key = key;
                animState.set(z, st);
                if (!st.armed || n < rate) continue;
                if (g === undefined || g === null || String(g) !== String(info.group)) continue;
                if (ix !== undefined && ix !== null && Number(ix) !== Number(info.index)) continue;
                const pr = Array.isArray(tr.parameterRange) ? tr.parameterRange : null;
                if (pr) {
                    const lo = finiteNumber(pr[0]);
                    const hi = finiteNumber(pr[1]);
                    const name = watchedParam(tr, z);
                    if (lo === null || hi === null || !name) continue;
                    const v = paramValue(name);
                    if (v < lo || v > hi) continue;
                }
                st.armed = false; // once per stream
                doFire(z, z.action, t);
            }
        }

        // ---- type 12: extend-rule gating -------------------------------------
        // While the watched param is inside trigger.num, the zone's own
        // enable/ignore lists gate actions (fixture: entry-level arrays; the
        // jinshi_2 rule ignores touch_idle1/touch_idle11 among motion groups).
        function isActionAllowed(action) {
            if (typeof action !== 'string' || !action) return true;
            const a = action.toLowerCase();
            for (const z of extendRules) {
                const tr = z.trigger || {};
                const num = Array.isArray(tr.num) ? tr.num : null;
                if (!num) continue;
                const lo = finiteNumber(num[0]);
                const hi = finiteNumber(num[1]);
                if (lo === null || hi === null) continue;
                const v = paramValue(watchedParam(tr, z));
                if (v < lo || v > hi) continue; // rule inactive outside the range
                const enable = Array.isArray(z.enable) ? z.enable : [];
                const ignore = Array.isArray(z.ignore) ? z.ignore : [];
                if (ignore.some(g => typeof g === 'string' && g.toLowerCase() === a)) return false;
                if (enable.length && !enable.some(g => typeof g === 'string' && g.toLowerCase() === a)) return false;
            }
            return true;
        }

        return {
            onEvent,
            tick,
            setMotionProgress,
            isActionAllowed,
            activeParamDrags: () => frameDrags.slice(),
            resetBoard,
            aiMove,
            stats: () => ({ fired: firedLog.slice(), board: { cells: board.cells.slice(), moves: board.moves } }),
        };
    }

    root.MizuEngine = root.MizuEngine || {};
    root.MizuEngine.createTriggerEngine = createTriggerEngine;
})(typeof window !== 'undefined' ? window : globalThis);
