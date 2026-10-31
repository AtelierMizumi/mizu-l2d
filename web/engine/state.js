// Idle-pose state machine (P1-5d): owns the state index, idle motion group,
// sequence offset and pose lifecycle bookkeeping for the drags[] engine.
// Pure bookkeeping — no PIXI/DOM, no timers; the runtime is injected via ctx and
// pendingRevert() is a queried value the host acts on (spec Hard rules:
// hold-pose states hold until the game's own revert condition).
(function (root) {
    'use strict';

    const SEQ_RE = /^touch_(drag|idle)(\d+)$/i; // pose families chained for ▶ advance
    const NUM_SUFFIX_RE = /^(.+?)(\d+)$/;

    function normalizeStateList(v) {
        if (Array.isArray(v)) return v.length ? v.map(Number) : null;
        if (typeof v === 'number' && isFinite(v)) return [v];
        return null;
    }

    // revertIdle ships as a number, true (revert to base) or a 1-element array.
    function normalizeRevertIdle(v) {
        if (typeof v === 'number' && isFinite(v)) return v;
        if (typeof v === 'string' && v !== '' && isFinite(Number(v))) return Number(v);
        if (v === true) return 0;
        if (Array.isArray(v) && v.length) {
            const n = Number(v[0]);
            if (isFinite(n)) return n;
        }
        return undefined;
    }

    root.MizuEngine = root.MizuEngine || {};

    root.MizuEngine.createStateEngine = function createStateEngine({ zones, idleMotions, ctx } = {}) {
        const zoneList = Array.isArray(zones) ? zones : [];
        const motions = idleMotions instanceof Map ? idleMotions : new Map();
        const host = ctx || {};

        const zonesByAction = new Map();
        for (const z of zoneList) {
            if (z && z.action) zonesByAction.set(String(z.action).toLowerCase(), z);
        }

        // ▶ advance chains: touch_dragN / touch_idleN walk in step order.
        const chains = new Map(); // prefix -> [{ step, action }]
        for (const z of zoneList) {
            if (!z || !z.action) continue;
            const m = SEQ_RE.exec(String(z.action));
            if (!m) continue;
            const prefix = 'touch_' + m[1].toLowerCase();
            if (!chains.has(prefix)) chains.set(prefix, []);
            chains.get(prefix).push({ step: parseInt(m[2], 10), action: z.action });
        }
        const nextActionByAction = new Map();
        for (const list of chains.values()) {
            list.sort((a, b) => a.step - b.step);
            for (let i = 0; i < list.length - 1; i++) {
                nextActionByAction.set(list[i].action.toLowerCase(), list[i + 1].action);
            }
        }

        let state = 0;
        let idleGroup = motions.get(0) || 'idle';
        let offset = { x: 0, y: 0 };
        let sequence = null; // { prefix, step, nextAction }
        let pending = null; // { state, group } — scheduled revert the host still has to play

        function baseIdleGroup() {
            return motions.get(0) || 'idle';
        }

        function pointIdleTo(group) {
            if (group === idleGroup) return;
            idleGroup = group;
            if (typeof host.setIdleGroup === 'function') host.setIdleGroup(group);
        }

        function trackSequence(action) {
            const lower = String(action).toLowerCase();
            const m = NUM_SUFFIX_RE.exec(lower);
            return {
                prefix: m ? m[1] : 'custom',
                step: m ? parseInt(m[2], 10) : 1,
                nextAction: nextActionByAction.get(lower) || null,
            };
        }

        function onActionFired(action) {
            if (action === undefined || action === null) return false;
            const zone = zonesByAction.get(String(action).toLowerCase());
            if (!zone) return false; // unknown action: state, pose and offset untouched
            pending = null; // a newly fired action supersedes any scheduled revert
            if (zone.idle === undefined || zone.idle === null) return true; // transient reaction — held pose survives
            const n = Number(zone.idle);
            sequence = trackSequence(action);
            if (n > 0) {
                state = n;
                pointIdleTo(motions.get(n) || 'idle' + n);
                offset = { x: zone.offsetX || 0, y: zone.offsetY || 0 };
            } else {
                state = 0;
                pointIdleTo(baseIdleGroup());
                offset = { x: 0, y: 0 };
            }
            return true;
        }

        function onMotionEnded(group) {
            pending = null; // a newer motion end supersedes any scheduled revert
            if (group === undefined || group === null) return;
            const zone = zonesByAction.get(String(group).toLowerCase());
            if (!zone) return;
            const n = normalizeRevertIdle(zone.revertIdle);
            if (n === undefined) return; // pose holds — host already re-pointed idle
            state = n;
            pointIdleTo(n === 0 ? baseIdleGroup() : (motions.get(n) || 'idle' + n));
            offset = { x: 0, y: 0 };
            sequence = null; // the pose lifecycle ended
            pending = { state: n, group: idleGroup };
        }

        function pendingRevert() {
            if (!pending) return null;
            const pg = typeof host.playingGroup === 'function' ? host.playingGroup() : undefined;
            if (pg !== undefined && pg !== null &&
                String(pg).toLowerCase() === String(pending.group).toLowerCase()) {
                return null; // host is already playing the revert group
            }
            return { state: pending.state, group: pending.group };
        }

        // Gate order mirrors the contract: idleOn, idleOff, ignore, ignoreAction, enable.
        function canFire(zone) {
            if (!zone) return false;
            const pgRaw = typeof host.playingGroup === 'function' ? host.playingGroup() : undefined;
            const pg = (pgRaw === undefined || pgRaw === null) ? null : String(pgRaw).toLowerCase();
            const idleOn = normalizeStateList(zone.reactCondition && zone.reactCondition.idleOn);
            if (idleOn && !idleOn.includes(state)) return false;
            const idleOff = normalizeStateList(zone.reactCondition && zone.reactCondition.idleOff);
            if (idleOff && idleOff.includes(state)) return false;
            if (pg !== null && Array.isArray(zone.ignore) &&
                zone.ignore.some(g => String(g).toLowerCase() === pg)) return false;
            if (zone.ignoreAction && pg !== null && pg !== String(idleGroup).toLowerCase()) return false;
            if (Array.isArray(zone.enable) && zone.enable.length &&
                (pg === null || !zone.enable.some(g => String(g).toLowerCase() === pg))) return false;
            return true;
        }

        function reset() {
            state = 0;
            offset = { x: 0, y: 0 };
            sequence = null;
            pending = null;
            pointIdleTo(baseIdleGroup());
        }

        function setState(n) {
            const t = Number(n);
            if (!isFinite(t)) return false;
            if (t === 0) {
                reset();
                return true;
            }
            if (!motions.has(t)) return false;
            state = t;
            idleGroup = motions.get(t);
            offset = { x: 0, y: 0 };
            sequence = null;
            pending = null;
            if (typeof host.setIdleGroup === 'function') host.setIdleGroup(idleGroup);
            if (typeof host.playMotion === 'function') host.playMotion(idleGroup);
            return true;
        }

        function describe() {
            return {
                state,
                idleGroup,
                offset: { x: offset.x, y: offset.y },
                sequence: sequence ? { prefix: sequence.prefix, step: sequence.step, nextAction: sequence.nextAction } : null,
                pendingRevert: pendingRevert(),
            };
        }

        return {
            onActionFired,
            onMotionEnded,
            current: () => state,
            idleGroup: () => idleGroup,
            sequenceOffset: () => ({ x: offset.x, y: offset.y }),
            canFire,
            pendingRevert,
            reset,
            setState,
            describe,
        };
    };
})(typeof window !== 'undefined' ? window : globalThis);
