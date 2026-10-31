// Engine module 1/4 (PARITY-PLAN Task 6): normalize skins.json drags[] into
// the zone registry every other engine module consumes. Pure data — no PIXI,
// no DOM, no fetch. Loaded as a classic script before main.js; the dual-env
// root also lets node:test load it directly.
(function (root) {
    'use strict';

    const KNOWN_TRIGGER_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16]);

    function num(v) {
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
    }

    function normalize(entry, drawableIds) {
        const trigger = entry.trigger && typeof entry.trigger === 'object' ? entry.trigger : null;
        const type = trigger ? trigger.type : undefined;
        const resolvable = typeof entry.part === 'string' && drawableIds.indexOf(entry.part) !== -1;
        const param = typeof entry.param === 'string' && entry.param !== 'empty' && entry.param !== '' ? entry.param : null;
        const limitTime = num(entry.limitTime);
        const zone = {
            id: entry.id ?? null,
            part: entry.part ?? null,
            partIndex: resolvable ? drawableIds.indexOf(entry.part) : -1,
            meshIndices: resolvable ? [drawableIds.indexOf(entry.part)] : [],
            action: trigger && typeof trigger.action === 'string' ? trigger.action : null,
            trigger,
            inert: !trigger || !KNOWN_TRIGGER_TYPES.has(type),
            idle: entry.idle ?? null,
            param,
            range: Array.isArray(entry.range) ? entry.range : null,
            rangeAbs: entry.rangeAbs ?? null,
            smooth: num(entry.smooth),
            revertSmooth: num(entry.revertSmooth),
            revert: num(entry.revert),
            // real data ships both numbers and boolean true here (qiye_10)
            revertActionIndex: entry.revertActionIndex ?? null,
            revertIdle: entry.revertIdle ?? null,
            idleFocus: entry.idleFocus ?? null,
            mode: entry.mode ?? null,
            snap: entry.snap ?? null,
            snapMode: entry.snapMode ?? null,
            dragDirect: entry.dragDirect ?? null,
            rate: num(entry.rate),
            listener: entry.listener && typeof entry.listener === 'object' ? entry.listener : null,
            relations: Array.isArray(entry.relations) ? entry.relations : null,
            reactCondition: entry.reactCondition && typeof entry.reactCondition === 'object' ? entry.reactCondition : null,
            ignore: Array.isArray(entry.ignore) ? entry.ignore : [],
            enable: Array.isArray(entry.enable) ? entry.enable : [],
            ignoreAction: entry.ignoreAction ?? null,
            ignoreReact: entry.ignoreReact ?? null,
            limitTimeMs: limitTime && limitTime > 0 ? Math.round(limitTime * 1000) : 1000,
            offsetX: num(entry.offsetX) ?? 0,
            offsetY: num(entry.offsetY) ?? 0,
            label: entry.part ?? null,
        };
        return zone;
    }

    // skins: parsed skins.json (may be null); flags: index.json entry for the
    // prefab (reserved for per-skin flags like guide/hotspots — not needed to
    // normalize, but part of the contract so callers can pass it through).
    function buildZones({ skins, flags, drawableIds, motionGroups } = {}) {
        void flags; void motionGroups;
        const drags = skins && Array.isArray(skins.drags) ? skins.drags : [];
        const ids = Array.isArray(drawableIds) ? drawableIds : [];
        const zones = [];
        const paramListeners = [];
        for (const entry of drags) {
            const zone = normalize(entry, ids);
            if (zone.partIndex >= 0) zones.push(zone);
            else paramListeners.push(zone);
        }
        return { zones, paramListeners, meta: { total: drags.length, hitAreas: zones.length } };
    }

    root.MizuEngine = root.MizuEngine || {};
    root.MizuEngine.buildZones = buildZones;
})(typeof window !== 'undefined' ? window : globalThis);
