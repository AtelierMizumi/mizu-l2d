# Spine research spike (P2-6a)

**Status:** DONE 2026-10-31. Task 14 of `PARITY-PLAN.md`; feeds the 6b/6c plan
addendum. All evidence gathered live from the public CDNs (probe scripts left in
`/tmp/spine-spike/`, nothing fetched entered the repo). Verdict: **GO**, runtime
**pixi-spine 3.1.2** (UMD), under the Spine Runtimes License with the same
never-commit posture as the Cubism Core.

## 1. Dataset schema and counts

`https://data.nagami.moe/current.json` (schemaVersion 2) registers the dataset:

```json
"spine": {
  "version": 1793446621,
  "baseUrl": "https://data.nagami.moe/spine",
  "servers": { "EN": 1793446621, "CN": 1793446621, "JP": 1793446621 },
  "rootVersion": 1793347290
}
```

Per-server files live at `{baseUrl}/{server}/{path}?v={version}` (cache-busting
version = the per-server number above). The site's own data layer builds URLs
exactly this way (verified in its bundled JS).

`spine/EN/index.json` (schemaVersion 1):

```json
{
  "schemaVersion": 1,
  "sourceVersion": "9.3.388",
  "defaultSkin": "202371",
  "counts": { "total": 225, "spine": 208, "spinePlus": 17,
              "playable": 224, "live2dBacked": 1 },
  "skins": [ ... ]
}
```

**Counts: 225 entries (208 `spine` + 17 `spinePlus`), 184 unique ships, 15 with
`censoredAsset`, 1 `live2dBacked`.** The EN/CN/JP indexes have identical counts
and identical id sets (verified). The ~400 estimate in BUG-6 overcounts by ~1.8×;
the picker will list **224 playable entries** (the `live2dBacked` one,
`ailunsamuna_3`, has no Spine assets — its `fidelity.status` is `"live2d"` and
its `models/{asset}.json` is 404).

Every index entry has exactly these fields (no optional ones):

```json
{
  "id": "101101", "asset": "bote_2", "prefab": "bote_2",
  "displayName": "William D. Porter — The Daredevil's Maidly Service",
  "shipName": "William D. Porter",
  "skinName": "The Daredevil's Maidly Service",
  "type": "spinePlus",
  "live2dBacked": false,
  "available": true,
  "censoredAsset": null,
  "background": "529",
  "fidelity": { "status": "partial", "reasons": ["ParticleSystems"],
                "particleSystems": 4, "materials": 2, "materialNames": [...],
                "customShaders": [], "externalEffectPrefabs": [],
                "externalImages": 0 },
  "capabilities": { "interactions": true, "expressions": true,
                    "dialogue": true, "hitAreas": true, "composite": false }
}
```

Capability distribution: `interactions` true for **53** entries, `hitAreas` 221,
`expressions` 218, `dialogue` 221, `composite` 36. `fidelity.status`: 181
`partial` (mostly missing ParticleSystems), 43 `native`, 1 `live2d`.

**`links.live2d` cross-refs: do not exist.** No entry in any server's index has a
`links` field; the only live2d references are the `live2dBacked` flag and
`fidelity.status: "live2d"`. A spine↔Live2D correspondence can only be derived by
name matching, and it is nearly empty: only 1 of 225 spine assets shares a name
with a prefab in our local Live2D catalog (`ailunsamuna_3`, the live2dBacked
one). **The spine catalog is an almost entirely new set of ~224 dynamics**, not a
parallel encoding of the Live2D skins.

## 2. Per-entry data and asset layout

Two per-entry JSONs on the data host (both `schemaVersion: 1`, keyed
differently):

- **Skin** — `https://data.nagami.moe/spine/EN/skins/{id}.json?v={version}`
  (by numeric **id**, not asset). Holds: `id/asset/prefab/painting` ids,
  `shipName/skinName/displayName`, `type`, `available`, `censoredAsset`,
  `background`, `tags[]` (e.g. `spine_plus`, `bg`), `bgm` (null here),
  `skeletonDefaultSkin`, `changeSkin`, **`framing`** — named `[x, y, ?, scale]`
  placements for `inGame/profile/shop/newMain/fit` against a 1080 design height,
  **`expressions`** — in-game situation → expression-animation name map
  (`main_1..main_7`, `headtouch`, `login`, `mission`, `feeling1..5`, …), with
  `*_replace` empty-string fields, **`dialogue`** — action-keyed line text
  (`main` is a `|`-joined list), **`interaction`**, `effectActions`, `effects`,
  `fidelity`, `capabilities`.
- **Model** — `https://data.nagami.moe/spine/EN/models/{asset}.json?v={version}`
  (by **asset** name). Holds the render plan:

```json
{
  "asset": "bote_2",
  "layers": [{ "name": "bote_2", "skel": "bote_2.skel", "atlas": "bote_2.atlas",
               "textures": ["bote_2.png", "bote_22.png"],
               "startingAnimation": "normal", "loop": true,
               "initialSkin": "1", "timeScale": 1.0,
               "authoritative": true, "order": 0 }],
  "images": [],
  "mainLayer": 0,
  "hitAreas": [{ "name": "drag",
                 "position": [-308.95, 431.42], "size": [304.44, 220.10],
                 "pivot": [0.5, 0.5], "scale": [1.0, 1.0],
                 "rootPosition": [52.23, 1040.65],
                 "rootSize": [1149.08, 1295.46] }, ...],
  "bounds": null,
  "spineVersions": ["3.8.99"],
  "fidelity": {...}, "sourceBundles": ["bote_2", "bote_2_res"],
  "containers": ["Assets/ArtResource/SpinePainting/bote_2/bote_2.atlas.txt", ...]
}
```

`hitAreas` are **author-defined rectangles in skeleton space** (`rootPosition` +
`position`, `size × scale`, `pivot` anchor) — hit-testing is plain rect math, no
mesh picking. `layers[]` supports composites (36 entries; e.g. `mabuerheide_5`
has a background layer `*B` + main layer `*T` with `mainLayer: 1`), and `images[]`
adds static sprites with tint/alpha/transform (present on some spinePlus skins).

**Asset files** live on the asset CDN:

```
https://azlassets.nagami.moe/EN/spinepainting/{asset}/{file}
```

(all four file kinds of a layer sit in that one flat directory; the `/spine/`
path 301-redirects to `/EN/spine/` and 404s — the prefix is `spinepainting`).
Measured sizes (full GET):

| entry | skel | atlas | textures | total |
|---|---|---|---|---|
| buli_super (simple) | 0.10 MB | 0.01 MB | 1 × 2.96 MB | **3.07 MB** |
| mabuerheide_5 (composite, 2 layers) | 0.28 MB | 0.02 MB | 2 × ~2.2 MB | **4.63 MB** |
| bote_2 (spinePlus, 2 pages) | 2.53 MB | 0.02 MB | 8.84 + 9.37 MB | **20.77 MB** |
| molisen_3 (spinePlus, 3 pages) | 6.41 MB | 0.02 MB | 6.28 + 6.05 + 6.65 MB | **25.41 MB** |

Texture pages are up to 4096×4096 PNG; atlases declare `pma: true` (premultiplied
alpha). Skeletons are **binary `.skel` only** (no `.json` variant is served; the
extension is not range-request friendly — the CDN answers 200-full for ranges on
`.skel`/`.atlas`, 206 for PNG). Both `data.nagami.moe` and `azlassets.nagami.moe`
serve `access-control-allow-origin: *`, so the browser can fetch directly during
development; the fetcher can use plain curl like `fetch-model.py` does.

**Runtime version: Spine 3.8.99, uniformly.** `models/*.json` declares
`spineVersions: ["3.8.99"]`; the sample `bote_2.skel` binary header carries the
literal `3.8.99` string at offset 0x1a (after a 26-byte hash). No Spine 4.x
assets were found. `sourceVersion: "9.3.388"` in the index is the game-client
version, not the Spine editor version.

## 3. Runtime choice for the pixi 6.5.10 page

| candidate | pixi 6.5.10 fit | Spine 3.8.99 | license | classic script |
|---|---|---|---|---|
| **pixi-spine 3.1.2** | native — peer deps `@pixi/math`/`@pixi/constants` `^6.1.0`; UMD attaches to the existing `PIXI` global (`PIXI.spine`) | yes (`runtime-3.8`; enum `VER37/38/40/41`) | Spine Runtimes License ("SEE SPINE-LICENSE" in package) | yes — `dist/pixi-spine.umd.js` (1.2 MB) |
| pixi-spine 4.0.6 (`latest`) | no — peer `@pixi/* ^7.0.0` | yes | same | ESM-oriented |
| @esotericsoftware/spine-webgl 4.3.13 | no — own WebGL renderer/context, would not share the stage with pixi-live2d-display | **no — 4.x runtimes only** | Spine Runtimes License | UMD available but coexistence is poor |
| spine-ts (npm `spine-ts@1.0.0`) | — | — | npm package is **not** Esoteric's (ISC, unrelated); official spine-ts lives in the `spine-runtimes` GitHub monorepo, needs a build | no |
| roll our own 3.8 loader | — | — | MIT-able | cost of reimplementing a 3.8 binary loader: weeks, rejected |

**Chosen: pixi-spine 3.1.2.** Decisive points: it is what azurlane.nagami.moe
itself runs (their bundled viewer chunk literally contains the `pixi-spine` and
`3.8.75` runtime markers and drives it through `PIXI.Loader` with
`metadata.spineAtlasFile` — production proof that 3.8.75 runtime + 3.8.99 data
works); it renders as a plain `PIXI.DisplayObject` (`new PIXI.spine.Spine(spineData)`)
so it can live on the same pixi 6.5.10 global the page already vendors; and the
UMD build works as a classic script. Loading pattern (mirror of nagami's):
`loader.add(name, layer.skel URL, { metadata: { spineAtlasFile: layer.atlas URL } })`,
then `PIXI.spine.Spine(loaderRes.spineData)`, skins via
`spineData.findSkin(name)` / `skeleton.setSkinByName`, playback via
`state.setAnimation/addAnimation` with `state.data.defaultMix`,
`state.addListener({start, complete, end, event})` for completion notifications.

### License verdict (honest reading)

pixi-spine 3.1.2 vendors Esoteric's spine-ts and ships the **Spine Runtimes
License** (2020-01-01 text in the package; the current version at
esotericsoftware.com/spine-runtimes-license, updated 2025-04-05, has the same
two-path structure). It is **not an open-source license**. In full:

> Otherwise, it is permitted to integrate the Spine Runtimes into software or
> otherwise create derivative works of the Spine Runtimes (collectively,
> "Products"), **provided that each user of the Products must obtain their own
> Spine Editor license** and redistribution of the Products in any form must
> include this license and copyright notice.

(the other path is integrating under Section 2 of the Spine Editor License,
i.e. as a licensed Spine editor user). There is **no personal/non-commercial
exemption** in the text — the same condition applies regardless of use.

What this means for mizu-l2d: a strictly personal, local, single-user tool keeps
the user inside the spirit of the license only if the user holds (or obtains) a
Spine Editor license; the letter of Path 2 requires it. Practically the license
is not enforced per-user for local viewers and nagami.moe itself ships
pixi-spine publicly under it, but **the repo's own rule already covers the safe
posture**: like `third_party/cubism/` and `web/vendor/live2dcubismcore.min.js`,
the pixi-spine bundle is **never committed** — it is fetched at install time by
script into gitignored paths, with the SPINE-LICENSE text vendored next to it.
That keeps the repo itself free of redistributed runtime bytes; whoever runs the
fetch script accepts the license for their own machine. If the owner ever wants
a redistributable MIT-only path, the fallback is rolling a minimal 3.8-only
loader (large effort; explicitly not recommended now).

Note: `scripts/fetch-web-deps.sh` currently hard-asserts MIT text for everything
it vendors, so pixi-spine needs either a separate script or a non-MIT branch in
that script (see §6).

## 4. Interaction data — what actually exists

Surveyed **all 225** skin JSONs (the full `interaction` object of each):

- **172 entries: `interaction` is empty** (`{}`) — no hit areas, no drag data.
  They support idle + expression/dialogue display only; clicking does nothing.
  (Matches index `capabilities.interactions: false`.)
- **53 entries carry real interaction data** (matches the index flag):
  `interaction = { multiple_face, hit_area: [names], drag_data: {type, config_client} }`
  — 52 with `drag_data.type = 1`, 1 with `type = 3` (`yaerweite_2`, whose
  `config_client` is a plain string list `["touch","normal"]`). Variants: 6 add
  `action_enable` (animation gating, e.g. molisen_3
  `[{"name":"normal","ignore":[]},{"name":"ex","ignore":["touch_random1","touch_random2"]}]`),
  2 add `change_in_hit`, 2 add `replace_word`.
- `config_client[]` entries (the interaction script): `{hit, idle, action,
  change_idle, click, is_default, active}` plus occasional `event`, `fold`,
  `skin`, `lit`/`lit_start`, `effect_hide`, `material*`. They form a **level-up
  idle chain**: click hit area `drag` while idle `normal` → play animation
  `normal_lv1-2` → idle becomes `normal_lv2` → … up to `normal_lv5`, then wraps
  back to `normal` (`is_default` marks the chain root). Animation names in the
  skeleton match exactly (extracted from the sample skel: `normal`,
  `normal_lv2`, `normal_lv1-2`, `normal_lv2-3`, `normal_lv3`, `normal_lv3-5`,
  `normal_lv5`, `normal_lv5-1`).
- No pointer-drag parameters, no relations/listener system, no minigames —
  nothing like the Live2D `drags[]` trigger types. Interactions are: rect hit
  areas (from `models/*.json`, filtered by `hit_area`) + click → animation +
  idle-state transition + optional dialogue line + expression switch. There is
  **no per-entry input configuration beyond this** — anything more would be
  invented (AC-6.4).
- `dialogue` (221 entries) holds text lines keyed like our Live2D words keys
  (`main` `|`-joined, `touch`, `touch2`, `login`, `home`, `mission`, `lose`,
  `mail`, `unlock`, `feeling*`). Voice audio was not surveyed (likely the shared
  `voices` dataset keyed by ship id) — open item for 6c.
- `expressions` (all 225): situation → numeric animation-name map; nagami's
  viewer treats skeleton animations named `/^\d+$/` as the expression set.

## 5. Fetch-pipeline fit (what 6b changes)

Current pieces: `scripts/fetch-model.py` (atomic per-prefab download, sha256
`.mizu-manifest.json`, optional files, ledger update via `l2d_ledger.py`),
`scripts/serve.py` (`POST /api/download?prefab=`, header+origin gated, single
download lock), `scripts/mizu-l2d-cache.py` (ledger quota/LRU; detects an
installed prefab by `*.model3.json` glob), ledger
`~/.local/share/mizu/l2d/.ledger.json` = `{prefabs: {name: {bytes, last_used,
pinned}}, quota_bytes}` (2 GB default quota).

A spine mode slots in with these deltas:

1. **Enumeration differs, everything else reuses.** Live2D enumerates files from
   `model3.json` `FileReferences`; spine enumerates from `models/{asset}.json`
   (`layers[].skel/.atlas/.textures[]`, `images[].file`). Recommended: a spine
   branch inside `fetch-model.py` (or a thin `fetch-spine.py` sharing its
   helpers) — download `models/{asset}.json` + `skins/{id}.json` first, then the
   asset files. Same atomic tmp-dir swap, same `.mizu-manifest.json` format,
   same reuse-if-present behavior, `curl -A mizu-l2d-fetch/0.3`.
2. **URL patterns:**
   - `https://data.nagami.moe/spine/EN/models/{asset}.json?v={ver}`
   - `https://data.nagami.moe/spine/EN/skins/{id}.json?v={ver}`
   - `https://azlassets.nagami.moe/EN/spinepainting/{asset}/{file}` (no `?v=`;
     etag + long cache-control; `.skel`/`.atlas` ignore Range)
   - catalog: `https://data.nagami.moe/spine/EN/index.json?v={ver}`; version
     from `current.json` → `datasets.spine.servers[server]`.
3. **Storage + ledger.** Install under
   `~/.local/share/mizu/l2d/spine/{asset}/` (sibling of l2d prefabs) with the
   ledger key `spine/{asset}` — the `prefabs` dict takes arbitrary string keys
   and only directory-glob detection cares about shape. Keep out of the l2d
   namespace proper so `*.model3.json` detection and `PREFAB_RE` stay honest
   (spine asset names do satisfy `^[a-z0-9_]+$`; the only name overlap,
   `ailunsamuna_3`, serves no spine assets, so no real collision). Quota/LRU
   then covers both kinds via one ledger; expected per-model 3–25 MB means the
   2 GB default holds roughly 100–600 spine models.
4. **serve.py:** extend `POST /api/download` with `&kind=spine` (same
   `X-Mizu-Action` gate, same lock) or add `/api/download-spine`; validate the
   asset against a mirrored `web/data/spine_index.json` (gitignored like
   `l2d_index.json`).
5. **Never commit:** spine index/mirrors, assets, the pixi-spine bundle
   (license, §3). Same class of invariant as `web/data/`, `web/assets`.

## 6. GO/NO-GO and 6b/6c plan outline

**GO.** The data is uniform (one Spine version, one URL grammar, two small JSONs
per entry), the runtime choice is proven by the reference site itself on the
same pixi major we already vendor, and the interaction model is simple enough to
implement honestly (rect hits + animation choreography) with zero invented
behavior. The only gate is license posture (§3): runtime + assets fetched on
demand, nothing Spine-licensed ever enters git. If the owner rejects the Spine
Runtimes License for the runtime bundle, this becomes NO-GO for pixi-spine and
the fallback is a custom 3.8 loader (not recommended).

**6b — fetch pipeline** (files: modify `scripts/fetch-model.py` or add
`scripts/fetch-spine.py` + `scripts/serve.py`; create nothing in git):
mirror `web/data/spine_index.json` + spine version from `current.json`;
`fetch-spine <asset>` resolves id → `models/{asset}.json` + `skins/{id}.json` →
enumerated asset list → atomic install to `~/.local/share/mizu/l2d/spine/{asset}/`
with manifest + ledger `spine/{asset}` entry; serve.py `kind=spine` route;
`mizu-l2d-cache.py` verify/scan/evict work once directory detection accepts
`*.atlas` under `spine/`.

**6c — viewer** (files: `web/spine.js` classic script, `web/index.html` route,
`web/vendor/` fetch script change, picker integration):
`?spine=<asset>` mode loads the already-vendored pixi 6.5.10 + the pixi-spine
UMD (new non-MIT section in `fetch-web-deps.sh` or a dedicated
`fetch-spine-runtime.sh` that also vendors `SPINE-LICENSE`); loader pattern from
§3 (multi-layer composites sorted by `order`, `initialSkin`/`skeletonDefaultSkin`,
`startingAnimation` loop on track 0); framing from `skins/{id}.json` (`fit`/
`inGame` × 1080 design height, same math as nagami's `applyFraming`); hit-test =
rect math over `models/{asset}.json.hitAreas` (namespaced by
`interaction.hit_area`); interaction engine = the `config_client` idle-chain
state machine + `dialogue` lines + expression map (AC-6.4 boundary: no drags[],
no invented triggers); wall mode reuses the same render entry behind the GTK
host. Picker lists the 224 playable entries from the mirrored spine index.

**Open items for 6b/6c:** voice dataset wiring for spine skins (`bgm` field
usage); `multiple_face`/`effectActions`/`effects` details (empty on the sampled
entries, non-empty on some spinePlus); the one `type: 3` drag_data; composite
`images[]` layer skins in the wall memory budget (AC-6.3).
