// R0.3 scaffold (PLAN §8): transparent PIXI stage on the page.
// R1a.1: render a model with idle motion, fit to ~90% viewport height,
// anchored bottom-center. Model selectable via ?model=<prefab> (R1c.2 will
// build the real carousel from l2d_mapping.json).
// R1a.2: scene background behind the model (skin bg id from the mapping,
// cover-fit like the nagami site's stage).
// R1b.2: hotspot hit-test (D-HIT) plus the game-style "L2D interaction tips"
// toggle: numbered glass speech-bubbles pinned to the live center of each
// hotspot's drawable bbox (soft float + breathe like the game), a hover label
// naming the action group, and click -> motion.
// Zones come from skins.json drags[] (part = drawable id, trigger.action =
// motion group, limitTime = cooldown s). drags[].ignore / reactCondition are
// still unverified (PLAN §5) and deliberately not applied — the cooldown
// alone prevents retrigger spam. Badge numbers are 1-based drags order; the
// game's own numbering scheme is unverified, so the label is the source of
// truth.
const MODEL = new URLSearchParams(location.search).get('model') || 'aersasi_3';
const app = new PIXI.Application({
    backgroundAlpha: 0,
    resizeTo: window,
});
document.body.appendChild(app.view);

// ---------- hotspots + interaction tips ----------
let model = null;
let hotspots = [];
let hoveredHotspot = null;
let tipsOn = false;
let tipsOnAt = 0;
const pointerGlobal = new PIXI.Point(-1, -1);
// reusable temps: updateHotspots runs on every tick for every zone
const tempModelPoint = new PIXI.Point();
const tempCenter = new PIXI.Point();
const tempLocal = new PIXI.Point();
const tempGlobal = new PIXI.Point();

const badgeLayer = new PIXI.Container();
badgeLayer.visible = false;

const tipsToggle = document.getElementById('tips-toggle');
const tipsLabel = document.getElementById('tips-label');
tipsToggle.addEventListener('click', () => {
    tipsOn = !tipsOn;
    tipsOnAt = performance.now() / 1000;
    tipsToggle.classList.toggle('on', tipsOn);
    tipsToggle.setAttribute('aria-pressed', String(tipsOn));
    badgeLayer.visible = tipsOn;
    setHovered(null);
});

function makeBadge(number) {
    const badge = new PIXI.Container();
    const bob = new PIXI.Container();
    // glass speech-bubble: ellipse and tail share one fill pass so the
    // translucency never doubles up; hairline outline plus a whisper of
    // drop-shadow keep it legible on bright art without reading as UI
    const bubble = new PIXI.Graphics();
    bubble.beginFill(0x2c3a4e, 0.1).drawEllipse(0.8, -12, 11.4, 10).endFill();
    bubble.beginFill(0xffffff, 0.38)
        .drawEllipse(0, -13, 11, 9.5)
        .drawPolygon([-4, -6.5, 3.5, -6.5, -0.5, -0.5])
        .endFill();
    bubble.lineStyle(1, 0xffffff, 0.65).drawEllipse(0, -13, 11, 9.5);
    bubble.moveTo(-4, -6.5).lineTo(-0.5, -0.5).moveTo(3.5, -6.5).lineTo(-0.5, -0.5);
    const label = new PIXI.Text(String(number), {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11.5,
        fontWeight: '600',
        fill: 0x4d5c70,
        dropShadow: true, dropShadowColor: 0xffffff, dropShadowBlur: 2,
        dropShadowDistance: 1, dropShadowAlpha: 0.9,
    });
    label.anchor.set(0.5);
    label.position.set(0, -13);
    bob.addChild(bubble, label);
    badge.addChild(bob);
    badge.bob = bob;
    badge.num = number;
    badge.alpha = 0;
    badgeLayer.addChild(badge);
    return badge;
}

// overshooting ease for the toggle-on pop, so bubbles settle like bubbles
function easeOutBack(p) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}

function buildHotspots(skins) {
    const drawableIds = model.internalModel.getDrawableIDs();
    const groups = Object.keys(model.internalModel.settings.motions || {});
    const groupByName = new Map(groups.map(g => [g.toLowerCase(), g]));
    let drags = (skins && skins.drags) || [];
    // Older skins ship no drags config at all (Jean Bart, abeikelongbi_3, …)
    // but the mesh still carries Touch* hit regions whose names match motion
    // groups — synthesize the basic zones from them (tech design §13 fallback).
    // Skins WITH drags stay exactly as the game configures them.
    if (!drags.length) {
        // Drawable ids are PascalCase ("TouchHead") while motion groups are
        // snake_case ("touch_head") — convert before matching, a plain
        // lowercase gives "touchhead" and matches nothing.
        drags = drawableIds
            .filter(id => /^touch/i.test(id))
            .map(id => {
                const group = id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
                return groupByName.has(group)
                    ? { part: id, trigger: { action: groupByName.get(group) }, limitTime: 1 }
                    : null;
            })
            .filter(Boolean);
    }
    let unmapped = 0, unplayable = 0;
    for (const drag of drags) {
        const action = drag.trigger && drag.trigger.action;
        if (!action || !groups.includes(action)) { unplayable++; continue; }
        const index = drawableIds.indexOf(drag.part);
        if (index === -1) { unmapped++; continue; }
        hotspots.push({
            action, index,
            cooldown: (drag.limitTime ?? 1) * 1000,
            lastFired: -Infinity,
            badge: makeBadge(hotspots.length + 1),
        });
    }
    console.log('[mizu] hotspots:', hotspots.length,
        `(skipped: ${unmapped} parts not in drawables, ${unplayable} without a usable trigger)`);
    tipsToggle.hidden = hotspots.length === 0;
    window.__mizu.hotspots = hotspots;
}

// smallest hitbox wins, so fine-grained touch regions beat coarse ones they
// sit inside
function hotspotAt(point) {
    let best = null;
    for (const h of hotspots) {
        const b = h.bounds;
        if (!b || point.x < b.x || point.x > b.x + b.w || point.y < b.y || point.y > b.y + b.h) continue;
        if (!best || b.w * b.h < best.bounds.w * best.bounds.h) best = h;
    }
    return best;
}

function setHovered(h) {
    if (h === hoveredHotspot) {
        if (h) {
            tipsLabel.style.left = `${pointerGlobal.x}px`;
            tipsLabel.style.top = `${pointerGlobal.y}px`;
        }
        return;
    }
    hoveredHotspot = h;
    app.view.style.cursor = h ? 'pointer' : 'default';
    if (h) {
        tipsLabel.textContent = h.action;
        tipsLabel.hidden = false;
        tipsLabel.style.left = `${pointerGlobal.x}px`;
        tipsLabel.style.top = `${pointerGlobal.y}px`;
    } else {
        tipsLabel.hidden = true;
    }
}

function updateHotspots() {
    const internal = model.internalModel;
    for (const h of hotspots) {
        // live vertex bbox in canvas-px space (y-down) — the same space
        // toModelPosition produces, so hit tests stay exact while animating
        const verts = internal.getDrawableVertices(h.index);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < verts.length; i += 2) {
            const x = verts[i], y = verts[i + 1];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        h.bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        // canvas px -> container-local -> stage: the exact chain
        // toModelPosition inverts (internal.localTransform + worldTransform)
        tempCenter.set((minX + maxX) / 2, (minY + maxY) / 2);
        internal.localTransform.apply(tempCenter, tempLocal);
        model.toGlobal(tempLocal, tempGlobal);
        h.badge.position.set(tempGlobal.x, tempGlobal.y);
        const active = h === hoveredHotspot;
        // gentle float + breathe, staggered per badge so they never pulse in
        // lockstep; ease-out pop when tips are toggled on
        const now = performance.now() / 1000;
        const pop = easeOutBack(Math.min(Math.max((now - tipsOnAt - (h.badge.num - 1) * 0.02) / 0.3, 0), 1));
        const sway = Math.sin(now * 2.1 + h.badge.num * 0.55);
        h.badge.bob.y = Math.sin(now * 1.3 + h.badge.num * 0.55) * 1.5;
        h.badge.scale.set((active ? 1.15 : 1) * (1 + sway * 0.035) * pop);
        h.badge.alpha = (active ? 1 : 0.88) * Math.min(pop, 1);
    }
    if (pointerGlobal.x >= 0) {
        setHovered(hotspotAt(model.toModelPosition(pointerGlobal, tempModelPoint)));
    }
}

function setupHotspotEvents() {
    app.stage.interactive = true;
    app.stage.on('pointermove', (e) => pointerGlobal.copyFrom(e.data.global));
    app.stage.on('pointerdown', (e) => {
        const h = hotspotAt(model.toModelPosition(e.data.global, tempModelPoint));
        if (!h) return;
        const now = performance.now();
        if (now - h.lastFired < h.cooldown) return;
        h.lastFired = now;
        model.motion(h.action, undefined, 3);
    });
}

function fit(model) {
    const scale = window.innerHeight * 0.9 / model.internalModel.height;
    model.scale.set(scale);
    model.anchor.set(0.5, 1);
    model.position.set(window.innerWidth / 2, window.innerHeight);
}

function fitBackground(sprite) {
    // scale from the texture's natural size, not sprite.width: sprite.width
    // already includes the current scale, which made this non-idempotent —
    // every resize event shrank the bg back to its native size, centered.
    const texW = sprite.texture.width;
    const texH = sprite.texture.height;
    const scale = Math.max(window.innerWidth / texW, window.innerHeight / texH);
    sprite.scale.set(scale);
    sprite.position.set((window.innerWidth - texW * scale) / 2, (window.innerHeight - texH * scale) / 2);
}

// skin -> bg image URL, resolved from the mirrored nagami mapping
async function findBackgroundUrl(prefab) {
    const mapping = await (await fetch('data/l2d_mapping.json')).json();
    for (const ship of Object.values(mapping)) {
        const skin = (ship.skins || []).find(s => s.prefab === prefab);
        if (skin && skin.bg) return `assets/bg/${skin.bg}.png`;
    }
    return null;
}

async function loadTexture(url) {
    // createImageBitmap decodes fully and deterministically. An HTMLImageElement
    // can hit texImage2D before the decoder finishes in a hidden tab, which
    // uploads an opaque-black GL texture that never re-uploads — the bg then
    // renders black forever (~7% of catalog bgs, verified 2026-10-30).
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`texture load failed: ${url} (${resp.status})`);
    const bitmap = await createImageBitmap(await resp.blob());
    return PIXI.Texture.from(bitmap);
}

async function main() {
    model = await PIXI.live2d.Live2DModel.from(
        `assets/${MODEL}/${MODEL}.model3.json`, { autoInteract: false });
    // 0.4.0 hardcodes motionManager.groups.idle = 'Idle', but AL models name
    // the group 'idle' — auto-idle silently no-ops without this remap.
    model.internalModel.motionManager.groups.idle = Object.keys(
        model.internalModel.settings.motions).find(k => k.toLowerCase() === 'idle') ?? 'Idle';
    fit(model);
    app.stage.addChild(model);
    app.stage.addChild(badgeLayer);
    window.addEventListener('resize', () => fit(model));
    // 0.4.0 leaves a stale idle reservation behind when an idle motion is
    // requested but never started (state.complete() clears currentGroup but
    // nothing clears reservedIdleGroup), so shouldRequestIdleMotion() never
    // fires again and auto-idle silently stops. Drop the stale reservation
    // whenever no motion is current; state.start() re-sets it legitimately.
    app.ticker.add(() => {
        const mm = model.internalModel.motionManager;
        if (mm.state.currentGroup === undefined && mm.state.reservedIdleGroup !== undefined) {
            mm.state.setReservedIdle(undefined, undefined);
        }
        // badges + hit-test bboxes track the animated vertices every tick
        if (hotspots.length) updateHotspots();
    });
    // probe for render checks (handover A4): page state without pixels
    window.__mizu = {
        app, model, bg: null, hotspots,
        get tipsOn() { return tipsOn; },
        toggleTips: () => tipsToggle.click(),
    };

    // scene background; a bg failure must not kill the model render
    try {
        const bgUrl = await findBackgroundUrl(MODEL);
        if (bgUrl) {
            const bg = new PIXI.Sprite(await loadTexture(bgUrl));
            fitBackground(bg);
            app.stage.addChildAt(bg, 0);
            window.addEventListener('resize', () => fitBackground(bg));
            window.__mizu.bg = bgUrl;
        }
    } catch (err) {
        console.error('[mizu] bg load failed:', err);
    }

    // hotspots from skins.json; a missing/failed file just means no zones
    try {
        const resp = await fetch(`assets/${MODEL}/skins.json`);
        buildHotspots(resp.ok ? await resp.json() : null);
        setupHotspotEvents();
    } catch (err) {
        console.error('[mizu] hotspot setup failed:', err);
    }

    console.log('[mizu] model loaded:', {
        width: model.internalModel.width,
        height: model.internalModel.height,
        motionGroups: Object.keys(model.internalModel.settings.motions || {}),
    });
}

main().catch(err => {
    // probe hook for render checks (handover A4): failures visible without console
    window.__mizu = { app, error: err && err.message ? err.message : String(err) };
    console.error('[mizu] model load failed:', err);
});
