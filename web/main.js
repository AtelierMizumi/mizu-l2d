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
// R1a.3: nagami home-screen placement (mode "main", formula extracted from
// the site's own bundle — research doc §2) replaces the R1a.1 90%-height fit.
// R1a.5: placement editor — drag empty stage to move, wheel to zoom around the
// cursor (0.3x–3x of the nagami default), reset button. The user view is kept
// per prefab in localStorage in design px, so it scales with the window.
// R1c.2: model switching without reload (loadModel) driven by picker.js; the
// current prefab lives in ?model= so a reload keeps it.
let MODEL = new URLSearchParams(location.search).get('model') || 'gaoxiong_7';
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
const resetBtn = document.getElementById('view-reset');
tipsToggle.addEventListener('click', () => setTips(!tipsOn));
resetBtn.addEventListener('click', resetView);

function setTips(on, save = true) {
    tipsOn = on;
    tipsOnAt = performance.now() / 1000;
    tipsToggle.classList.toggle('on', tipsOn);
    tipsToggle.setAttribute('aria-pressed', String(tipsOn));
    badgeLayer.visible = tipsOn;
    setHovered(null);
    if (save) saveSettings({ tips: tipsOn });
}

// ---------- per-prefab storage (R1a.5) ----------
// settings layer shared by features (tips now, mute in R1d); every access is
// guarded because localStorage can throw in private windows or with blocked
// site data — the page then just runs with defaults
function readStored(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeStored(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}
function removeStored(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
}
// the wallpaper keeps its own placement and settings (same origin as the web viewer)
const placementKey = () => `mizu.placement.${MODEL}${WALL_MODE ? '.wall' : ''}`;
const settingsKey = () => `mizu.settings.${MODEL}${WALL_MODE ? '.wall' : ''}`;
// defaults: tips off; web viewer plays voice and chatter (wallpaper mode mutes, R2)
// wall mode (?wall=1, set by the wallpaper host) starts muted (R1d / R2)
const WALL_MODE = new URLSearchParams(location.search).has('wall');
function loadSettings() {
    return { tips: false, mute: WALL_MODE, chatter: true, ...(readStored(settingsKey()) ?? {}) };
}
function saveSettings(patch) { writeStored(settingsKey(), { ...loadSettings(), ...patch }); }

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
        // some drags hit-regions (Alsace TouchIdle2..5) park far off-canvas
        // in the rest pose — hide their badges instead of floating them in
        // the void; they reappear if an animation brings the region on-screen
        h.badge.visible = tempGlobal.x > -50 && tempGlobal.x < window.innerWidth + 50
            && tempGlobal.y > -50 && tempGlobal.y < window.innerHeight + 50;
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
    if (pointerGlobal.x >= 0 && !(press && press.dragging)) {
        setHovered(hotspotAt(model.toModelPosition(pointerGlobal, tempModelPoint)));
    }
}

// ---------- pointer: hotspot clicks + placement drag/zoom (R1a.5) ----------
// Events sit on the canvas (not the stage) so one listener set covers clicks,
// drags and wheel. A press that lands on a hotspot fires it at once and never
// turns into a drag; a press on empty stage becomes a drag after DRAG_THRESHOLD px.
const DRAG_THRESHOLD = 4;
let press = null; // { start, last, dragging } for presses that missed every hotspot

function canvasPoint(e) {
    const r = app.view.getBoundingClientRect();
    return new PIXI.Point(e.clientX - r.left, e.clientY - r.top);
}

function setupPointerEvents() {
    const canvas = app.view;
    canvas.addEventListener('pointermove', (e) => {
        const p = canvasPoint(e);
        pointerGlobal.copyFrom(p);
        if (!press || !model) return;
        if (!press.dragging) {
            if (Math.hypot(p.x - press.start.x, p.y - press.start.y) <= DRAG_THRESHOLD) return;
            press.dragging = true;
            canvas.style.cursor = 'grabbing';
            setHovered(null);
        }
        moveView(p.x - press.last.x, p.y - press.last.y);
        press.last = p;
    });
    canvas.addEventListener('pointerdown', (e) => {
        if (!model) return;
        const p = canvasPoint(e);
        const h = hotspotAt(model.toModelPosition(p, tempModelPoint));
        if (h) {
            press = null;
            const now = performance.now();
            if (now - h.lastFired < h.cooldown) return;
            h.lastFired = now;
            lastTap = h.action;
            model.motion(h.action, undefined, 3);
            dialogue?.say(window.MizuDialogue.keyForAction(h.action));
            return;
        }
        press = { start: p, last: p, dragging: false };
    });
    window.addEventListener('pointerup', () => {
        if (press && press.dragging) {
            canvas.style.cursor = hoveredHotspot ? 'pointer' : 'default';
            saveView();
        }
        press = null;
    });
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (!model) return;
        zoomAt(canvasPoint(e), Math.exp(-e.deltaY * 0.001));
        saveView();
    }, { passive: false });
}

// R1a.3: nagami home-screen placement (mode "main", formula extracted from
// the site's own bundle, research doc §2). uiScale = viewportHeight /
// designHeight (1080); model scale = (scale ?? defaultScale 52) *
// (newMainScale ?? 1) / pixelsPerUnit * uiScale; position = screen center +
// effectiveOffset * uiScale with +offset = up (Y inverted), where
// effectiveOffset = newMainOffset (?? [0,-10]) + (newMainScale ?? 1) *
// offset. Anchor center — pinning the site's exact anchor is R1c.1.
// R1a.5 layers the user view on top: view.dx/dy are design px (screen axes,
// +y down) and view.zoom multiplies the nagami scale; both persist per prefab.
const ZOOM_MIN = 0.3, ZOOM_MAX = 3;
let placementBase = null; // { designHeight, ppu, scale, effX, effY } from skins + index
let view = { dx: 0, dy: 0, zoom: 1 };

function setupPlacement(skins, index) {
    const newMainScale = skins?.newMainScale ?? 1;
    const offset = skins?.offset ?? [0, 0];
    const newMainOffset = skins?.newMainOffset ?? [0, -10];
    placementBase = {
        designHeight: index.designHeight ?? 1080,
        ppu: Math.max(model.internalModel.pixelsPerUnit, 1),
        scale: (skins?.scale ?? index.defaultScale ?? 52) * newMainScale,
        effX: newMainOffset[0] + newMainScale * offset[0],
        effY: newMainOffset[1] + newMainScale * offset[1],
    };
    view = loadView();
    renderPlacement();
    console.log('[mizu] placement:', { ...placementBase, view });
}

function renderPlacement() {
    const b = placementBase;
    const w = window.innerWidth, h = window.innerHeight;
    const uiScale = h / b.designHeight;
    model.scale.set(b.scale / b.ppu * uiScale * view.zoom);
    model.anchor.set(0.5, 0.5);
    model.position.set(w / 2 + (b.effX + view.dx) * uiScale, h / 2 + (view.dy - b.effY) * uiScale);
}

function uiScale() {
    return window.innerHeight / placementBase.designHeight;
}

function moveView(dxPx, dyPx) {
    const u = uiScale();
    view.dx += dxPx / u;
    view.dy += dyPx / u;
    renderPlacement();
}

// keeps the model point under the cursor fixed while the zoom changes
function zoomAt(p, factor) {
    const zoom = Math.min(Math.max(view.zoom * factor, ZOOM_MIN), ZOOM_MAX);
    const k = zoom / view.zoom;
    if (k === 1) return;
    const nx = p.x + (model.position.x - p.x) * k;
    const ny = p.y + (model.position.y - p.y) * k;
    const b = placementBase, u = uiScale();
    view.zoom = zoom;
    view.dx = (nx - window.innerWidth / 2) / u - b.effX;
    view.dy = (ny - window.innerHeight / 2) / u + b.effY;
    renderPlacement();
}

function loadView() {
    const v = readStored(placementKey());
    if (!v || ![v.dx, v.dy, v.zoom].every(Number.isFinite)) return { dx: 0, dy: 0, zoom: 1 };
    return { dx: v.dx, dy: v.dy, zoom: Math.min(Math.max(v.zoom, ZOOM_MIN), ZOOM_MAX) };
}

function saveView() {
    const r = (n) => Math.round(n * 1000) / 1000;
    writeStored(placementKey(), { dx: r(view.dx), dy: r(view.dy), zoom: r(view.zoom) });
}

function resetView() {
    view = { dx: 0, dy: 0, zoom: 1 };
    removeStored(placementKey());
    renderPlacement();
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

// skin -> bg image URL, resolved from the mirrored nagami mapping (catalog)
function findBackgroundUrl(prefab) {
    for (const ship of Object.values(catalog)) {
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

// skins.json per the chosen model; a missing/failed file just means no
// placement/hotspot data
async function loadSkins(prefab) {
    try {
        const resp = await fetch(`assets/${prefab}/skins.json`);
        return resp.ok ? await resp.json() : null;
    } catch (err) {
        console.error('[mizu] skins.json load failed:', err);
        return null;
    }
}

// nagami index.json mirror (designHeight 1080, defaultScale 52); the
// fallback constants keep placement working without the file
async function loadPlacementIndex() {
    try {
        const resp = await fetch('data/l2d_index.json');
        if (resp.ok) return await resp.json();
    } catch (err) {
        console.error('[mizu] index.json load failed:', err);
    }
    return { designHeight: 1080, defaultScale: 52 };
}

// nagami catalog (ship -> skins with names + bg) and the placement index;
// both are read once. A missing catalog only disables the picker.
let catalog = {};
let placementIndex = null;
let picker = null;
let dialogue = null;
let lastTap = null; // last hotspot action that fired (reported by window.mizu.status)
let bgSprite = null;
let loadToken = 0; // a newer loadModel() call makes older in-flight loads drop their result

async function loadCatalog() {
    try {
        const resp = await fetch('data/l2d_mapping.json');
        if (resp.ok) return await resp.json();
    } catch (err) {
        console.error('[mizu] catalog load failed:', err);
    }
    return {};
}

// Frees a texture's GL upload and closes its decoded ImageBitmap. The bitmap
// is not released by destroy() alone; without close() its pixels wait for GC,
// which showed up as steady RSS growth across model switches.
function disposeTexture(texture) {
    const bitmap = texture.baseTexture?.resource?.source;
    texture.destroy(true);
    bitmap?.close?.();
}

// Drops the current model, its hotspots and badges, and the bg sprite, freeing
// their GL textures. Called before a new model is attached.
function unloadCurrent() {
    press = null;
    hoveredHotspot = null;
    tipsLabel.hidden = true;
    app.view.style.cursor = 'default';
    for (const badge of badgeLayer.removeChildren()) badge.destroy({ children: true });
    hotspots = [];
    if (model) {
        app.stage.removeChild(model);
        model.destroy({ children: true, texture: true, baseTexture: true });
        model = null;
    }
    if (bgSprite) {
        app.stage.removeChild(bgSprite);
        const texture = bgSprite.texture;
        bgSprite.destroy(false);
        disposeTexture(texture);
        bgSprite = null;
    }
}

// dialogue lines for one skin (scripts/build-words.py); no file means no bubbles
async function loadWords(prefab) {
    try {
        const resp = await fetch(`data/words/${prefab}.json`);
        return resp.ok ? await resp.json() : null;
    } catch (err) {
        console.error('[mizu] words load failed:', err);
        return null;
    }
}

async function loadModel(prefab) {
    const token = ++loadToken;
    const bgUrl = findBackgroundUrl(prefab);
    const [loaded, skins, bgTexture, words] = await Promise.all([
        PIXI.live2d.Live2DModel.from(`assets/${prefab}/${prefab}.model3.json`, { autoInteract: false }),
        loadSkins(prefab),
        // scene background; a bg failure must not kill the model render
        bgUrl ? loadTexture(bgUrl).catch(err => {
            console.error('[mizu] bg load failed:', err);
            return null;
        }) : null,
        loadWords(prefab),
    ]);
    if (token !== loadToken) {
        loaded.destroy({ children: true, texture: true, baseTexture: true });
        if (bgTexture) disposeTexture(bgTexture);
        return;
    }

    unloadCurrent();
    MODEL = prefab;
    history.replaceState(null, '', `?model=${prefab}`);
    model = loaded;
    // 0.4.0 hardcodes motionManager.groups.idle = 'Idle', but AL models name
    // the group 'idle' — auto-idle silently no-ops without this remap.
    model.internalModel.motionManager.groups.idle = Object.keys(
        model.internalModel.settings.motions).find(k => k.toLowerCase() === 'idle') ?? 'Idle';
    setupPlacement(skins, placementIndex);
    app.stage.addChild(model);
    if (bgTexture) {
        bgSprite = new PIXI.Sprite(bgTexture);
        fitBackground(bgSprite);
        app.stage.addChildAt(bgSprite, 0);
    }
    app.stage.addChild(badgeLayer);
    try {
        buildHotspots(skins);
    } catch (err) {
        console.error('[mizu] hotspot setup failed:', err);
    }
    // tips are per prefab: the new model starts with its own saved state
    setTips(hotspots.length > 0 && loadSettings().tips, false);

    window.__mizu.model = model;
    window.__mizu.bg = bgUrl && bgTexture ? bgUrl : null;
    window.__mizu.paraRange = skins?.paraRange ?? null;
    picker?.setCurrent(prefab);
    dialogue?.load(words);
    // login line on arrival; force bypasses the cooldown, and text shows even if audio is blocked
    dialogue?.say('login', { force: true });
    console.log('[mizu] model loaded:', {
        prefab,
        width: model.internalModel.width,
        height: model.internalModel.height,
        motionGroups: Object.keys(model.internalModel.settings.motions || {}),
    });
}

function switchModel(prefab) {
    if (prefab === MODEL) return;
    loadModel(prefab).catch(err => {
        console.error('[mizu] model switch failed:', prefab, err);
        window.__mizu.error = err && err.message ? err.message : String(err);
    });
}

// one ticker and one resize listener for the page lifetime; both are no-ops
// while no model is attached
function tick() {
    if (!model) return;
    const mm = model.internalModel.motionManager;
    // 0.4.0 leaves a stale idle reservation behind when an idle motion is
    // requested but never started (state.complete() clears currentGroup but
    // nothing clears reservedIdleGroup), so shouldRequestIdleMotion() never
    // fires again and auto-idle silently stops. Drop the stale reservation
    // whenever no motion is current; state.start() re-sets it legitimately.
    if (mm.state.currentGroup === undefined && mm.state.reservedIdleGroup !== undefined) {
        mm.state.setReservedIdle(undefined, undefined);
    }
    // badges + hit-test bboxes track the animated vertices every tick
    if (hotspots.length) updateHotspots();
}

// Control API for the wallpaper host (SPEC §5.3). The host evaluates these
// calls; every result is a string, so JSON is returned where there is state.
function installControlApi() {
    const motionGroups = () => Object.keys(model?.internalModel.settings.motions || {});
    window.mizu = {
        camera({ zoom, dx, dy, reset } = {}) {
            if (reset) resetView();
            else {
                if (zoom !== undefined) view.zoom = Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX);
                if (dx !== undefined) view.dx = dx;
                if (dy !== undefined) view.dy = dy;
                if (model) renderPlacement();
                if (model) saveView();
            }
            return JSON.stringify(view);
        },
        motion(group) {
            if (!model || !motionGroups().includes(group)) return 'false';
            model.motion(group, undefined, 3);
            return 'true';
        },
        model(prefab) {
            switchModel(prefab);
            return 'ok';
        },
        tips(on) {
            setTips(on !== undefined ? Boolean(on) : !tipsOn);
            return JSON.stringify(tipsOn);
        },
        status() {
            return JSON.stringify({
                prefab: MODEL, view, tips: tipsOn, muted: dialogue?.state.mute ?? null,
                chatter: dialogue?.state.chatter ?? null, groups: motionGroups().length,
                lastTap, hotspots: hotspots.length,
                zones: hotspots.map(h => ({ a: h.action, x: Math.round(h.badge.position.x), y: Math.round(h.badge.position.y) })),
            });
        },
    };
}

function onResize() {
    if (model) renderPlacement();
    if (bgSprite) fitBackground(bgSprite);
}

async function main() {
    // wallpaper: the page is the background, so the controls are hidden (index.html)
    if (WALL_MODE) document.body.classList.add('wall');
    // probe for render checks (handover A4): page state without pixels
    window.__mizu = {
        app, model: null, bg: null, hotspots, paraRange: null,
        get tipsOn() { return tipsOn; },
        get view() { return { ...view }; },
        toggleTips: () => tipsToggle.click(),
        resetView: () => resetView(),
    };
    [catalog, placementIndex] = await Promise.all([loadCatalog(), loadPlacementIndex()]);
    if (window.MizuDialogue) {
        dialogue = window.MizuDialogue.init({ settings: loadSettings(), onChange: saveSettings });
        window.__mizu.dialogue = dialogue;
    }
    setupPointerEvents();
    installControlApi();
    app.ticker.add(tick);
    window.addEventListener('resize', onResize);
    if (window.MizuPicker && Object.keys(catalog).length) {
        picker = window.MizuPicker.init({ catalog, current: MODEL, onSelect: switchModel });
    }
    await loadModel(MODEL);
}

main().catch(err => {
    // probe hook for render checks (handover A4): failures visible without console
    window.__mizu = { ...(window.__mizu || {}), app, error: err && err.message ? err.message : String(err) };
    console.error('[mizu] model load failed:', err);
});
