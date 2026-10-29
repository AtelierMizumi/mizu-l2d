// R0.3 scaffold (PLAN §8): transparent PIXI stage on the page.
// R1a.1: render a model with idle motion, fit to ~90% viewport height,
// anchored bottom-center. Model selectable via ?model=<prefab> (R1c.2 will
// build the real carousel from l2d_mapping.json).
// R1a.2: scene background behind the model (skin bg id from the mapping,
// cover-fit like the nagami site's stage).
const MODEL = new URLSearchParams(location.search).get('model') || 'aersasi_3';
const app = new PIXI.Application({
    backgroundAlpha: 0,
    resizeTo: window,
});
document.body.appendChild(app.view);

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
    const model = await PIXI.live2d.Live2DModel.from(
        `assets/${MODEL}/${MODEL}.model3.json`, { autoInteract: false });
    // 0.4.0 hardcodes motionManager.groups.idle = 'Idle', but AL models name
    // the group 'idle' — auto-idle silently no-ops without this remap.
    model.internalModel.motionManager.groups.idle = Object.keys(
        model.internalModel.settings.motions).find(k => k.toLowerCase() === 'idle') ?? 'Idle';
    fit(model);
    app.stage.addChild(model);
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
    });
    // probe for render checks (handover A4): page state without pixels
    window.__mizu = { app, model, bg: null };

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
