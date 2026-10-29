// R0.3 scaffold (PLAN §8): transparent PIXI stage on the page.
// R1a.1: render a model with idle motion, fit to ~90% viewport height,
// anchored bottom-center. Model selectable via ?model=<prefab> (R1c.2 will
// build the real carousel from l2d_mapping.json).
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
    // probe for render checks (handover A4): page state without pixels
    window.__mizu = { app, model };
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
