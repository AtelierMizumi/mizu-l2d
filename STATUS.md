# STATUS — state ledger (update at the END of every work unit)

Last updated: 2026-10-29
Last agent: ZCode (R0.2 web vendor unit)
Next unit: **R1a.1** (render aersasi_3 in the page, PLAN §8 R1). R0.3 committed.
Handover for continuation: **docs/HANDOVER.md** (read it first; it lists owner-only steps).

## Done (verified)
- Spikes S1/S2/S4 PASS (design doc §2). Pointer input to background layer
  works on niri; virtual-pointer injection works for testing.
- C++ daemon skeleton builds green and runs on both outputs (frame loop,
  damage discipline, IPC, ctl, config). Committed in the R0.1 baseline.
- Native Cubism renderer built (SDK 5-r.3 + LINUX_GLES2 vendor patch);
  renders *something* but rest pose is exploded → parked (PLAN §9-P).
- Assets mirrored: `~/.local/share/mizu/l2d/abeikelongbi_3` (MilkyLan),
  `~/.local/share/mizu/l2d/aersasi_3` (nagami CDN, 40 MB, full touch_idle
  set + animator.json + skins.json with 66 drags).
- nagami.moe data layer reverse-engineered and documented (PLAN §5);
  frontend source confirmed private.
- `scripts/fetch-model.sh` rewritten for the nagami CDNs (tested).
- R0.2 done (verified): `scripts/fetch-web-deps.sh` fetched and pinned
  pixi 6.5.10 (`dist/browser/pixi.min.js`) and pixi-live2d-display 0.4.0
  (`dist/index.min.js`) into `web/vendor/`, sha256 recorded in
  `web/vendor/SOURCES.md`; package LICENSE texts vendored as `*.LICENSE`.
  `git check-ignore` confirms the Cubism Core, `web/data/` and `web/assets`
  stay out of git.
- R0.3 done (verified): `web/index.html` + `web/main.js` transparent PIXI
  scaffold; `web/assets -> ~/.local/share/mizu/l2d` symlink (gitignored).
  Served via `python3 -m http.server 8787 -d web`; curl checks returned 200
  for index.html, the aersasi_3 model3.json through the symlink, and both
  vendor bundles.

## In progress
- S0-perf (SPEC §12): scripts in `spikes/s0-perf/` (committed in `cd21547`). Side A
  `webkit_bench_gtk4.py` needs `webkitgtk-6.0`. Side B `native_measure.sh` needs
  a live Wayland session. Both must be run by the owner on the desktop.

## Next
- R0.2 → R0.3 → R1a.1 (PLAN §8). S0-perf runs before R2 (SPEC §12).

## Blockers / open questions
- `skins.json` scale/offset unit semantics unknown (resolved empirically in
  R1c.1).
- gtk4-layer-shell input-region behavior on the background layer unverified
  (R2a.2 spike).
- Native renderer exploded rest pose — parked, hypotheses in PLAN §9-P.

## Discoveries log (append-only)
- 2026-10-29: initial ledger written; see PLAN §6 for pitfalls 1–13.
- 2026-10-29: owner asked for an official multi-environment extension. Wrote
  docs/SPEC.md (v3 DRAFT): engine + host adapters + content packs. Public engine
  cannot ship Cubism Core or Azur Lane content (SPEC §9). Owner decisions open:
  D-L1 license, D-L2 private overlay for content, D-N1 name, D-S1 tiers, D-P1 repo
  location. Spikes S5–S8 added. Not yet reviewed by owner.
- 2026-10-29 spec audit (tests run, see PLAN §8 R0.1 and §5):
  - `ninja -C build`: no work to do (green). `bash -n scripts/*.sh`: all pass.
  - `git add -A` FAILS on root character-device placeholders. R0.1 now uses explicit paths.
  - Asset counts fixed in PLAN: aersasi_3 has 82 motion groups (not ~60), 44 touch_idle
    groups (not 47; gaps at 16, 20, 21). 21 idle groups and 66 drags confirmed.
    abeikelongbi_3 has 14 groups, confirmed.
  - WebKit stack: `ldd gtk4-layer-shell` links GTK4 only; `webkit2gtk-4.1` links GTK3.
    Reference host is now webkitgtk-6.0 (PLAN D-R2, R2a.1, §3; SPEC §4.2).
  - pixi.js and pixi-live2d-display LICENSE pages show MIT (fetched from GitHub 2026-10-29).
  - Not verified: Live2D license terms (live2d.com blocked in sandbox). Layer-shell
    support per compositor (secondary sources only). Performance A/B (not run: no
    display in sandbox; `webkit_bench.py` written, not yet run on the owner's session).
- 2026-10-29 owner approved: decisions D-L1, D-L2, D-N1, D-S1, D-P1 recorded in SPEC §12
  (recommendations accepted). R0.1 committed with explicit paths. `.claude/` stays
  untracked until the owner decides. S0-perf is the next measurement, before R2.
- 2026-10-29 security review of R0.1 (automated finding, model_runtime.cpp), fixed in the
  working tree, NOT committed (needs owner OK):
  - moc3 now loads with `LoadModel(moc, msz, true)`. Cubism Core's default is no check.
    Verified: the real abeikelongbi_3 moc3 passes `csmHasMocConsistency`; truncated and
    corrupted copies fail.
  - Every model3.json reference (texture, physics, motion) must be relative with no `..`
    (`is_safe_rel`). A standalone test of the helper passes 9/9.
  - Still open: `read_all` has no size cap, and stb decoders parse untrusted PNGs. Address
    with the content-pack limits in SPEC §4.3 before any public release.
- 2026-10-29 bug: `scripts/fetch-model.sh` never fetched `FileReferences.Moc`. aersasi_3
  has no moc3 locally, so the native runtime cannot load it (and PLAN R1a.1 uses it).
  Fixed in the working tree. The same script also refuses `..` or absolute paths from the
  remote model3.json. Owner must re-run `bash scripts/fetch-model.sh aersasi_3` to fetch
  the moc3. The sandbox blocks azlassets.nagami.moe, so the URL is unverified here.
- 2026-10-29 goal set by owner (`/mattpocock-skills:tdd`): a selection UI with preview,
  on-demand download of a chosen Live2D model (no mass download), and the model shown and
  interactive on the desktop wallpaper.
  - Success: 99 of 100 random loads succeed (retries counted). Interaction: the hotspot
    fires the mapped motion, no motion gets stuck, no crash after 100 interactions, and
    switching models leaks no GL resources.
  - Placement: catalog and fetch live in this repo while it is local. Gate: move them to the
    overlay before any push or public release (SPEC §12, D-L2 amendment).
  - Host: wait for the S0-perf result before choosing WebKitGTK 6.0 or native.
  - Seams S1–S6 are proposed (catalog, on-demand fetch, render, interaction, wallpaper host,
    success-rate harness). Not yet confirmed by the owner; no tests written yet.
- 2026-10-29 R0.2 unit:
  - pixi-live2d-display@0.4.0 has NO `dist/web/` (that layout is 0.5.x); the
    0.4.0 bundle is `dist/index.min.js`. PLAN R0.2 corrected before vendoring.
  - The 0.4.0 bundle embeds no license notice, so each package's LICENSE text
    is vendored as `<bundle>.LICENSE` (MIT redistribution requirement).
  - This sandbox CAN reach cdn.jsdelivr.net — HANDOVER §1's "cannot" list was
    written for the previous agent's sandbox. Re-test network assumptions per
    session instead of trusting the handover.
