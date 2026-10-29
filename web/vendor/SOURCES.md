# Vendored web libraries

Pinned and fetched by scripts/fetch-web-deps.sh (PLAN §8 R0.2); re-run the
script to refresh. Both libraries are MIT; each bundle ships with its package
LICENSE text as <file>.LICENSE (the pixi-live2d-display 0.4.0 bundle carries
no embedded notice).

Not vendored here (SPEC §12 D-L2): the Live2D Cubism Core (proprietary) and
all nagami/Azur Lane data. They are mirrored under ~/.local/share/mizu/ and
referenced by path at runtime; web/vendor/live2dcubismcore.min.js, web/data/
and web/assets are gitignored.

| file | version | source URL | sha256 | fetched |
|---|---|---|---|---|
| pixi.min.js | 6.5.10 | https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js | 403f2f2ee8145fa17f60c5c89403056efe2680e5096ec2762036486914ed19c5 | 2026-10-29 |
| pixi-live2d-display.min.js | 0.4.0 | https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js | af1267e6d52759b245766c578d905bfa025b532d5c3cc727c370957c4409e21b | 2026-10-29 |

