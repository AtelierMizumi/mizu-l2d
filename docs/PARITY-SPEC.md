# Interaction Parity Spec — mizu-l2d viewer

Date: 2026-10-31 · Status: APPROVED (owner reviewed via plan gate)
Scope: this repo (engine); dotfiles only where the shell forwards settings.
Reference behavior: https://azurlane.nagami.moe/live2d-viewer — compare side-by-side in a browser whenever behavior is in doubt.

## Decisions locked by the owner (2026-10-31)

1. While an animation + its voice are running, further interaction clicks are **ignored** (game-accurate / nagami behavior). Only trigger-type-6 drags pass through a pose lock.
2. Interaction engine rewrite targets **full 1:1 coverage of all 16 trigger types** found in `drags[]` data (including the one-skin tic-tac-toe minigame).
3. **No Censored/_hx mode** (out of scope).
4. **Spine viewer is in scope** as its own phase (the real "missing skins" gap — see BUG-6).

## Hard rules for every fix (owner constraints)

- Engine-general only: every interaction fix lives in the shared engine layer so ALL skins benefit. **No per-skin hardcoding** (existing Gaoxiong/Takao hacks are removed or generalized).
- Surgical diffs; match existing code style; comments only for non-obvious constraints.
- A running animation + voice is never cut short.
- Hold-pose states hold: a skin that must stand still stays in its pose until the game's own revert condition (`revertIdle`, `reactCondition`, Reset Pose).
- Method for every bug: reproduce in browser → verify root cause → fix → re-verify in browser, keeping screenshot/console evidence. Side-by-side compare with nagami whenever behavior is in doubt.

## 0. Sources of truth

- **Behavior reference**: nagami live2d-viewer (frontend private, all data public).
- **Data truth**: `skins.json drags[]` per prefab (`https://data.nagami.moe/live2d/{SERVER}/skins/<prefab>.json`), a 1:1 transcription of the game's `ship_l2d.lua` (AzurLaneTools). Field semantics reverse-engineered from nagami's served bundle plus a census over all 239 skins (3,876 drags entries).
- **Test models**: gaoxiong_7 (owner's designated test model). Popup-menu cross-check set: **antu_2** (Azuchi elevator — primary reference), **benningdun_2** (phone icons, 70 drags), **wuqi_3** (33 drags). Never aersasi_3 (broken, owner-directed).
- nagami ground truth captured live 2026-10-31: antu_2 — Guide marker on the floor-button panel (1/65 hotspots visible on default idle), click → status "Playing: Drag Idle 1", part `TouchIdle1`, pose-lock chip; pointer-drag on the character visibly reacts and mutes markers while playing ("0 / 65"); wuqi_3 — hitboxes 10/33 with part names (`TouchDrag8`, `TouchHead`); per-skin action panel (Idle Poses 1–41, Drag Poses 1–21, Drag Idle 1–43, Events: Login/Mail/Mission/Skin Change In/Out/Pledge, Main Lines 1–4).

## 1. Verified bug report

### BUG-1 — Animations only fire with hints ON; hints OFF kills clicks and misplays dialogue [P0]

Root causes (verified in code):
1. `updateHotspots()` in `web/main.js` is the **only** writer of hotspot `bounds`, gated behind `if (tipsOn && hotspots.length)` (main.js:1832–1838). With tips off (the default), every hotspot's `bounds` stays `undefined`; `findHotspotAtPoint()` skips all candidates (main.js:1225) and returns null for any click.
2. The null fallback calls `model.tap()` — a no-op on Azur Lane models because their model3.json defines no HitAreas (verified gaoxiong_7; PLAN.md D-HIT) — then `dialogue.say('touch')` (main.js:1438–1439): the generic line regardless of zone.
3. Aggravator: every `buildHotspots()` re-run (main.js:558/588/622, 1735) rebuilds hotspots and wipes bounds — "it worked briefly right after toggling, then died".
4. Minor: tips-ON badge hit radius (28 px, main.js:1217) differs from tips-OFF mesh padding (20 px, main.js:1222); badge relaxation displaces badges up to ~38 px (main.js:1350–1373).

Fix direction: hit-test data must exist independently of badge visibility; tips stays a purely visual layer.

### BUG-2 — New clicks don't wait for the running animation + voice; interruptions feel janky [P0]

Root causes:
1. Every motion start uses pixi-live2d-display priority FORCE(3) with no queue: main.js:556, 585, 620 → hard preemption.
2. Per-zone cooldown hardcoded 1000 ms (main.js:1086, 1104, 1118, 1135, 1151; 400 ms props 1170/1194), per-zone — alternating zones bypass it. `drags[].limitTime` is never read.
3. The 750 ms deferred timer (main.js:536–545) force-plays base idle + `restoreDefaults()` whenever `currentState === 0` — cuts reactions started <750 ms earlier.
4. `restoreDefaults()` snaps ALL parameters (main.js:396–403); the tick safety check force-resets a Gaoxiong-specific param list mid-blend (main.js:1797–1811).
5. Voice hard-stopped before every new line (`stopAudio()`, dialogue.js:167–179, 205).
6. Camera lerp chases motion-driven camera params + sequence offsets while the 30↔60 FPS ramp coincides (main.js:1771–1781, 1817–1829).

### BUG-3 — Most skins are missing most of their interactions [P1]

Root causes:
1. **Regression**: `buildHotspots()` (main.js:1061–1208) no longer reads `skins.json drags[]` at all — only 3 hardcoded TouchHead/Body/Special zones, non-hittable sequence badges (`index: -1`), a Gaoxiong-hardcoded prop zone (mesh indices 179–183), and one generic prop-keyword zone. The drags-based zone system described at main.js:11–16 and STATUS.md R1b.2 is gone. ⇒ antu_2's elevator floor buttons (`TouchIdle1..23` parts carrying `idle: N`), benningdun_2's phone icons, outfit/color switches — none clickable.
2. `StateManager.init` (main.js:405–499) consumes only drags with `idle !== undefined`, offsetX/offsetY, plus a Gaoxiong-hardcoded param mapping ("30"/"31" → touch_drag6, main.js:455–467).
3. Unapplied `drags[]` fields: `param, range, start, rangeAbs, smooth, revertSmooth, revert, revertActionIndex, revertIdle, idleFocus, mode, snap, dragDirect, listener, reactX, reactY, reactCondition, ignoreAction, ignoreReact, limitTime, ignore, enable` (stored at 445–446, never read). Unapplied skins fields: `dragRate` (+ index `dragRateMultipliers`), `paraRange`, `actions[]`, `profileOffset/Scale`, `tips.guide`/`animWhiteList` (only `idleBlackList` honored, main.js:1281–1288).
4. Missing trigger semantics — nagami census of `trigger.type` over 3,876 drags: type 2 click = 3,160; param-conditioned 1/4/9/11 = 115; long-press 3 = 14; drag-with-time 7/8 = 93; animationPlay chains 10 = 22; extend-rule 12 = 22; param-move 13 = 7; constFit/removeComList 5 = 1; xiaqi 15/16 = 11; click-through-lock 6 = 22; none = 399. `relations[]` (101/102/103/104) and `listener {change[], apply.bands}` unimplemented. ~120 skins with pure parameter drags look dead.
5. `animator.json` downloaded (fetch-model.py:238–239) but never read; nagami takes its 0.2 s default fade-in from it.
6. The `effect` motion group (ambient looping layer, e.g. wuqi_3) not implemented.
7. Sequences cut early / wrong order: BUG-2 items 3–4 + no `reactCondition` gating + `ignore`/`enable` not honored.

### BUG-4 — Model drifts out of its original position after animations/interactions [P0]

Root causes:
1. `renderPlacement()` (main.js:1525–1536) combines placementBase + user view + `currentCamera`; `currentCamera` lerps toward `sampleCameraParameters()` (main.js:1469–1505) = in-model camera params + `getSequenceOffset()` (drags offsetX/Y). A motion that ends without restoring its camera params leaves the container displaced.
2. Nothing restores camera params reliably: the tick safety list is Gaoxiong-specific (main.js:1803) and only runs at state 0 with no motion playing; `restoreDefaults()` runs only from `StateManager.reset` and the 750 ms timer.
3. `currentSequenceOffset` persists while a pose is held (main.js:547), cleared only on `targetIdle === 0` (537) or `reset()` (577).
4. "Reset pose" (main.js:573–589) and "reset view" (1574–1578) are disconnected; nagami's Reset Pose clears hotspots/cooldowns and returns to the default pose.

### BUG-5 — Dialogue mapping bugs [P0]

1. dialogue.js:110 — regex literal `/^main_?\\d$/` matches a literal backslash + "d": main_1..main_4 never map, fall through to `'touch'` (chatter unaffected: uses main1..4 keys directly).
2. `keyForAction` (dialogue.js:101–113) lacks the full action space (login, home, mission, mission_complete, mail, wedding, change_in/out, feeling, asmr).
3. Missing-key fallback substitutes `words['touch'] || words['main1'] || first` (dialogue.js:277–281) — wrong-zone line instead of silence.

### BUG-6 — Catalog: Live2D is already complete; the real gap is Spine [P2 — owner decision: build it]

Verified 2026-10-31: nagami serves exactly **239 skins / 167 ships** (index.json count; local l2d_mapping.json count-identical; `current.json` regenerates at least daily). Cross-check: bungaku-moe/AzurLaneLive2D (2026-10-30) holds 245 unique models = nagami's 239 + 6 special models (lafei, z23, lingbo, biaoqiang, xuefeng, mingshi — outside the secretary system; not selected). The ~400 figure counts **Spine/dynamic skins** — a different runtime served by `https://data.nagami.moe/spine/{SERVER}/index.json`. ⇒ No Live2D skins are missing; the gap is a **Spine viewer** (owner decision locked).

Out of scope by decision: Censored/`_hx` variants (~26 models), the 6 special models (optional follow-up).

## 2. Work list (prioritized) with measurable acceptance criteria

Priority: P0 correctness → P1 engine parity → P2 Spine → P3 harness hardening (built alongside as the verification vehicle).

### P0-1 — Hit-testing independent of the tips overlay (fixes BUG-1)

Hotspot bounds computed every tick whenever hotspots exist (or lazily on pointer events); badge visibility stays tips-gated; one hit-test path for both modes. Drags[]-based zones from P1-5 inherit this.

- **AC-1.1** Browser probe on gaoxiong_7, antu_2, benningdun_2: with tips OFF, clicking the coordinates that hit a zone with tips ON fires the identical action, dialogue key matches the zone.
- **AC-1.2** Tips ON/OFF expose the same zones and hit geometry.
- **AC-1.3** Fresh load, tips off (default), accepts zone clicks immediately.

### P0-2 — Busy gate + data-driven cooldown (fixes BUG-2)

Central interaction gate: while a non-idle motion plays OR the interaction's voice plays, non-type-6 triggers are ignored silently; cooldown read from `drags[].limitTime` (fallback 1 s only when absent); 750 ms forced idle removed (motion completion returns to idle); parameter restores via motion-end hooks, lerped not snapped.

- **AC-2.1** Scripted clicks every 200 ms across different zones during a playing motion: first motion + voice complete uninterrupted (probe asserts audio never aborted); next click after completion fires.
- **AC-2.2** Clicking during voice playback never calls `stopAudio` on the running clip.
- **AC-2.3** Cooldown from data: `limitTime: 0.3` re-fires after ~300 ms; a 1 s entry blocked at 500 ms, allowed at 1100 ms.
- **AC-2.4** No timer-driven state yank: no setTimeout forced idle on the interaction path (grep + behavioral probe).
- **AC-2.5** Voice gating capped (dialogue bubble duration) so a stuck audio element cannot lock interactions permanently.

### P0-3 — Dialogue mapping (fixes BUG-5)

- **AC-3.1** gaoxiong_7: main_1..main_3 clicks show the main1..3 lines; head tap → headtouch; event actions map to their keys.
- **AC-3.2** A zone whose action has no words entry shows NO bubble (no wrong-zone substitution). R1d regression checks (mute, chatter, cooldown, 404) still pass.

### P0-4 — Position stability (fixes BUG-4)

Motion-end hook restores the camera parameters that motion touched (tracked deltas, lerped) — generic, no param-name lists; sequence offsets attach to the pose lifecycle (cleared by the pose's revert condition: reactCondition/revertIdle/Reset Pose); Reset Pose adopts nagami semantics (clear zone cooldowns + revert to default idle + clear motion-driven camera state); user placement never touched by interactions.

- **AC-4.1** antu_2, benningdun_2, wuqi_3: scripted full interaction sequences mirroring nagami, then Reset Pose → probe asserts sampled camera params == defaults, sequence offset == {0,0}, user view unchanged; model-region screenshot diff within tolerance as secondary evidence.
- **AC-4.2** Pose holds repeat 10× with no progressive drift.
- **AC-4.3** Reset Pose returns to the default pose; the placement editor's Reset View keeps its behavior.

### P1-5 — Interaction engine rewrite: drags[]-driven, all 16 trigger types (fixes BUG-3)

New engine module(s) under `web/` (split: zones, triggers, param-drag writer, idle-pose state machine, relations, markers — independently testable), driven ONLY by skins.json drags[] + index.json flags + animator.json. Hardcoded zones replaced by the drags registry; Touch*-drawable fallback synthesis kept ONLY for skins without drags[].

Coverage: type 2/6 click (move <30 & <0.5 s, 0.1 s fire delay; 6 passes pose lock); 3 long-press (actionList by time + last); 1/4/9/11 param-conditioned; 7/8 drag-with-time; 10 animationPlay chains (triggerName/triggerIndex/triggerRate ± parameterRange); 12 extend-rule gating; 13 param-move; 5 constFit + removeComList; 15/16 xiaqi (9 cells, player/AI, win-line, win/lose); param writer (smooth/revertSmooth/revert(-1)/revertActionIndex/range/rangeAbs/snap/snapMode/dragDirect/rate/offsetCircle); state machine (idle:, reactCondition.idleOn/idleOff, ignore/ignoreAction/ignoreReact/enable); relations 101–104; listener {change[], apply.bands}; effect motion layer; animator.json fades; paraRange focus clamp; dragRate × dragRateMultipliers gaze; markers (N/M counter, Guide vs Hitboxes, idleBlackList/animWhiteList, muted-while-playing); all actions route through the extended keyForAction.

- **AC-5.1** antu_2 (primary reference): floor-button panel click plays touch_idleN + switches idle to that floor; status matches nagami; Guide marker set matches per idle (1/65 on default, cross-checked live).
- **AC-5.2** benningdun_2: phone icon zones (drags 20–23) fire sequences in game order; zone count == 70.
- **AC-5.3** wuqi_3: 33 zones; TouchDrag8 behavior matches nagami; effect layer plays.
- **AC-5.4** A pure-param-drag skin responds to dragging (param deltas probed) where today it is dead.
- **AC-5.5** suweiaitongmeng_3: xiaqi board playable (9 cells, win/lose branches).
- **AC-5.6** Catalog census (automated): all 239 prefabs register zones == index.json `hotspots` count (documented exclusions), zero console errors, capability matrix artifact.
- **AC-5.7** No-drag skins unchanged: lisailiu_3 / rangbaer_3 / rangbaer_4 keep Touch* fallback behavior (R1b.2 checks pass).
- **AC-5.8** Hardcode gate: no prefab names, magic mesh indices, or magic param lists in engine paths; Gaoxiong hacks removed/generalized.
- **AC-5.9** The 0.4.0 runtime fixes (idle-reservation watchdog, hidden-tab texture race, bg fit idempotency) survive the module split.

### P2-6 — Spine viewer (owner decision)

- **6a Research spike** (report + throwaway code): spine index.json schema, asset layout, runtime choice (pixi-spine vs spine-ts), Spine Runtimes License terms for personal local use, what interactions spine skins carry. Output: go/no-go + chosen runtime + fetch plan.
- **6b Fetch pipeline**: spine mode in fetch-model.py (on-demand, ledger + cache integration, sha256 manifest, no mass download).
- **6c Viewer**: spine render mode (route or `?spine=`), picker integration (~400 entries), wall-mode compatibility, ctl/IPC basics.

- **AC-6.1** 3 representative spine skins render + idle-loop in a real browser; on-demand download via the picker works.
- **AC-6.2** Picker lists the spine catalog; counts match index.json.
- **AC-6.3** Wall mode renders via the GTK host with no console errors; memory within ~1.5× of an l2d view.
- **AC-6.4** Interaction limits documented per 6a findings — no invented interactions.

### P3-7 — Test harness (cross-cutting)

- node:test slices: catalog loader, engine pure logic (trigger gating, param smoothing, state transitions) with fixture drags[] JSON.
- Browser probe harness (CDP): wraps the probe lessons (occluded-tab rAF throttling → drive internalModel.update manually; extract-canvas screenshots); scripted AC runs produce screenshot + console-log evidence.
- Automated AC-4.1 (drift) and AC-5.6 (census) runnable via one command.

**AC-7.1** `node --test` + a single browser-probe command cover every automated AC, needing only serve.py.

## 3. Verification protocol (owner step 4)

- Every bug: reproduce → fix → re-verify in browser; evidence kept per AC.
- Cross-check skins: antu_2 (primary), benningdun_2, wuqi_3 (+ gaoxiong_7); side-by-side nagami when in doubt.
- Honest reporting: fail = fail with output. Commits per fix (conventional), no push without the owner's request; STATUS.md updated per work unit; empty-workspace courtesy on the live desktop.

## 4. Risks / notes

- Reverse-engineered trigger semantics have per-type edge cases; each type validated against nagami live during implementation.
- Voice gating must not let chatter block interactions: only interaction-initiated voice gates, with the bubble-duration cap (AC-2.5).
- The engine split must preserve the patched 0.4.0 workarounds (AC-5.9).
- Spine licensing confirmed in 6a before any asset fetch; personal local use, consistent with the repo's IP stance.
