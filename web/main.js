// R0.3 scaffold (PLAN §8): transparent PIXI stage on the page. The model,
// background and interaction arrive in R1a/R1b.
const app = new PIXI.Application({
    backgroundAlpha: 0,
    resizeTo: window,
});
document.body.appendChild(app.view);
