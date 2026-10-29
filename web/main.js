// R0.3 scaffold (PLAN §8): transparent PIXI stage on the page.
// R1a.1: render aersasi_3 with idle motion, fit to ~90% viewport height,
// anchored bottom-center.
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
        'assets/aersasi_3/aersasi_3.model3.json', { autoInteract: false });
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
