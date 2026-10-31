# Interaction Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: execute via superpowers:executing-plans
> (inline) with superpowers:dispatching-parallel-agents for the independent units
> (Tasks 2-spine-spike, 13-census). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Azur Lane skin in mizu-l2d behave like azurlane.nagami.moe: clicks
work without hints, animations/voice are never interrupted, and all `drags[]` interactions
(popup menus, drags, outfit switches, sequences) work from one data-driven engine.

**Architecture:** P0 lands surgical fixes in `web/main.js` + `web/dialogue.js` (verified by
browser probes). P1 replaces the interaction core (`buildHotspots`, `StateManager`, Gaoxiong
hacks) with four new PIXI-independent engine modules under `web/engine/` (classic scripts,
`window.MizuEngine.*`, dual-env loadable from node:test), wired by a slimmed `main.js`.
P2 (Spine) is spike-gated. Evidence lives in `/tmp/mizu-parity-evidence/` (never committed).

**Tech Stack:** pixi.js 6.5.10 + pixi-live2d-display 0.4.0 (vendored, pinned), vanilla JS
classic scripts, node:test (zero-dep), serve.py on 127.0.0.1:8787, CDP headless Chromium
for probes.

**Spec:** `docs/PARITY-SPEC.md` (the binding authority; this plan argues from it).

## Global Constraints (from spec — verbatim)

- Engine-general only; **no per-skin hardcoding**: no prefab names, no magic mesh indices,
  no magic parameter-name lists in engine paths (AC-5.8 grep gate).
- A running animation + voice is never cut; busy clicks are **ignored** (only trigger
  type 6 passes); hold-pose states hold until `revertIdle`/`reactCondition`/Reset Pose.
- `drags[].limitTime` (seconds) is the cooldown; fallback 1 s only when absent.
- Never commit: assets, `web/data/`, `web/assets`, `build/`, `third_party/cubism/`,
  screenshots. Conventional commits, explicit paths (never `git add -A`). No push.
- Test models: gaoxiong_7 (default), antu_2 (primary popup reference), benningdun_2,
  wuqi_3, lisailiu_3 / rangbaer_3 / rangbaer_4 (no-drag fallback). **Never** aersasi_3,
  chaijun_6, zhangwu_2, baifeng_3, wuzang_4 (PLAN §9).
- Probe lessons (STATUS.md): occluded tabs throttle rAF — drive
  `internalModel.update(dt, now)` manually; use `renderer.plugins.extract.canvas(stage)`
  for deterministic screenshots; read executed source in-page before suspecting cache.
- Preserve the 0.4.0 workarounds: idle-reservation watchdog (main.js:1783–1790), bg
  `createImageBitmap` load (main.js:1600–1609), `fitBackground` idempotency (main.js:1580).

## Review Focus

1. **Skin with drags but an unresolvable `part`** (drawable id absent from the mesh): must
   degrade to a param-only listener with zero console errors, not crash `buildZones` —
   pinned by Task 8 unit test `zone with unknown part becomes param-only`.
2. **Skins without `drags[]` at all** (lisailiu_3): must keep working via Touch* fallback —
   pinned by Task 11 probe `no-drag fallback unchanged`.
3. **`trigger.type` values not in the census** (unknown/absent): engine must treat them as
   inert zones (visible marker, no action) rather than throwing — Task 8
   `unknown trigger type is inert`.
4. **Voice stuck loading** (404 audio, stalled network): busy gate must expire on the
   bubble-duration cap so interactions never lock permanently — Task 4 probe
   `voice cap releases the gate` (AC-2.5).
5. **Model switch mid-interaction**: switching skins while a sequence/param-drag is active
   must fully reset engine state (no stale pose/offset/cooldown on the next model) — Task
   10 probe `model switch resets engine state`.

---

### Task 1: Setup — branch, SDD workspace, probe tooling

**Files:**
- Create: `.superpowers/sdd/` workspace (git-ignored scratch), branch `feat/interaction-parity`
- Create: `tests/probe/cdp.mjs` (zero-dep CDP client), `tests/probe/_env.mjs` (serve+page helpers)

**Interfaces:**
- Produces: `cdp.mjs` exports `launch({url})` → `{page, evaluate(fn,...args), click(x,y),
  drag(path), screenshot(path), consoleLogs(), close()}`; `_env.mjs` exports
  `withPage(modelPrefab, fn)` which starts serve.py :8787, opens `?model=<prefab>`, waits
  for `window.__mizu.model`, runs `fn(page)`, always closes.

- [ ] **Step 1:** Verify headless browser availability (`chromium --version` or
      `google-chrome --version`; if neither exists → Ruling: use the in-app browser
      manually for AC evidence and note the harness limitation in STATUS.md).
- [ ] **Step 2:** `git checkout -b feat/interaction-parity`; run
      `bash ~/.zcode/skills/subagent-driven-development/scripts/sdd-workspace docs/PARITY-PLAN.md`
      and create `progress.md` ledger (`# SDD ledger — plan: docs/PARITY-PLAN.md`).
- [ ] **Step 3:** Write `tests/probe/cdp.mjs` (CDP over Node WebSocket ≥22:
      `Page.navigate`, `Runtime.evaluate`, `Input.dispatchMouseEvent`, `Page.captureScreenshot`,
      console log collection) and `tests/probe/_env.mjs`. Smoke-test:
      `node tests/probe/_env.mjs gaoxiong_7 "window.__mizu.model !== null"` → `true`.
- [ ] **Step 4:** Commit: `git add tests/ && git commit -m "test(probe): zero-dep CDP harness for interaction verification"`

### Task 2 (P0-1): Hit-testing independent of the tips overlay

**Files:**
- Modify: `web/main.js` (tick gate ~1832–1838, `updateHotspots` ~1272–1378, `findHotspotAtPoint` ~1212–1232)
- Test: `tests/probe/p0_tips_off.mjs`

**Interfaces:**
- Produces: `computeHotspotBounds(hotspot)` (main.js scope, also called lazily from
  `findHotspotAtPoint`); per-tick `updateHotspots()` keeps badge positioning but hit-test
  no longer depends on it.

- [ ] **Step 1 (RED):** Write `tests/probe/p0_tips_off.mjs`: load gaoxiong_7 (tips default
      OFF), read zone hit coordinates with tips forced ON via
      `__mizu.toggleTips()` + `updateHotspots` (record each zone's badge-free mesh bounds
      center in canvas px), reload with tips OFF, click each recorded coordinate, assert
      `window.mizu.status().lastTap` equals the zone's action. Run → expect FAIL
      (`lastTap` stays null; wrong dialogue key observed via `__mizu.dialogue.text`).
- [ ] **Step 2:** Extract bounds computation from `updateHotspots` into
      `computeHotspotBounds(h)`; in `findHotspotAtPoint`, lazily compute missing bounds
      before testing; the tick gate keeps running only the badge/relaxation pass.
- [ ] **Step 3 (GREEN):** Re-run probe → PASS (all zone actions fire with tips off; the
      generic `touch` fallback no longer appears). Also re-run tips-ON clicks → identical
      actions (AC-1.2).
- [ ] **Step 4:** Commit `fix(main): compute hotspot hit bounds independently of the tips overlay`.

### Task 3 (P0-3): Dialogue mapping fixes

**Files:**
- Modify: `web/dialogue.js` (`keyForAction` ~101–113, `say` fallback ~277–281)
- Test: `tests/unit/dialogue.test.mjs` (loads dialogue.js with stub window/document/Audio/BroadcastChannel/localStorage)

**Interfaces:**
- Produces: `keyForAction(action) -> string|null` — `null` means "no line, stay silent";
  mapping: touch_head→headtouch, touch_body→touch, touch_special→touch2,
  touch_drag*/touch_idle*→touch2-if-present-else-touch, main_N→mainN, login→login,
  home→home, mission→mission, mission_complete→mission_complete, mail→mail,
  change_in/change_out/wedding/feeling*/asmr*→null (no words key exists), unknown→null.

- [ ] **Step 1 (RED):** Unit tests: `main_1 → 'main1'`, `main_4 → 'main4'`,
      `login → 'login'`, `mission_complete → 'mission_complete'`, `touch_drag7 → 'touch2'`
      when words has touch2, `change_in → null`, unknown → `null`. Run
      `node --test tests/unit/dialogue.test.mjs` → FAIL (regex + missing branches).
- [ ] **Step 2:** Fix the regex literal to `/^main_?(\d)$/`; add the mapping table; in
      `say()`, when `keyForAction` yields null or the key is missing → return false with
      NO bubble (delete the wrong-zone substitution `words['touch'] || words['main1'] || …`;
      chatter paths are unaffected — they pass existing keys with `force`).
- [ ] **Step 3 (GREEN):** Unit tests PASS. Probe: gaoxiong_7 head click shows headtouch
      text; a zone with no matching words shows no bubble; mute/chatter toggles still work.
- [ ] **Step 4:** Commit `fix(dialogue): correct main_N mapping, event keys, and silence on missing lines`.

### Task 4 (P0-2): Busy gate + data-driven cooldown, no timer yank

**Files:**
- Modify: `web/main.js` (pointerdown ~1413–1443, StateManager.playAction 750 ms timer
  ~536–545, hotspot cooldown ~1086/1104/1118/1135/1151/1170/1194)
- Test: `tests/probe/p0_busy.mjs`

**Interfaces:**
- Produces: `interactionBusy()` — true while a non-idle motion plays OR the interaction
  voice plays (reads `dialogue.playing` + a hard cap timer of the current bubble
  duration, AC-2.5); `zoneCooldownMs(h)` — reads `h.limitTime` (ms) captured at
  `buildHotspots` from the matching `drags[]` entry (fallback 1000); pointerdown checks
  `interactionBusy()` before firing and no longer hard-preempts.

- [ ] **Step 1 (RED):** `tests/probe/p0_busy.mjs` on gaoxiong_7: click head zone, within
      200 ms click body zone → record motion groups started (probe wraps
      `StateManager.playAction`/`model.motion` via a page-side monkeypatch before the
      second click) and audio aborts (patch `HTMLAudioElement.prototype.pause` counter).
      Expect FAIL today (second motion starts; audio aborted).
- [ ] **Step 2:** Implement `interactionBusy()` + gate in pointerdown; thread `limitTime`
      from drags into hotspots (match by `trigger.action`/part); delete the 750 ms
      `setTimeout` block in `playAction` (return-to-idle now relies on motion completion +
      the idle-group mechanism; verify no orphan references).
- [ ] **Step 3 (GREEN):** Probe PASS: first motion+voice complete uninterrupted; post-
      completion click fires; with `?model=antu_2` (1 s limitTime entries) a re-click at
      500 ms is swallowed and at 1100 ms fires (AC-2.3, same skin allowed by PLAN §9).
      No `setTimeout` forced idle on the interaction path (grep check).
- [ ] **Step 4:** Commit `fix(main): ignore clicks while busy, honor drags limitTime cooldowns, drop 750ms idle timer`.

### Task 5 (P0-4): Position stability — motion-end camera restore + unified reset

**Files:**
- Modify: `web/main.js` (tick ~1797–1829, `StateManager.reset` ~573–589, `sampleCameraParameters` 1469–1505)
- Test: `tests/probe/p0_drift.mjs`

**Interfaces:**
- Produces: `cameraParamNames` (fixed Cubism vocabulary: CameraX/CameraY/CameraS,
  ParamCameraPositionX/Y, ParamCameraX/Y, ParamCameraScale, ParamCaraCameraPositionX/Y,
  ParamCaraCameraScale, ParamCharaMainPositionX/Y, ParamCharaMainScale) — generic, not
  skin-specific; `motionTouchedCamera` set filled each tick while a non-idle motion plays;
  on the playing→idle transition (existing watchdog point) the touched params lerp back to
  defaults over ~300 ms; `StateManager.reset` additionally clears camera state +
  `currentSequenceOffset` (nagami Reset-Pose semantics); user `view` untouched.

- [ ] **Step 1 (RED):** `tests/probe/p0_drift.mjs` on wuqi_3 and benningdun_2: record all
      camera param values + `renderPlacement` output position; fire the zone sequence
      (click zones whose drags carry offsets, e.g. wuqi_3 TouchDrag8) ; after motions end,
      assert camera params == defaults. Expect FAIL today (leftover offsets).
- [ ] **Step 2:** Implement tracked-restore (lerp) + reset unification; DELETE the
      Gaoxiong-specific tick safety list (main.js:1797–1811) and the "30"/"31" mapping
      (main.js:455–467) — their job is subsumed (ledger Ruling if a regression appears).
- [ ] **Step 3 (GREEN):** Probe PASS on both skins (AC-4.1 primary assert); repeat 10×
      stable (AC-4.2); placement editor Reset View unchanged (AC-4.3 quick probe).
- [ ] **Step 4:** Commit `fix(main): restore motion camera params on motion end and unify reset pose`.

### Task 6 (P1-5a): `web/engine/zones.js` — drags[] → normalized zone registry

**Files:**
- Create: `web/engine/zones.js` (dual-env: `(function(root){ root.MizuEngine = root.MizuEngine || {}; … })(typeof window!=='undefined'?window:globalThis)`)
- Test: `tests/unit/engine/zones.test.mjs` (loads via `vm.runInThisContext` + stub `window`)

**Interfaces:**
- Consumes: raw `skins.json` object, `index.json` flags for the prefab, `drawableIds`
  (string[]), `motionGroups` (string[] as-authored).
- Produces: `MizuEngine.buildZones({skins, flags, drawableIds, motionGroups}) →
  { zones: Zone[], paramListeners: Zone[], meta: {total, hitAreas} }` where
  `Zone = { id, part, partIndex (-1 if unresolvable), meshIndices[], action (trigger.action
  or null), trigger (raw), idle (drags.idle), param (drags.param or null), range, rangeAbs,
  smooth, revertSmooth, revert, revertActionIndex, revertIdle, idleFocus, mode, snap,
  snapMode, dragDirect, rate, listener, relations, reactCondition, ignore, enable,
  ignoreAction, ignoreReact, limitTimeMs, offsetX, offsetY, label }`. Entries whose `part`
  is not in drawableIds → `paramListeners` (partIndex -1, no hit area). Unknown/absent
  trigger types are inert zones (Review Focus 3).

- [ ] **Step 1 (RED):** Unit tests with fixture JSON copied from real skins: a type-2 click
      entry with part+action (→ zone with hit area, action set, limitTimeMs = limitTime*1000);
      a `TouchIdle`-part entry with `idle: N`; an entry whose part is missing from
      drawableIds (→ paramListeners); a type-15 xiaqi entry (zone with `trigger.index`);
      an unknown type (zone, `inert: true`); a skins object without `drags` (→ empty
      registry, no throw). Run → FAIL (module missing).
- [ ] **Step 2:** Implement `buildZones` (pure normalization; label from part name; no
      PIXI/DOM references).
- [ ] **Step 3 (GREEN):** `node --test tests/unit/engine/zones.test.mjs` PASS.
- [ ] **Step 4:** Commit `feat(engine): drags[] zone registry module`.

### Task 7 (P1-5b): `web/engine/triggers.js` — pointer recognition + busy/cooldown policy

**Files:**
- Create: `web/engine/triggers.js`
- Test: `tests/unit/engine/triggers.test.mjs`

**Interfaces:**
- Consumes: zones from Task 6; event records `{type:'down'|'up'|'move', x, y, t}` in model
  space; context `{paramValue(name), isMotionPlaying(), currentIdleState(), canFire(zone)}`.
- Produces: `MizuEngine.createTriggerEngine({zones, ctx}) → {onEvent(ev, hitZone),
  tick(now), activeParamDrags(), state}` implementing: type 2/6 click recognition
  (down→up ≤30 units && ≤0.5 s, fire after 0.1 s hold; 6 bypasses busy), type 3 long-press
  actionList stepping (entries `{time, action}`; `last` on release-before-end), types
  1/4/9/11 param-conditioned clicks, type 10 animationPlay subscriptions
  (`{triggerName, triggerIndex, triggerRate, parameterRange}` fired from motion progress
  notifications), type 12 extend-rule gating of allowed actions, type 13 param-move
  (drag velocity × rate), types 7/8 drag-with-time/hold-increment, cooldowns from
  `limitTimeMs` with per-zone `lastFired`, busy gate `({type:6}) → allowed`,
  xiaqi type 15/16 board (cells 1–9, `target` player/AI, win-line detection over the 3×3
  grid, `win:true/false` result triggers, reset on full board).

- [ ] **Step 1 (RED):** Unit tests (fake clock): click fires type-2 after 0.1 s; a
      700 ms-slow release does NOT fire; second click inside cooldown ignored; type-6
      fires while `isMotionPlaying()` is true, type-2 does not; long-press steps
      actionList at times then `last` on early release; type-9 fires only while param in
      range; animationPlay fires when a motion progress notification crosses triggerRate;
      xiaqi: player wins on a top row, `win` trigger action chosen, board resets.
      Run → FAIL.
- [ ] **Step 2:** Implement (pure JS, injected clock for tests).
- [ ] **Step 3 (GREEN):** Suite PASS.
- [ ] **Step 4:** Commit `feat(engine): trigger recognition engine (16 drags trigger types)`.

### Task 8 (P1-5c): `web/engine/params.js` — param writer, relations, listener

**Files:**
- Create: `web/engine/params.js`
- Test: `tests/unit/engine/params.test.mjs`

**Interfaces:**
- Consumes: paramListeners + drag zones from Task 6; coreModel adapter
  `{getParam(name), setParam(name, v), defaultValue(name)}` (injected).
- Produces: `MizuEngine.createParamEngine({zones, core, ctx}) → {onDragStart(zone, x, y),
  onDragMove(zone, x, y, dt), onDragEnd(zone), tick(dt), applyRelations(now)}` implementing:
  param writer with `range`/`rangeAbs` clamping, `smooth`/`revertSmooth` exponential
  approach, `revert` (target value; `-1` = no auto-revert), `revertActionIndex`,
  `snap`/`snapMode`, `dragDirect` (direct map), `rate`, `offsetCircle` rotary, `mode`;
  relations types 101 (follow dragX)/102 (dragY)/103 (values by actionList step)/104
  (idle+time delayed); `listener {change[{keys,mode,value,actionIndex}], apply{bands}}` →
  band-crossing switches idle pose via `ctx.setIdleByIndex(n)`; `removeComList` part
  opacity toggles via `ctx.setPartOpacity(name, v)`.

- [ ] **Step 1 (RED):** Unit tests with a fake core: drag to max of range with smooth
      converges to clamped value; release with `revert: 0` returns toward 0 by
      revertSmooth; `rangeAbs` uses absolute units; relation 103 writes the step value;
      listener band `[-1,0,8]` calls `setIdleByIndex(8)` when the param crosses; unknown
      param names are no-ops. Run → FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3 (GREEN):** Suite PASS.
- [ ] **Step 4:** Commit `feat(engine): parameter drag writer, relations and listener bands`.

### Task 9 (P1-5d): `web/engine/state.js` — idle-pose state machine + pose lifecycle

**Files:**
- Create: `web/engine/state.js`
- Test: `tests/unit/engine/state.test.mjs`

**Interfaces:**
- Consumes: zones (with `idle`, `revertIdle`, `reactCondition`, `offsetX/offsetY`),
  motion groups, `idleMotions` map (stateIndex → group; reuse the current
  `idleN`/`touch_idleN` synthesis rules from main.js:422–435).
- Produces: `MizuEngine.createStateEngine({zones, idleMotions, ctx}) → {onActionFired(action),
  onMotionEnded(group), current(), idleGroup(), sequenceOffset(), canFire(zone),
  reset(), setState(n)}` implementing: `idle: N` pose switching after the action plays,
  `revertIdle` return, `reactCondition.idleOn/idleOff` pose-lock gating (`canFire`),
  `ignore`/`enable`/`ignoreAction`/`ignoreReact` gating against the playing group,
  sequence `offsetX/offsetY` attach/clear on pose lifecycle, base-idle return on
  motion end when no pose is held (replaces the deleted 750 ms timer semantics).

- [ ] **Step 1 (RED):** Unit tests (fake ctx): firing a zone with `idle: 2` switches
      idle group to `touch_idle2` (or `idle2`), state = 2, sequenceOffset applied;
      motion end while holding → idle stays; `revertIdle: 0` returns to base after the
      revert motion; zone with `reactCondition {idleOn:[1]}` canFire=false at state 0 and
      true at state 1; `ignore:['touch_drag1']` blocks the zone while that group plays;
      `reset()` restores base idle, offset {0,0}, clears cooldown ownership. Run → FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3 (GREEN):** Suite PASS.
- [ ] **Step 4:** Commit `feat(engine): idle-pose state machine with pose-lock gating`.

### Task 10 (P1-5e): Wire the engine into main.js; remove hardcodes; markers parity

**Files:**
- Modify: `web/index.html` (script tags for `engine/*.js` before main.js)
- Modify: `web/main.js` — replace `StateManager` + `buildHotspots` internals with the
  engine (pointerdown/move/up feed `triggers.onEvent`; motion-completion notifications
  feed `state.onMotionEnded` + camera restore; `params` drives coreModel each tick);
  keep Touch*-fallback synthesis ONLY when `buildZones` returns zero zones; badges/
  hover/tooltip UI stays, now rendered from engine zones (badge numbering = 1-based
  drags order, sequence ▶/↺ badges only when the engine exposes a sequence); add the
  "N / M hotspots" counter chip + `tips.guide`/`animWhiteList` visibility + muted-while-
  playing style; delete the Gaoxiong prop zone (mesh 179–183) and prop-keyword scan
  (P1-6); `paraRange` clamps `model.focus`; `dragRate × index.dragRateMultipliers`
  scales gaze; animator.json fade-in (default 0.2 s) applied to motion starts;
  `?wall=1` and ctl API (`window.mizu.*`) keep working, `status()` reports engine state.
- Test: `tests/probe/p1_engine.mjs`

**Interfaces:**
- Consumes: Tasks 6–9 modules; existing dialogue/marker/ctl plumbing.
- Produces: `window.__mizu.engine` probe handle `{zones, state(), lastAction, canFire}`.

- [ ] **Step 1 (RED):** `tests/probe/p1_engine.mjs` — antu_2: zone count in
      `__mizu.engine` == 65 (from index.json `hotspots`); the floor-panel zone (part
      TouchIdle1 per nagami ground truth) is hittable at its live bbox; clicking it fires
      `touch_idle1` and the idle pose changes (status line equivalent "Playing: Drag Idle 1");
      benningdun_2: 70 zones; wuqi_3: 33 zones; lisailiu_3 (no drags): fallback zones
      still present; `grep -nE 'gaoxiong_7|179|Touch_drag(19|20|21)' web/main.js` → no
      engine-path hits. Expect FAIL before wiring.
- [ ] **Step 2:** Wire; delete the old `StateManager` interaction paths the engine
      replaces (keep `window.mizu.state/motion` ctl mapping onto the engine).
- [ ] **Step 3 (GREEN):** Probe PASS on all five skins + grep gate (AC-5.1/5.2/5.3/5.7/5.8).
      Manual side-by-side with nagami for antu_2 elevator behavior (IAB browser), screenshots
      to `/tmp/mizu-parity-evidence/`.
- [ ] **Step 4:** Commit `feat(engine): wire drags engine into main.js, drop per-skin hardcodes`.

### Task 11 (P1-5f): Param-drag skins, xiaqi, effect layer

**Files:**
- Modify: `web/engine/triggers.js`, `web/engine/params.js`, `web/main.js` (pointer drag
  routing to `params` when placementLocked and no zone hit; motion progress → animationPlay)
- Test: `tests/probe/p1_drag.mjs`, `tests/probe/p1_xiaqi.mjs`

**Interfaces:**
- Consumes: Tasks 7–9.
- Produces: full AC-5.4/5.5; effect layer = second motion queue IF the bundled framework
  exposes `CubismMotionQueueManager` on model internals (else: documented limitation in
  STATUS.md — Ruling).

- [ ] **Step 1 (RED):** `p1_drag.mjs`: pick a census skin whose drags are pure param drags
      (query `tests/unit` fixture list built in Task 13; fallback: benningdun_2 phone
      slider if identified): synthetic pointer drag over the character → param deltas > 0
      (probe reads coreModel param before/after). `p1_xiaqi.mjs`: suweiaitongmeng_3 —
      click 3 cells in a top row → win trigger action fires (`lastAction`), board resets.
      Expect FAIL.
- [ ] **Step 2:** Implement drag routing + xiaqi glue in main.js; effect-layer attempt.
- [ ] **Step 3 (GREEN):** Probes PASS (AC-5.4, AC-5.5; effect outcome recorded).
- [ ] **Step 4:** Commit `feat(engine): pointer param drags, xiaqi minigame, effect layer`.

### Task 12 (P3-7): Formalize the harness + automated AC-4.1/5.6

**Files:**
- Create: `tests/probe/run-all.mjs` (drives AC probes for gaoxiong_7/antu_2/benningdun_2/
  wuqi_3/lisailiu_3; drift check; writes JSON + screenshots to `/tmp/mizu-parity-evidence/`)
- Create: `tests/unit/engine/fixtures/` (drags fixtures extracted from real skins.json)

**Interfaces:**
- Produces: `node tests/probe/run-all.mjs` — one command, exit 0 only when every probe
  passes; `node --test tests/unit/` for unit slices.

- [ ] **Step 1:** Consolidate probes behind `run-all.mjs` with per-AC labels.
- [ ] **Step 2:** Run both commands; record results in the ledger (AC-7.1).
- [ ] **Step 3:** Commit `test(probe): one-command AC verification harness`.

### Task 13 (AC-5.6, parallel-dispatchable): Catalog capability census

**Files:**
- Create: `scripts/census.mjs` (node; reads all 239 `~/.local/share/mizu/l2d/*/skins.json`
  + `web/data/l2d_index.json`; runs `MizuEngine.buildZones` per prefab via the unit loader)
- Output: `/tmp/mizu-parity-evidence/census.json` + `.md` summary (per-prefab zone count vs
  index.json `hotspots`, trigger-type histogram, exclusions)

**Interfaces:**
- Consumes: Task 6 module. Produces: the census artifact backing AC-5.6.

- [ ] **Step 1:** Implement + run; every mismatch vs index.json `hotspots` is explained
      (documented exclusion) or fixed.
- [ ] **Step 2:** Commit `feat(census): per-prefab interaction capability census`.

### Task 14 (P2-6a, parallel-dispatchable): Spine research spike

**Files:**
- Create: `docs/SPINE-SPIKE.md` (findings; throwaway code under `spikes/spine/`)

**Interfaces:**
- Produces: go/no-go, runtime choice, asset layout, license note, interaction-data answer
  feeding a plan addendum for 6b/6c (owner-visible).

- [ ] **Step 1:** Fetch + inspect `https://data.nagami.moe/spine/EN/index.json` (schema,
      counts, `links.live2d`), one sample asset set; license check (Spine Runtimes License
      for personal local use); interaction data survey.
- [ ] **Step 2:** Write `docs/SPINE-SPIKE.md`; commit. 6b/6c proceed only if go.

### Task 15 (BƯỚC 4): Full AC verification + STATUS + final review

- [ ] **Step 1:** Run `node --test tests/unit/` and `node tests/probe/run-all.mjs`; walk
      every spec AC, collect evidence; honest per-AC report (fail = fail with output).
- [ ] **Step 2:** Update `STATUS.md` (done units, discoveries) per CLAUDE.md; commit.
- [ ] **Step 3:** `review-package` + dispatch fresh whole-branch reviewer (most capable
      model); fix pass for Critical/Important; report rulings + deferred minors.

## Execution notes

- Mode: inline (executing-plans) — the plan's tasks share `web/main.js`, so parallel
  implementers would conflict; dispatching-parallel-agents applies to Task 13 (census)
  and Task 14 (spine spike), dispatched in background while inline tasks run.
- Ruling (ledgered): implementation happens on branch `feat/interaction-parity` (not
  master) per executing-plans; merged to master at finish, no push (owner rule).
- The dotfiles side needs NO change for P0/P1 (shell only forwards `tips` — semantics
  unchanged). Any shell follow-ups discovered during verification get their own commit
  in the dotfiles repo.
