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
    autoDensity: true,
    antialias: false,
    preserveDrawingBuffer: true,
});
// Start capped at 30 FPS quiet desktop mode (SPEC §155)
app.ticker.maxFPS = 30;
document.body.appendChild(app.view);

// ---------- Performance instrumentation & Adaptive Activity (60fps active / 30fps idle) ----------
let lastActiveTime = performance.now();
let isDynamicCameraLerping = false;
let userTargetFps = parseInt(new URLSearchParams(location.search).get('fps'), 10) || 60;

const perf = {
    cubismMs: 0,
    cameraMs: 0,
    hotspotsMs: 0,
    totalTickMs: 0,
    fps: 0,
    maxFPS: 30,
    mode: 'idle', // 'idle' | 'active' | 'paused'
};

function touchActivity() {
    lastActiveTime = performance.now();
    const activeCap = Math.max(30, userTargetFps);
    if (app.ticker.maxFPS !== activeCap) {
        app.ticker.maxFPS = activeCap;
        perf.maxFPS = activeCap;
        perf.mode = 'active';
    }
}

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

// ---------- per-prefab storage (R1a.5) ----------
const WALL_MODE = new URLSearchParams(location.search).has('wall');
const placementKey = () => `mizu.placement.${MODEL}${WALL_MODE ? '.wall' : ''}`;
const settingsKey = () => `mizu.settings.${MODEL}${WALL_MODE ? '.wall' : ''}`;

function readStored(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeStored(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}
function removeStored(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
}
const I18N = {
    en: {
        tipsTitle: "L2D interaction hints",
        lockTitle: "Lock placement: tap & touch interactions",
        unlockTitle: "Unlock placement: drag to move, wheel to zoom",
        resetPlacementTitle: "Reset placement & zoom",
        muteTitle: "Mute voice",
        unmuteTitle: "Unmute voice",
        chatterTitle: "Periodic idle chatter",
        chatterOffTitle: "Idle chatter disabled",
        tooltipOnTitle: "Interaction tooltips (hover annotations)",
        tooltipOffTitle: "Tooltips disabled (immersive mode)",
        gazeOnTitle: "Gaze follow cursor (enabled)",
        gazeOffTitle: "Gaze follow cursor (disabled)",
        stepNextTitle: "Next interaction in sequence",
        stepResetTitle: "Reset pose to default",
        modelPickerTitle: "Select Live2D Model",
        settingsTitle: "Live2D Settings",
        zoneHead: "Head: Tap to interact",
        zoneBody: "Body: Tap to interact",
        zoneSpecial: "Special: Special reaction",
        zoneDragStart: "Start drag sequence",
        zoneStepNext: "Next sequence step",
        zonePoseReset: "Reset pose to default",
        settingsHeader: "Live2D Settings",
        langLabel: "Display Language",
        langDesc: "Switch interface and tooltip language",
        gazeLabel: "Gaze Follow Cursor",
        gazeDesc: "Character smoothly tracks mouse pointer",
        lockLabel: "Lock Placement",
        lockDesc: "Lock position to enable seamless touch interactions",
        tooltipsLabel: "Floating Tooltips",
        tooltipsDesc: "Display floating annotations on touch zones",
        hintsLabel: "L2D Badges & Hints",
        hintsDesc: "Show interactive badges on character touch zones",
        muteLabel: "Character Voice",
        muteDesc: "Play voice clips when interacting with character",
        chatterLabel: "Idle Chatter",
        chatterDesc: "Play periodic voicelines when resting in idle pose",
        propHover: "Casting Slate (Settings / Expressions / Outfits)",
        propHoverGeneric: "Interactive Prop (Settings / Expressions / Outfits)",
        propTitle: "Manjuu Casting Slate",
        propSubtitle: "Studio Prop · Settings & Expressions",
        tabExp: "Expressions",
        tabCostumes: "Costumes & Poses",
        tabSettings: "Quick Settings",
        expDesc: "Choose facial expression for character:",
        costumesDesc: "Customize casting photos, props and outfits:",
        settingsDesc: "Quick system controls:",
        openFullSettings: "Full Live2D Settings",
        openFullSettingsSub: "Open detailed settings modal and preferences",
        toggleLock: "Toggle Placement Lock",
        toggleLockSub: "Switch between dragging and direct touch",
        toggleGaze: "Gaze Follow Cursor",
        toggleGazeSub: "Character tracks mouse pointer with eyes and head",
        toggleTips: "Interaction Hints & Badges",
        toggleTipsSub: "Display badges on character touch zones",
        resetView: "Reset Camera View",
        resetViewSub: "Restore default position and scale",
    },
    vi: {
        tipsTitle: "Gợi ý tương tác L2D",
        lockTitle: "Khoá vị trí: chạm & tương tác trực tiếp",
        unlockTitle: "Mở khoá vị trí: kéo để di chuyển, cuộn để zoom",
        resetPlacementTitle: "Đặt lại vị trí & thu phóng",
        muteTitle: "Tắt tiếng giọng nói",
        unmuteTitle: "Bật tiếng giọng nói",
        chatterTitle: "Lời thoại ngẫu nhiên",
        chatterOffTitle: "Đã tắt lời thoại ngẫu nhiên",
        tooltipOnTitle: "Chú thích tương tác (hiện khung chữ khi rê chuột)",
        tooltipOffTitle: "Đã tắt chú thích (chế độ nhập tâm)",
        gazeOnTitle: "Nhìn theo con trỏ chuột (đang bật)",
        gazeOffTitle: "Nhìn theo con trỏ chuột (đã tắt)",
        stepNextTitle: "Bước tương tác tiếp theo trong chuỗi",
        stepResetTitle: "Trở về tư thế ban đầu",
        modelPickerTitle: "Đổi nhân vật Live2D",
        settingsTitle: "Cài đặt Live2D",
        zoneHead: "Đầu: Chạm để tương tác",
        zoneBody: "Thân: Chạm để tương tác",
        zoneSpecial: "Đặc biệt: Phản ứng đặc biệt",
        zoneDragStart: "Bắt đầu chuỗi tương tác kéo",
        zoneStepNext: "Bước tương tác tiếp theo",
        zonePoseReset: "Trở về tư thế ban đầu",
        settingsHeader: "Cài đặt Live2D",
        langLabel: "Ngôn ngữ hiển thị",
        langDesc: "Chuyển đổi ngôn ngữ giao diện và chú thích",
        gazeLabel: "Nhìn theo con trỏ chuột",
        gazeDesc: "Nhân vật chuyển động đầu và mắt dõi theo con trỏ",
        lockLabel: "Khoá vị trí nhân vật",
        lockDesc: "Khoá kéo thả để thao tác chạm tương tác chuẩn xác",
        tooltipsLabel: "Khung chú thích tương tác",
        tooltipsDesc: "Hiển thị khung chữ chú thích khi rê chuột vào điểm chạm",
        hintsLabel: "Gợi ý & Huy hiệu L2D",
        hintsDesc: "Hiển thị các huy hiệu tròn tại các vùng tương tác",
        muteLabel: "Giọng nói nhân vật",
        muteDesc: "Phát lời thoại lồng tiếng khi chạm tương tác",
        chatterLabel: "Lời thoại ngẫu nhiên",
        chatterDesc: "Tự động phát lời thoại khi nghỉ nhàn rỗi",
        propHover: "Bảng Casting (Cài đặt / Biểu cảm / Trang phục)",
        propHoverGeneric: "Đạo cụ tương tác (Cài đặt / Biểu cảm / Trang phục)",
        propTitle: "Bảng Manjuu Casting",
        propSubtitle: "Đạo cụ Studio · Cài đặt & Biểu cảm",
        tabExp: "Biểu cảm",
        tabCostumes: "Trang phục & Poses",
        tabSettings: "Cài đặt nhanh",
        expDesc: "Chọn biểu cảm khuôn mặt cho nhân vật:",
        costumesDesc: "Tùy chỉnh ảnh casting, đạo cụ và trang phục:",
        settingsDesc: "Các thao tác nhanh cho hệ thống:",
        openFullSettings: "Cài đặt Live2D chi tiết",
        openFullSettingsSub: "Mở bảng điều khiển hệ thống và cấu hình",
        toggleLock: "Khóa / Mở khóa vị trí",
        toggleLockSub: "Chuyển đổi thao tác kéo thả và chạm",
        toggleGaze: "Nhìn theo con trỏ chuột",
        toggleGazeSub: "Nhân vật chuyển động mắt và đầu dõi theo chuột",
        toggleTips: "Gợi ý tương tác L2D",
        toggleTipsSub: "Hiển thị các huy hiệu và vùng chạm",
        resetView: "Căn giữa góc nhìn",
        resetViewSub: "Khôi phục vị trí và tỉ lệ mặc định",
    }
};

let currentLang = 'vi';
function t(key) {
    return (I18N[currentLang] && I18N[currentLang][key]) || I18N.vi[key] || key;
}

function loadSettings() {
    return {
        tips: false,
        mute: WALL_MODE,
        chatter: true,
        placementLocked: true,
        gaze: true,
        lang: 'vi',
        ...(readStored(settingsKey()) ?? {})
    };
}
function saveSettings(patch) { writeStored(settingsKey(), { ...loadSettings(), ...patch }); }

const tipsToggle = document.getElementById('tips-toggle');
const lockToggle = document.getElementById('lock-toggle');
const gazeToggle = document.getElementById('gaze-toggle');
const tipsLabel = document.getElementById('tips-label');
const resetBtn = document.getElementById('view-reset');
const stateStepBtn = document.getElementById('state-step');
const stateResetBtn = document.getElementById('state-reset');
const tooltipToggle = document.getElementById('tooltip-toggle');
const settingsToggle = document.getElementById('settings-toggle');
const settingsModal = document.getElementById('settings-modal');
const settingsCloseBtn = document.getElementById('settings-close-btn');

const langBtnVi = document.getElementById('lang-btn-vi');
const langBtnEn = document.getElementById('lang-btn-en');
const setGazeCheck = document.getElementById('set-gaze-check');
const setLockCheck = document.getElementById('set-lock-check');
const setTooltipsCheck = document.getElementById('set-tooltips-check');
const setBadgesCheck = document.getElementById('set-badges-check');
const setVoiceCheck = document.getElementById('set-voice-check');
const setChatterCheck = document.getElementById('set-chatter-check');

const initialSettings = loadSettings();
let placementLocked = initialSettings.placementLocked ?? true;
let gazeFollowEnabled = initialSettings.gaze !== false;
currentLang = initialSettings.lang || 'vi';

tipsToggle?.addEventListener('click', () => setTips(!tipsOn));
resetBtn?.addEventListener('click', resetView);
lockToggle?.addEventListener('click', () => setLock(!placementLocked));
gazeToggle?.addEventListener('click', () => setGaze(!gazeFollowEnabled));
stateStepBtn?.addEventListener('click', () => StateManager.next());
stateResetBtn?.addEventListener('click', () => StateManager.reset());
tooltipToggle?.addEventListener('click', () => setTooltip(!tipsTooltipEnabled));

function setSettingsOpen(open) {
    if (settingsModal) {
        settingsModal.hidden = !open;
        settingsToggle?.classList.toggle('open', open);
        settingsToggle?.setAttribute('aria-expanded', String(open));
        if (open) {
            picker?.setOpen(false);
            syncSettingsModal();
        }
    }
}
settingsToggle?.addEventListener('click', () => setSettingsOpen(settingsModal.hidden));
settingsCloseBtn?.addEventListener('click', () => setSettingsOpen(false));

function syncSettingsModal() {
    if (setGazeCheck) setGazeCheck.checked = gazeFollowEnabled;
    if (setLockCheck) setLockCheck.checked = placementLocked;
    if (setTooltipsCheck) setTooltipsCheck.checked = tipsTooltipEnabled;
    if (setBadgesCheck) setBadgesCheck.checked = tipsOn;
    if (setVoiceCheck) setVoiceCheck.checked = !(dialogue?.state.mute ?? false);
    if (setChatterCheck) setChatterCheck.checked = dialogue?.state.chatter ?? true;
    if (langBtnVi) langBtnVi.classList.toggle('active', currentLang === 'vi');
    if (langBtnEn) langBtnEn.classList.toggle('active', currentLang === 'en');
}

langBtnVi?.addEventListener('click', () => setLanguage('vi'));
langBtnEn?.addEventListener('click', () => setLanguage('en'));
setGazeCheck?.addEventListener('change', (e) => setGaze(e.target.checked));
setLockCheck?.addEventListener('change', (e) => setLock(e.target.checked));
setTooltipsCheck?.addEventListener('change', (e) => setTooltip(e.target.checked));
setBadgesCheck?.addEventListener('change', (e) => setTips(e.target.checked));
setVoiceCheck?.addEventListener('change', (e) => dialogue?.setMuted(!e.target.checked));
setChatterCheck?.addEventListener('change', (e) => dialogue?.setChatter(e.target.checked));

function setGaze(on, save = true) {
    gazeFollowEnabled = Boolean(on);
    if (gazeToggle) {
        gazeToggle.classList.toggle('active', gazeFollowEnabled);
        gazeToggle.classList.toggle('off', !gazeFollowEnabled);
        gazeToggle.setAttribute('aria-pressed', String(gazeFollowEnabled));
        gazeToggle.title = gazeFollowEnabled ? t('gazeOnTitle') : t('gazeOffTitle');
    }
    if (setGazeCheck) setGazeCheck.checked = gazeFollowEnabled;
    if (!gazeFollowEnabled && model) {
        model.focus(window.innerWidth / 2, window.innerHeight * 0.35);
    } else if (gazeFollowEnabled && model && pointerGlobal.x >= 0) {
        model.focus(pointerGlobal.x, pointerGlobal.y);
    }
    if (save) saveSettings({ gaze: gazeFollowEnabled });
}

function setLanguage(lang, save = true) {
    currentLang = lang === 'en' ? 'en' : 'vi';
    document.documentElement.lang = currentLang;

    const setElem = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    setElem('st-header', t('settingsHeader'));
    setElem('st-lang-lbl', t('langLabel'));
    setElem('st-lang-sub', t('langDesc'));
    setElem('st-gaze-lbl', t('gazeLabel'));
    setElem('st-gaze-sub', t('gazeDesc'));
    setElem('st-lock-lbl', t('lockLabel'));
    setElem('st-lock-sub', t('lockDesc'));
    setElem('st-tips-lbl', t('tooltipsLabel'));
    setElem('st-tips-sub', t('tooltipsDesc'));
    setElem('st-badges-lbl', t('hintsLabel'));
    setElem('st-badges-sub', t('hintsDesc'));
    setElem('st-voice-lbl', t('muteLabel'));
    setElem('st-voice-sub', t('muteDesc'));
    setElem('st-chatter-lbl', t('chatterLabel'));
    setElem('st-chatter-sub', t('chatterDesc'));

    if (langBtnVi) langBtnVi.classList.toggle('active', currentLang === 'vi');
    if (langBtnEn) langBtnEn.classList.toggle('active', currentLang === 'en');

    if (tipsToggle) tipsToggle.title = t('tipsTitle');
    if (lockToggle) lockToggle.title = placementLocked ? t('lockTitle') : t('unlockTitle');
    if (gazeToggle) gazeToggle.title = gazeFollowEnabled ? t('gazeOnTitle') : t('gazeOffTitle');
    if (resetBtn) resetBtn.title = t('resetPlacementTitle');
    const muteBtn = document.getElementById('voice-mute');
    if (muteBtn) muteBtn.title = dialogue?.state.mute ? t('unmuteTitle') : t('muteTitle');
    const chatterBtn = document.getElementById('voice-chatter');
    if (chatterBtn) chatterBtn.title = dialogue?.state.chatter ? t('chatterTitle') : t('chatterOffTitle');
    if (tooltipToggle) tooltipToggle.title = tipsTooltipEnabled ? t('tooltipOnTitle') : t('tooltipOffTitle');
    if (stateStepBtn) stateStepBtn.title = t('stepNextTitle');
    if (stateResetBtn) stateResetBtn.title = t('stepResetTitle');
    if (settingsToggle) settingsToggle.title = t('settingsTitle');

    if (picker?.setLanguage) picker.setLanguage(currentLang);
    PropManager.setLanguage(currentLang);
    buildHotspots();
    if (save) saveSettings({ lang: currentLang });
}

function setTips(on, save = true) {
    tipsOn = on;
    tipsOnAt = performance.now() / 1000;
    tipsToggle?.classList.toggle('on', tipsOn);
    tipsToggle?.setAttribute('aria-pressed', String(tipsOn));
    badgeLayer.visible = tipsOn;
    setHovered(null);
    if (tipsOn && hotspots.length) updateHotspots();
    if (save) saveSettings({ tips: tipsOn });
}

function setLock(locked, save = true) {
    placementLocked = Boolean(locked);
    if (lockToggle) {
        lockToggle.classList.toggle('locked', placementLocked);
        lockToggle.setAttribute('aria-pressed', String(placementLocked));
        lockToggle.title = placementLocked ? t('lockTitle') : t('unlockTitle');
    }
    if (setLockCheck) setLockCheck.checked = placementLocked;
    if (save) saveSettings({ placementLocked });
}

let currentSkins = null;

// ---------- interaction engine (PARITY-PLAN Task 10) ----------
// The drags[] engine owns pose bookkeeping, trigger recognition and parameter
// writes; StateManager becomes a thin motion facade over it.
let engineZones = null;     // { zones, paramListeners, meta, fallbackUsed }
let engineState = null;     // idle-pose state machine
let engineTriggers = null;  // pointer recognition + gating
let engineParams = null;    // param writer (pointer routing lands in Task 11)
let engineLastAction = null;
let paramDragZone = null;   // zone whose parameter follows the pointer
let paramDragLastT = 0;
let pendingParam = null;    // armed on down; starts the drag after real movement

function readParam(name) {
    if (!model || !name) return 0;
    const cm = model.internalModel.coreModel;
    const ids = cm?._model?.parameters?.ids;
    const i = ids ? ids.indexOf(name) : -1;
    return i >= 0 ? cm.getParameterValueByIndex(i) : 0;
}

function writeParam(name, v) {
    if (!model || !name) return;
    const cm = model.internalModel.coreModel;
    const ids = cm?._model?.parameters?.ids;
    const i = ids ? ids.indexOf(name) : -1;
    if (i >= 0) cm.setParameterValueByIndex(i, v);
}

function readParamDefault(name) {
    if (!model || !name) return 0;
    const cm = model.internalModel.coreModel;
    const ids = cm?._model?.parameters?.ids;
    const defs = cm?._model?.parameters?.defaultValues;
    const i = ids ? ids.indexOf(name) : -1;
    return i >= 0 ? defs[i] : 0;
}

function setPartOpacityByName(name, v) {
    if (!model || !name) return;
    const parts = model.internalModel.coreModel?._model?.parts;
    if (!parts) return;
    const i = parts.ids.indexOf(name);
    if (i >= 0) model.internalModel.coreModel.setPartOpacityByIndex(i, v);
}

// The engine's fire callback: dialogue + motion through the StateManager
// facade (which consults the state engine for the pose switch).
// type-5 removeComList: hide the listed parts while the action plays
function applyRemoveComList(action, active) {
    if (!engineParams || !engineZones || !action) return;
    const a = String(action).toLowerCase();
    for (const zone of engineZones.zones) {
        if (zone.trigger && zone.trigger.type === 5 && String(zone.action).toLowerCase() === a) {
            engineParams.applyVisibility(zone, active);
        }
    }
}

function engineFire(zone, action) {
    void zone;
    if (!action) return;
    lastTap = action;
    engineLastAction = action;
    const lineKey = window.MizuDialogue?.keyForAction(action);
    if (lineKey) dialogue?.say(lineKey);
    StateManager.playAction(action);
}

function setupInteractionEngine(skins) {
    const drawableIds = model.internalModel.getDrawableIDs();
    const motionGroups = Object.keys(model.internalModel.settings.motions || {});
    const flags = placementIndex && placementIndex.skins ? placementIndex.skins[MODEL] : undefined;
    const reg = window.MizuEngine.buildZones({ skins, flags, drawableIds, motionGroups });
    engineZones = { ...reg, fallbackUsed: reg.zones.length === 0 };
    const allZones = [...reg.zones, ...reg.paramListeners];

    engineState = window.MizuEngine.createStateEngine({
        zones: allZones,
        idleMotions: StateManager.idleMotions,
        ctx: {
            // low-level hooks only — StateManager orchestrates the facade
            playMotion(group) { if (model) model.motion(group, 0, 3); },
            setIdleGroup(group) { if (model) model.internalModel.motionManager.groups.idle = group; },
            playingGroup() { return model ? model.internalModel.motionManager.state.currentGroup : undefined; },
            now: () => performance.now(),
        },
    });

    engineTriggers = window.MizuEngine.createTriggerEngine({
        zones: reg.zones,
        ctx: {
            paramValue: readParam,
            // motion + interaction-voice window both read as busy; type-6
            // zones bypass inside the engine (spec decision 1)
            isMotionPlaying: () => interactionBusy(),
            canFire: (zone) => (engineState ? engineState.canFire(zone) : true),
            now: () => performance.now(),
            fire: engineFire,
        },
    });

    engineParams = window.MizuEngine.createParamEngine({
        zones: allZones,
        core: {
            getParam: readParam,
            setParam: writeParam,
            defaultValue: readParamDefault,
            setPartOpacity: setPartOpacityByName,
        },
        ctx: {
            now: () => performance.now(),
            setIdleByIndex: (n) => StateManager.setState(n),
            // relations 103 write values by actionList step (sequence position)
            actionIndex: () => {
                const step = StateManager.activeSequence?.step;
                return Number.isFinite(step) && step > 0 ? step - 1 : -1;
            },
        },
    });

    if (engineZones.fallbackUsed) {
        console.log('[mizu-engine] no drags zones resolved; Touch* fallback active for', MODEL);
    }

    window.__mizu.engine = {
        get zones() { return engineZones ? engineZones.zones : []; },
        get paramOnly() { return engineZones ? engineZones.paramListeners.length : 0; },
        get total() { return engineZones ? engineZones.meta.total : 0; },
        get fallbackUsed() { return !!(engineZones && engineZones.fallbackUsed); },
        state: () => (engineState ? engineState.describe() : null),
        get lastAction() { return engineLastAction; },
        canFire: (zone) => (engineState ? engineState.canFire(zone) : true),
        stats: () => (engineTriggers ? engineTriggers.stats() : null),
        get paramEngine() { return engineParams; },
    };
}

// One-shot enforcement bookkeeping: { group, t } for the currently playing
// non-idle motion (see the tick watchdog).
let activeMotionSince = null;

// Camera-parameter restore state (see the tick comment): the fixed Cubism
// camera vocabulary is a runtime convention, not skin data.
const CAMERA_PARAM_NAMES = [
    'CameraX', 'CameraY', 'CameraS',
    'ParamCameraPositionX', 'ParamCameraPositionY', 'ParamCameraX', 'ParamCameraY', 'ParamCameraScale',
    'ParamCaraCameraPositionX', 'ParamCaraCameraPositionY', 'ParamCaraCameraScale',
    'ParamCharaMainPositionX', 'ParamCharaMainPositionY', 'ParamCharaMainScale',
];
const CAMERA_RESTORE_MS = 300;
let motionWasPlaying = false;
let motionWasPlayingGroup = null;
let motionTouchedCamera = new Set();
let cameraRestore = null; // { start: Map(paramIndex -> value), t0 }

function trackMotionCameraTouch() {
    if (!model || !motionWasPlaying) return;
    const cm = model.internalModel.coreModel;
    const ids = cm?._model?.parameters?.ids;
    const defs = cm?._model?.parameters?.defaultValues;
    if (!ids || !defs) return;
    for (const name of CAMERA_PARAM_NAMES) {
        const i = ids.indexOf(name);
        if (i < 0) continue;
        if (Math.abs(cm.getParameterValueByIndex(i) - defs[i]) > 0.01) motionTouchedCamera.add(name);
    }
}

// Motion loop policy (nagami parity): touch/main/event motions play ONCE and
// the runtime falls back to the current idle group afterwards — many AL touch
// motions ship Loop=true (e.g. gaoxiong_7 touch_head, 15.2 s), which would
// otherwise never hand control back. Pose groups keep looping: idle poses are
// the resting state, and `effect` is the ambient layer.
const LOOPING_GROUP = /^(idle\d*|touch_idle\d+|effect)$/i;

function applyMotionLoopPolicy(m, animatorFades) {
    const mm = m.internalModel.motionManager;
    if (!mm || mm.__mizuLoopPolicy) return;
    mm.__mizuDurations = {};
    const origCreate = mm.createMotion.bind(mm);
    mm.createMotion = async (file, group, index) => {
        const motion = await origCreate(file, group, index);
        if (motion && group) {
            // remember the parsed duration for the one-shot enforcement below
            const d = (motion._loopDurationSeconds
                ?? motion._motionData?.duration
                ?? 0) * 1000
                + ((motion._fadeInSeconds ?? 0) + (motion._fadeOutSeconds ?? 0)) * 1000;
            mm.__mizuDurations[group] = d;
            if (!LOOPING_GROUP.test(group)) {
                if (typeof motion.setLoop === 'function') motion.setLoop(false);
                else motion.isLoop = false;
            }
            // nagami takes the default 0.2 s fade-in from the model's
            // animator.json anyState transitions (per target group)
            const fade = animatorFades && animatorFades.get(group.toLowerCase());
            if (fade && typeof motion.setFadeInTime === 'function') motion.setFadeInTime(fade);
        }
        return motion;
    };
    mm.__mizuLoopPolicy = true;
}

// animator.json (mirrored per prefab): layers[].anyState[{to, duration}] —
// the fade-in each target group is entered with. Missing file = no overrides.
async function loadAnimatorFades(prefab) {
    try {
        const resp = await fetch(`assets/${prefab}/${prefab}.animator.json`);
        if (!resp.ok) return null;
        const data = await resp.json();
        const fades = new Map();
        for (const layer of data?.layers ?? []) {
            for (const tr of layer?.anyState ?? []) {
                if (typeof tr?.to === 'string' && Number.isFinite(tr?.duration) && tr.duration > 0) {
                    const k = tr.to.toLowerCase();
                    if (!fades.has(k)) fades.set(k, tr.duration);
                }
            }
        }
        return fades.size ? fades : null;
    } catch {
        return null;
    }
}

// Interaction gate (spec decision 1): while a non-idle motion plays, or the
// interaction's own voice is still inside its reading window, further triggers
// are ignored — clicks never cut a running animation + voice. The voice branch
// expires with the bubble (dialogue.busyUntil) so a stalled audio element can
// never lock interactions permanently (AC-2.5). Type-6 zones may bypass.
function interactionBusy() {
    if (!model) return false;
    const mm = model.internalModel.motionManager;
    if (mm.state.currentGroup !== undefined && mm.state.currentGroup !== StateManager.currentIdleGroup) return true;
    if (dialogue && performance.now() < (dialogue.busyUntil ?? 0)) return true;
    return false;
}

const StateManager = {
    currentState: 0,
    currentIdleGroup: 'idle',
    baseIdleGroup: 'idle',
    activeSequence: null, // mirrored from the interaction engine
    idleMotions: new Map(), // stateIndex -> motionGroupName
    currentSequenceOffset: { x: 0, y: 0 },

    getSequenceOffset() {
        return this.currentSequenceOffset || { x: 0, y: 0 };
    },

    restoreDefaults() {
        if (!model?.internalModel?.coreModel?._model?.parameters) return;
        const cm = model.internalModel.coreModel;
        const defs = cm._model.parameters.defaultValues;
        for (let i = 0; i < defs.length; i++) {
            cm.setParameterValueByIndex(i, defs[i]);
        }
    },

    init(skins) {
        void skins;
        this.currentState = 0;
        this.activeSequence = null;
        this.currentSequenceOffset = { x: 0, y: 0 };
        this.idleMotions.clear();

        const motions = Object.keys(model?.internalModel?.settings?.motions || {});
        this.baseIdleGroup = motions.find(k => k.toLowerCase() === 'idle') || 'idle';
        this.currentIdleGroup = this.baseIdleGroup;
        this.idleMotions.set(0, this.baseIdleGroup);

        for (const m of motions) {
            const idleMatch = m.match(/^idle(\d+)$/i);
            if (idleMatch) {
                const idx = parseInt(idleMatch[1], 10);
                this.idleMotions.set(idx, m);
            }
            const touchIdleMatch = m.match(/^touch_idle(\d+)$/i);
            if (touchIdleMatch) {
                const idx = parseInt(touchIdleMatch[1], 10);
                if (!this.idleMotions.has(idx)) {
                    this.idleMotions.set(idx, m);
                }
            }
        }

        if (skins && Array.isArray(skins.drags)) {
            // pose bookkeeping lives in the interaction engine; init only keeps
            // the idle-group synthesis (above) and the runtime idle pointer
            void skins;
        }

        if (model) {
            model.internalModel.motionManager.groups.idle = this.baseIdleGroup;
        }
        this.updateUi();
    },

    // Mirror the engine's pose state onto the facade fields the rest of the
    // file (tick, UI, ctl status) reads.
    syncFromEngineState() {
        if (!engineState || !model) return;
        const d = engineState.describe();
        this.currentState = d.state;
        this.currentIdleGroup = d.idleGroup;
        this.currentSequenceOffset = d.offset;
        this.activeSequence = d.sequence;
        model.internalModel.motionManager.groups.idle = d.idleGroup;
    },

    playAction(action) {
        touchActivity();
        if (!model) return false;
        const actLower = action.toLowerCase();

        // Pose groups played without a matching zone (locked-tap advance, ctl
        // motion) settle into that pose — synthesize the state so the busy
        // gate releases when the looping pose motion takes over.
        const poseMatch = /^(?:idle|touch_idle)(\d+)$/i.exec(actLower);
        const zoneMatches = engineZones && engineZones.zones.some(z => (z.action || '').toLowerCase() === actLower);
        if (poseMatch && engineState && !zoneMatches) {
            engineState.setState(parseInt(poseMatch[1], 10));
        }
        if (engineState) engineState.onActionFired(actLower);
        this.syncFromEngineState();

        const started = model.motion(action, undefined, 3);
        applyRemoveComList(actLower, true);
        this.updateUi();
        try { buildHotspots(); } catch (err) { console.error('[mizu] buildHotspots error:', err); }
        return started;
    },

    next() {
        if (this.activeSequence?.nextAction) {
            return this.playAction(this.activeSequence.nextAction);
        }
        const motions = Object.keys(model?.internalModel?.settings?.motions || {});
        const first = motions.find(m => m.toLowerCase() === 'touch_drag1') ||
                      motions.find(m => m.toLowerCase() === 'touch_idle1');
        if (first) return this.playAction(first);
        return false;
    },

    reset() {
        if (engineState) engineState.reset();
        if (engineParams) engineParams.resetParams();
        this.currentState = 0;
        this.activeSequence = null;
        this.currentIdleGroup = this.baseIdleGroup;
        this.currentSequenceOffset = { x: 0, y: 0 };
        this.restoreDefaults();
        cameraRestore = null;
        motionTouchedCamera.clear();
        if (model) {
            model.internalModel.motionManager.groups.idle = this.baseIdleGroup;
            model.motion(this.baseIdleGroup, undefined, 3);
        }
        this.updateUi();
        try { buildHotspots(); } catch (err) { console.error('[mizu] buildHotspots error:', err); }
    },

    setState(target) {
        if (!model) return false;
        if (target === 0) {
            this.reset();
            return true;
        }
        const motions = Object.keys(model.internalModel.settings.motions || {});
        const idleGroup = this.idleMotions.get(target) ||
                          motions.find(m => m.toLowerCase() === `idle${target}`) ||
                          motions.find(m => m.toLowerCase() === `touch_idle${target}`);
        if (!idleGroup) return false;

        // the engine owns the bookkeeping and plays the pose motion via its
        // low-level ctx hooks; the facade mirrors + refreshes the UI
        const ok = engineState ? engineState.setState(target) : false;
        if (!ok) return false;
        this.syncFromEngineState();
        this.updateUi();
        try { buildHotspots(); } catch (err) { console.error('[mizu] buildHotspots error:', err); }
        return true;
    },

    updateUi() {
        const stepBtn = document.getElementById('state-step');
        const resetBtn = document.getElementById('state-reset');
        if (stepBtn) {
            if (this.currentState > 0) {
                stepBtn.classList.add('active');
                stepBtn.setAttribute('title', `Next interaction: ${this.activeSequence?.nextAction || 'Finish'} (Bước tiếp theo)`);
            } else {
                stepBtn.classList.remove('active');
                stepBtn.setAttribute('title', 'Start interaction sequence (Bắt đầu chuỗi tương tác)');
            }
        }
        if (resetBtn) {
            if (this.currentState > 0) {
                resetBtn.classList.add('active');
                resetBtn.setAttribute('title', `Reset pose (Current: Pose ${this.currentState}) / Trở về tư thế ban đầu`);
            } else {
                resetBtn.classList.remove('active');
                resetBtn.setAttribute('title', 'Base pose (Tư thế ban đầu)');
            }
        }
    }
};

function makeBadge(number, labelText = null, type = 'normal') {
    const badge = new PIXI.Container();
    const bob = new PIXI.Container();
    const bubble = new PIXI.Graphics();
    
    // Multi-pass anti-aliased geometry with soft bloom glow
    if (type === 'next') {
        // Next sequence step: Cyan bloom
        bubble.beginFill(0x38bdf8, 0.22).drawCircle(0, -13, 16.5).endFill();
        bubble.beginFill(0x0284c7, 0.45).drawCircle(0, -13, 14.5).endFill();
        bubble.beginFill(0x0369a1, 0.90).drawCircle(0, -13, 12).endFill();
        bubble.lineStyle(1.8, 0x7dd3fc, 0.95).drawCircle(0, -13, 12);
    } else if (type === 'reset') {
        // Reset pose: Violet bloom
        bubble.beginFill(0xa78bfa, 0.22).drawCircle(0, -13, 16.5).endFill();
        bubble.beginFill(0x7c3aed, 0.45).drawCircle(0, -13, 14.5).endFill();
        bubble.beginFill(0x6d28d9, 0.90).drawCircle(0, -13, 12).endFill();
        bubble.lineStyle(1.8, 0xc4b5fd, 0.95).drawCircle(0, -13, 12);
    } else if (type === 'prop') {
        // Environmental prop / Casting board: Cyan and Amber tech slate
        bubble.beginFill(0x38bdf8, 0.28).drawCircle(0, -13, 17).endFill();
        bubble.beginFill(0x0f172a, 0.88).drawCircle(0, -13, 13).endFill();
        bubble.lineStyle(1.8, 0x38bdf8, 0.95).drawCircle(0, -13, 13);
    } else {
        // Standard touch hint: Ice-white glass with subtle soft glow
        bubble.beginFill(0x38bdf8, 0.18).drawCircle(0, -13, 16).endFill();
        bubble.beginFill(0x0f172a, 0.82).drawCircle(0, -13, 12).endFill();
        bubble.lineStyle(1.6, 0xe2e8f0, 0.92).drawCircle(0, -13, 12);
        // Small pip/notch pointing down
        bubble.beginFill(0xe2e8f0, 0.92).drawPolygon([-3.5, -1, 3.5, -1, 0, 2.5]).endFill();
    }

    const displayText = labelText || String(number);
    const label = new PIXI.Text(displayText, {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontSize: type === 'normal' ? 12 : 13,
        fontWeight: '800',
        fill: type === 'normal' ? 0xf8fafc : 0xffffff,
        dropShadow: true,
        dropShadowColor: 0x000000,
        dropShadowBlur: 3,
        dropShadowDistance: 1,
        dropShadowAlpha: 0.9,
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


const PropManager = {
    isOpen: false,
    activeExpression: null,
    activeExpValues: null,
    curExpValues: null,

    expressions: [
        { id: 'neutral', icon: '🌟', vi: 'Bình thường', en: 'Default',
          params: { ParamEyeRSmile: 0, ParamEyeLSmile: 0, ParamEyeROpen: 1, ParamEyeLOpen: 1, ParamBrowRAngle: 0, ParamBrowLAngle: 0, ParamBrowRForm: 0, ParamBrowLForm: 0, ParamMouthForm: 0, ParamMouthOpenY: 0, ParamCheek: 0 } },
        { id: 'smile', icon: '😊', vi: 'Mỉm cười', en: 'Smiling',
          params: { ParamEyeRSmile: 1, ParamEyeLSmile: 1, ParamMouthForm: 1, ParamBrowRForm: 0.5, ParamBrowLForm: 0.5, ParamCheek: 0.3 } },
        { id: 'shy', icon: '😳', vi: 'Ngại ngùng', en: 'Shy / Blush',
          params: { ParamCheek: 1.0, ParamEyeRSmile: 0.6, ParamEyeLSmile: 0.6, ParamBrowRAngle: -0.4, ParamBrowLAngle: -0.4, ParamMouthForm: 0.3 } },
        { id: 'pout', icon: '😠', vi: 'Hờn dỗi', en: 'Pouting',
          params: { ParamBrowRAngle: 0.7, ParamBrowLAngle: 0.7, ParamBrowRForm: -0.7, ParamBrowLForm: -0.7, ParamMouthForm: -1.0, ParamCheek: 0.5 } },
        { id: 'surprised', icon: '😮', vi: 'Bất ngờ', en: 'Surprised',
          params: { ParamEyeROpen: 1.25, ParamEyeLOpen: 1.25, ParamBrowRAngle: 0.6, ParamBrowLAngle: 0.6, ParamBrowRForm: 0.8, ParamBrowLForm: 0.8, ParamMouthForm: -0.2, ParamMouthOpenY: 0.6, ParamCheek: 0.2 } },
        { id: 'smug', icon: '😏', vi: 'Quyến rũ', en: 'Charming',
          params: { ParamEyeROpen: 0.8, ParamEyeLOpen: 0.8, ParamEyeRSmile: 0.6, ParamEyeLSmile: 0.6, ParamBrowRAngle: -0.2, ParamBrowLAngle: 0.3, ParamMouthForm: 0.8, ParamCheek: 0.4 } },
        { id: 'wink', icon: '😉', vi: 'Nháy mắt', en: 'Wink',
          params: { ParamEyeROpen: 1.0, ParamEyeLOpen: 0.0, ParamEyeLSmile: 1.0, ParamMouthForm: 0.8, ParamBrowRAngle: 0.2, ParamBrowLAngle: 0.5, ParamCheek: 0.4 } },
        { id: 'puppy', icon: '🥺', vi: 'Đáng yêu', en: 'Puppy Eyes',
          params: { ParamEyeROpen: 1.1, ParamEyeLOpen: 1.1, ParamEyeRSmile: 0.4, ParamEyeLSmile: 0.4, ParamBrowRAngle: -0.6, ParamBrowLAngle: -0.6, ParamBrowRForm: -0.5, ParamBrowLForm: -0.5, ParamMouthForm: -0.3, ParamCheek: 0.8 } }
    ],

    init() {
        // Bottom bar button toggle
        const propToggle = document.getElementById('prop-toggle');
        propToggle?.addEventListener('click', () => {
            PropManager.toggle();
        });

        // Tab switching
        document.querySelectorAll('.prop-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                document.querySelectorAll('.prop-tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.prop-tab-pane').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`pane-${tab}`)?.classList.add('active');
            });
        });

        // Close button
        document.getElementById('prop-menu-close-btn')?.addEventListener('click', () => {
            PropManager.close();
        });

        // Quick settings buttons
        document.getElementById('qa-open-settings')?.addEventListener('click', () => {
            PropManager.close();
            setSettingsOpen(true);
        });
        document.getElementById('qa-toggle-lock')?.addEventListener('click', () => {
            setLock(!placementLocked);
            PropManager.updateQuickSettingsUI();
        });
        document.getElementById('qa-toggle-gaze')?.addEventListener('click', () => {
            setGaze(!gazeFollowEnabled);
            PropManager.updateQuickSettingsUI();
        });
        document.getElementById('qa-toggle-tips')?.addEventListener('click', () => {
            setTips(!tipsOn);
            PropManager.updateQuickSettingsUI();
        });
        document.getElementById('qa-reset-view')?.addEventListener('click', () => {
            resetView();
            PropManager.close();
        });

        // Close on escape
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && PropManager.isOpen) {
                PropManager.close();
            }
        });
    },

    setLanguage(lang) {
        const setElem = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };
        setElem('pm-title', t('propHoverGeneric'));
        setElem('pm-subtitle', t('propSubtitle'));
        setElem('pm-tab-exp', t('tabExp'));
        setElem('pm-tab-costumes', t('tabCostumes'));
        setElem('pm-tab-settings', t('tabSettings'));
        setElem('pm-exp-desc', t('expDesc'));
        setElem('pm-costumes-desc', t('costumesDesc'));
        setElem('pm-settings-desc', t('settingsDesc'));

        setElem('qa-settings-title', t('openFullSettings'));
        setElem('qa-settings-sub', t('openFullSettingsSub'));
        setElem('qa-lock-title', t('toggleLock'));
        setElem('qa-lock-sub', t('toggleLockSub'));
        setElem('qa-gaze-title', t('toggleGaze'));
        setElem('qa-gaze-sub', t('toggleGazeSub'));
        setElem('qa-tips-title', t('toggleTips'));
        setElem('qa-tips-sub', t('toggleTipsSub'));
        setElem('qa-reset-title', t('resetView'));
        setElem('qa-reset-sub', t('resetViewSub'));

        this.renderExpressions();
        this.renderCostumes();
        this.updateQuickSettingsUI();
    },

    setExpression(id) {
        const exp = this.expressions.find(e => e.id === id);
        if (!exp) return;
        this.activeExpression = id;
        this.activeExpValues = { ...exp.params };
        if (!this.curExpValues) this.curExpValues = {};
        for (const [k, v] of Object.entries(this.activeExpValues)) {
            if (this.curExpValues[k] === undefined) {
                this.curExpValues[k] = 0;
            }
        }
        this.renderExpressions();
    },

    renderExpressions() {
        const grid = document.getElementById('expression-grid');
        if (!grid) return;
        grid.innerHTML = '';
        for (const exp of this.expressions) {
            const btn = document.createElement('button');
            btn.className = `exp-btn ${this.activeExpression === exp.id ? 'active' : ''}`;
            btn.type = 'button';
            btn.innerHTML = `<span class="exp-emoji">${exp.icon}</span><span class="exp-label">${currentLang === 'vi' ? exp.vi : exp.en}</span>`;
            btn.addEventListener('click', () => {
                this.setExpression(exp.id);
            });
            grid.appendChild(btn);
        }
    },

    renderCostumes() {
        const list = document.getElementById('costume-list');
        if (!list || !model) return;
        list.innerHTML = '';
        
        const cm = model.internalModel?.coreModel;
        const motions = model.internalModel?.settings?.motions || {};
        const motionKeys = Object.keys(motions);

        // 1. Poses / Motions
        let poses = [];
        // Generic skin poses and motions
        const poseMotions = motionKeys.filter(m => /^(touch_idle|touch_drag|idle\d|special|wedding|dance|swim|sleep)/i.test(m));
        for (const act of poseMotions.slice(0, 10)) {
            let icon = '📸';
            let tag = 'Pose';
            let vi = `Tư thế / Hoạt cảnh (${act})`;
            let en = `Pose / Animation (${act})`;
            if (/idle$/i.test(act)) { icon = '🔄'; tag = 'Base'; vi = 'Tư thế nghỉ cơ bản'; en = 'Reset to Base Idle'; }
            else if (/wedding/i.test(act)) { icon = '💍'; tag = 'Oath'; vi = 'Lễ thề nguyện (Wedding)'; en = 'Oath Ceremony'; }
            else if (/special/i.test(act)) { icon = '✨'; tag = 'Special'; vi = 'Phản ứng đặc biệt'; en = 'Special Reaction'; }
            else if (/touch_idle/i.test(act)) {
                const num = act.replace(/\D/g, '');
                icon = '📸'; tag = 'Sequence';
                vi = `Dáng tương tác ${num || ''}`.trim();
                en = `Interactive Pose ${num || ''}`.trim();
            } else if (/touch_drag/i.test(act)) {
                const num = act.replace(/\D/g, '');
                icon = '▶️'; tag = 'Drag';
                vi = `Bước chuyển động ${num || ''}`.trim();
                en = `Action Step ${num || ''}`.trim();
            }
            poses.push({ act, icon, tag, vi, en });
        }
        if (!poses.some(p => p.act.toLowerCase() === 'idle') && motionKeys.some(m => m.toLowerCase() === 'idle')) {
            poses.push({ act: 'idle', icon: '🔄', tag: 'Base', vi: 'Tư thế nghỉ cơ bản', en: 'Reset to Base Idle' });
        }

        for (const p of poses) {
            const btn = document.createElement('button');
            btn.className = 'costume-item-btn';
            btn.type = 'button';
            btn.innerHTML = `
                <div class="costume-left">
                    <span class="costume-icon">${p.icon}</span>
                    <div class="costume-info">
                        <span class="costume-title">${currentLang === 'vi' ? p.vi : p.en}</span>
                        <span class="costume-sub">${p.act}</span>
                    </div>
                </div>
                <span class="costume-tag">${p.tag}</span>
            `;
            btn.addEventListener('click', () => {
                StateManager.playAction(p.act);
            });
            list.appendChild(btn);
        }

        // 2. Detachable Costumes, Accessories & Environment Props
        if (cm?._model?.parts) {
            const parts = cm._model.parts;
            let propToggles = [];

            if (isTakao) {
                propToggles = [
                    { partIds: ['Part114', 'Part115'], icon: '📋', vi: 'Bảng Manjuu Casting', en: 'Manjuu Casting Stand' },
                    { partIds: ['Part110', 'Part111', 'Part112', 'Part113'], icon: '🪑', vi: 'Bàn ghế Studio', en: 'Studio Furniture' },
                    { partIds: ['Part118'], icon: '🖼️', vi: 'Phông nền phòng Studio', en: 'Studio Backdrop' }
                ];
            } else {
                const partKeywords = [
                    { rx: /coat|jacket|mantle|cape|outer|waitao|dayi/i, icon: '🧥', vi: 'Áo khoác / Áo choàng', en: 'Coat / Jacket' },
                    { rx: /dress|skirt|qunzi/i, icon: '👗', vi: 'Váy / Trang phục', en: 'Dress / Skirt' },
                    { rx: /cloth|swim|bikini|apron/i, icon: '🎽', vi: 'Trang phục rời', en: 'Detachable Outfit' },
                    { rx: /glass|glasses|megane|yanjing/i, icon: '👓', vi: 'Kính mắt', en: 'Glasses' },
                    { rx: /hat|cap|maozi|mask|crown|halo/i, icon: '👒', vi: 'Mũ / Phụ kiện đầu', en: 'Hat / Headwear' },
                    { rx: /horn|ear|tail|wing|chibang/i, icon: '🦊', vi: 'Tai / Đuôi / Cánh', en: 'Ears / Tail / Wings' },
                    { rx: /shoe|sock|glove|sleeve/i, icon: '🧤', vi: 'Găng tay / Giày tất', en: 'Gloves / Footwear' },
                    { rx: /chair|table|bed|desk|sofa|yizi|zhuozi/i, icon: '🪑', vi: 'Bàn ghế / Nội thất', en: 'Furniture' },
                    { rx: /umbrella|phone|card|cup|bottle|drink|food|daoju/i, icon: '🌂', vi: 'Đạo cụ cầm tay', en: 'Held Prop' },
                    { rx: /board|screen|stand|deco/i, icon: '📋', vi: 'Bảng / Biển trang trí', en: 'Decor Board' },
                    { rx: /mascot|pet|cat|bird/i, icon: '🐥', vi: 'Thú cưng / Linh vật', en: 'Pet / Mascot' },
                    { rx: /bg|back|front|beijing/i, icon: '🖼️', vi: 'Phông nền / Khung cảnh', en: 'Background / Scene' },
                    { rx: /rigging|weapon|gun|sword|shield/i, icon: '⚓', vi: 'Trang bị chiến hạm', en: 'Ship Rigging / Weapon' },
                ];

                const matchedIndices = new Set();
                for (let p = 0; p < parts.ids.length; p++) {
                    const pid = parts.ids[p];
                    for (const kw of partKeywords) {
                        if (kw.rx.test(pid) && !matchedIndices.has(p)) {
                            matchedIndices.add(p);
                            propToggles.push({
                                partIds: [pid],
                                icon: kw.icon,
                                vi: `${kw.vi} (${pid})`,
                                en: `${kw.en} (${pid})`
                            });
                            break;
                        }
                    }
                }
            }

            for (const pt of propToggles) {
                const partIdx = parts.ids.indexOf(pt.partIds[0]);
                const isVisible = partIdx >= 0 ? cm.getPartOpacityByIndex(partIdx) > 0.5 : true;

                const btn = document.createElement('button');
                btn.className = `costume-item-btn ${isVisible ? 'active' : ''}`;
                btn.type = 'button';
                btn.innerHTML = `
                    <div class="costume-left">
                        <span class="costume-icon">${pt.icon || '🪑'}</span>
                        <div class="costume-info">
                            <span class="costume-title">${currentLang === 'vi' ? pt.vi : pt.en}</span>
                            <span class="costume-sub">${isVisible ? (currentLang === 'vi' ? 'Đang hiện' : 'Visible') : (currentLang === 'vi' ? 'Đã ẩn' : 'Hidden')}</span>
                        </div>
                    </div>
                    <span class="costume-tag">${isVisible ? 'ON' : 'OFF'}</span>
                `;
                btn.addEventListener('click', () => {
                    const newVis = !isVisible;
                    for (const pid of pt.partIds) {
                        const idx = parts.ids.indexOf(pid);
                        if (idx >= 0) cm.setPartOpacityByIndex(idx, newVis ? 1 : 0);
                    }
                    this.renderCostumes();
                });
                list.appendChild(btn);
            }
        }
    },

    updateQuickSettingsUI() {
        const qaLockStatus = document.getElementById('qa-lock-status');
        if (qaLockStatus) qaLockStatus.textContent = placementLocked ? (currentLang === 'vi' ? 'Bật' : 'ON') : (currentLang === 'vi' ? 'Tắt' : 'OFF');
        const qaGazeStatus = document.getElementById('qa-gaze-status');
        if (qaGazeStatus) qaGazeStatus.textContent = gazeFollowEnabled ? (currentLang === 'vi' ? 'Bật' : 'ON') : (currentLang === 'vi' ? 'Tắt' : 'OFF');
        const qaTipsStatus = document.getElementById('qa-tips-status');
        if (qaTipsStatus) qaTipsStatus.textContent = tipsOn ? (currentLang === 'vi' ? 'Bật' : 'ON') : (currentLang === 'vi' ? 'Tắt' : 'OFF');
    },

    open() {
        this.isOpen = true;
        const menu = document.getElementById('prop-menu');
        if (menu) menu.hidden = false;
        const propToggle = document.getElementById('prop-toggle');
        if (propToggle) {
            propToggle.classList.add('open');
            propToggle.setAttribute('aria-expanded', 'true');
        }
        this.renderExpressions();
        this.renderCostumes();
        this.updateQuickSettingsUI();
    },

    close() {
        this.isOpen = false;
        const menu = document.getElementById('prop-menu');
        if (menu) menu.hidden = true;
        const propToggle = document.getElementById('prop-toggle');
        if (propToggle) {
            propToggle.classList.remove('open');
            propToggle.setAttribute('aria-expanded', 'false');
        }
    },

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    },

    updateTick(deltaMs) {
        if (!this.activeExpValues || !model?.internalModel?.coreModel) return;
        const cm = model.internalModel.coreModel;
        const ids = cm._model.parameters.ids;
        const lerpFactor = Math.min(1, (deltaMs || 16.6) * 0.008);
        for (const [k, targetVal] of Object.entries(this.activeExpValues)) {
            let idx = ids.indexOf(k);
            if (idx < 0) {
                if (k === 'ParamCheek') {
                    idx = ids.indexOf('ParamFaceRed');
                    if (idx < 0) idx = ids.indexOf('ParamBlush');
                    if (idx < 0) idx = ids.indexOf('ParamCheek1');
                } else if (k === 'ParamEyeRSmile' || k === 'ParamEyeLSmile') {
                    idx = ids.indexOf('ParamEyeSmile');
                }
            }
            if (idx >= 0) {
                const cur = this.curExpValues[k] !== undefined ? this.curExpValues[k] : cm.getParameterValueByIndex(idx);
                const nextVal = cur + (targetVal - cur) * lerpFactor;
                this.curExpValues[k] = nextVal;
                cm.setParameterValueByIndex(idx, nextVal);
            }
        }
    }
};

// Per-zone cooldown from the skin's own drags data (limitTime is seconds in
// skins.json); the 1 s fallback only covers zones with no matching entry.
function dragsLimitTimeMs(skins, part, action) {
    const drags = skins?.drags;
    if (!Array.isArray(drags)) return 1000;
    const hit = drags.find(d => d.part === part || d.trigger?.action === action);
    const lt = hit?.limitTime;
    return Number.isFinite(lt) && lt > 0 ? Math.round(lt * 1000) : 1000;
}

function getIdleBlacklistedParts() {
    const blacklisted = new Set();
    if (currentSkins?.tips?.idleBlackList) {
        for (const rule of currentSkins.tips.idleBlackList) {
            if (rule.idle && rule.idle.includes(StateManager.currentState)) {
                for (const p of (rule.parts || [])) blacklisted.add(p);
            }
        }
    }
    return blacklisted;
}

// nagami-parity counter: "N / M hotspots" counts drags zones only — the
// synthesized assistant touch zones render badges but stay out of the count
function updateHotspotCounter() {
    const el = document.getElementById('hotspot-counter');
    if (!el) return;
    const total = engineZones ? engineZones.meta.total : hotspots.filter(h => h.index >= 0).length;
    if (!total) { el.hidden = true; return; }
    const blacklisted = getIdleBlacklistedParts();
    const visible = hotspots.filter(h => h.zone && h.index >= 0 && !blacklisted.has(h.part)).length;
    el.textContent = `${visible} / ${total} hotspots`;
    el.hidden = false;
}

function buildHotspots(skins) {
    if (skins !== undefined) currentSkins = skins;
    if (!model) return;
    badgeLayer.removeChildren();
    hotspots = [];

    const groups = Object.keys(model.internalModel.settings.motions || {});
    const groupByName = new Map(groups.map(g => [g.toLowerCase(), g]));

    // 1. Zones from the interaction engine (one badge per drags entry whose
    // part resolves to a drawable). The old per-skin prop zones are gone —
    // every clickable area now comes from the skin's own data (AC-5.8).
    const zoneList = engineZones && !engineZones.fallbackUsed ? engineZones.zones : [];
    for (const zone of zoneList) {
        hotspots.push({
            zone,
            action: zone.action,
            index: zone.partIndex,
            part: zone.part,
            label: zone.label,
            cooldown: zone.limitTimeMs,
            lastFired: -Infinity,
            badge: makeBadge(hotspots.length + 1, String(hotspots.length + 1), 'normal'),
        });
    }
    // The assistant touch parts (head/body/special) always respond in the game,
    // but many skins don't list them in drags[] — synthesize them additively
    // unless the data already covers that part or action.
    const drawableIds = model.internalModel.getDrawableIDs();
    const covered = new Set(zoneList.flatMap(z => [z.part, z.action].filter(Boolean).map(s => s.toLowerCase())));
    const primaryZones = [
        { part: 'TouchHead', action: 'touch_head', labelKey: 'zoneHead' },
        { part: 'TouchBody', action: 'touch_body', labelKey: 'zoneBody' },
        { part: 'TouchSpecial', action: 'touch_special', labelKey: 'zoneSpecial' },
    ];
    for (const z of primaryZones) {
        const act = groupByName.get(z.action.toLowerCase());
        const idx = drawableIds.indexOf(z.part);
        if (act && idx !== -1 && !covered.has(z.part.toLowerCase()) && !covered.has(z.action.toLowerCase())) {
            hotspots.push({
                zone: null,
                action: act,
                index: idx,
                part: z.part,
                label: t(z.labelKey),
                cooldown: dragsLimitTimeMs(currentSkins, z.part, act),
                lastFired: -Infinity,
                badge: makeBadge(hotspots.length + 1, String(hotspots.length + 1), 'normal'),
            });
        }
    }

    // 2. Sequence Next & Reset badges (anchored, not mesh-hittable)
    if (StateManager.currentState === 0) {
        const drag1 = groupByName.get('touch_drag1');
        const startAction = drag1 || groupByName.get('touch_idle1');
        if (startAction) {
            hotspots.push({
                zone: null,
                action: startAction,
                index: -1,
                part: 'SequenceStart',
                label: t('zoneDragStart'),
                isSequence: true,
                badgeOffset: { x: 85, y: -10 },
                cooldown: 1000,
                lastFired: -Infinity,
                badge: makeBadge(hotspots.length + 1, '▶', 'next'),
            });
        }
    } else {
        const nextAction = StateManager.activeSequence?.nextAction;
        if (nextAction && groups.includes(nextAction)) {
            const match = nextAction.match(/\d+$/);
            const stepNum = match ? match[0] : '';
            hotspots.push({
                zone: null,
                action: nextAction,
                index: -1,
                part: nextAction,
                label: `${t('zoneStepNext')} ${stepNum}`.trim(),
                isSequence: true,
                badgeOffset: { x: 85, y: -10 },
                cooldown: 1000,
                lastFired: -Infinity,
                badge: makeBadge(hotspots.length + 1, '▶', 'next'),
            });
        }

        const resetAction = StateManager.baseIdleGroup;
        hotspots.push({
            zone: null,
            action: resetAction,
            index: -1,
            part: 'ResetPose',
            label: t('zonePoseReset'),
            isReset: true,
            badgeOffset: { x: -85, y: 15 },
            cooldown: 1000,
            lastFired: -Infinity,
            badge: makeBadge(hotspots.length + 1, '↺', 'reset'),
        });
    }

    updateHotspotCounter();
    if (tipsToggle) tipsToggle.hidden = hotspots.length === 0;
    window.__mizu.hotspots = hotspots;
    if (tipsOn) badgeLayer.visible = true;
}

// Live mesh bbox of a hotspot in model space, or null when the drawable is
// not currently visible. Normally refreshed per tick for badge positioning,
// but hit-testing must never depend on the tips overlay, so findHotspotAtPoint
// fills missing bounds lazily at click time.
function computeHotspotBounds(h) {
    if (!model || (h.index < 0 && !h.meshIndices)) return null;
    const internal = model.internalModel;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const indices = h.meshIndices || [h.index];
    for (const idx of indices) {
        const verts = internal.getDrawableVertices(idx);
        if (!verts) continue;
        for (let i = 0; i < verts.length; i += 2) {
            const x = verts[i], y = verts[i + 1];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
    }
    if (!(maxX - minX > 5 && maxY - minY > 5)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Find hotspot at canvas coordinates: checks visible badge speech bubble first,
// then falls back to mesh bounds with generous hit padding.
function findHotspotAtPoint(canvasPt) {
    for (const h of hotspots) {
        if (!h.bounds && (h.index >= 0 || h.meshIndices)) {
            const b = computeHotspotBounds(h);
            if (b) h.bounds = b;
        }
    }
    if (tipsOn) {
        for (const h of hotspots) {
            if (!h.badge || !h.badge.visible) continue;
            const dist = Math.hypot(canvasPt.x - h.badge.position.x, canvasPt.y - h.badge.position.y);
            if (dist <= 28) return h;
        }
    }
    const mPt = model.toModelPosition(canvasPt, tempModelPoint);
    let best = null;
    const PADDING = 20;
    for (const h of hotspots) {
        const b = h.bounds;
        if (!b || b.w <= 0 || b.h <= 0) continue;
        const pad = h.isProp ? 35 : PADDING;
        if (mPt.x < b.x - pad || mPt.x > b.x + b.w + pad ||
            mPt.y < b.y - pad || mPt.y > b.y + b.h + pad) continue;
        if (!best || h.isProp || (b.w * b.h < best.bounds.w * best.bounds.h && !best.isProp)) best = h;
    }
    return best;
}

let tipsTooltipEnabled = readStored('mizu_tooltip_enabled') !== false;

function setTooltip(enabled) {
    tipsTooltipEnabled = Boolean(enabled);
    writeStored('mizu_tooltip_enabled', tipsTooltipEnabled);
    if (!tipsTooltipEnabled && tipsLabel) {
        tipsLabel.hidden = true;
    }
    const btn = document.getElementById('tooltip-toggle');
    if (btn) {
        btn.classList.toggle('active', tipsTooltipEnabled);
        btn.setAttribute('aria-pressed', String(tipsTooltipEnabled));
        btn.setAttribute('title', tipsTooltipEnabled
            ? 'Interaction tooltips (Bật - Bấm để ẩn / Chế độ nhập tâm)'
            : 'Interaction tooltips (Đã tắt - Chế độ nhập tâm)');
    }
}

function setHovered(h) {
    if (h === hoveredHotspot) {
        if (h && tipsTooltipEnabled) {
            tipsLabel.style.left = `${pointerGlobal.x}px`;
            tipsLabel.style.top = `${pointerGlobal.y}px`;
        }
        return;
    }
    hoveredHotspot = h;
    app.view.style.cursor = h ? 'pointer' : (placementLocked ? 'default' : 'grab');
    if (h && tipsTooltipEnabled) {
        tipsLabel.textContent = h.label || h.action;
        tipsLabel.hidden = false;
        tipsLabel.style.left = `${pointerGlobal.x}px`;
        tipsLabel.style.top = `${pointerGlobal.y}px`;
    } else {
        tipsLabel.hidden = true;
    }
}

function updateHotspots() {
    if (!model) return;
    const internal = model.internalModel;

    // Stable character anchor (screen-space torso)
    const anchorX = Math.max(80, Math.min(window.innerWidth - 80, model.x));
    const anchorY = Math.max(80, Math.min(window.innerHeight - 80, model.y - 50));

    // Determine blacklisted parts for the current idle pose from skins.json (if defined)
    const blacklisted = getIdleBlacklistedParts();

    for (const h of hotspots) {
        h.isOffscreen = false;
        const busyNow = interactionBusy();
        if (blacklisted.has(h.part)) {
            h.badge.visible = false;
            continue;
        }

        if (!h.isSequence && !h.isReset && (h.index >= 0 || h.meshIndices)) {
            const b = computeHotspotBounds(h);
            if (b) {
                h.bounds = b;
                tempCenter.set(b.x + b.w / 2, b.y + b.h / 2);
                internal.localTransform.apply(tempCenter, tempLocal);
                model.toGlobal(tempLocal, tempGlobal);

                // Clamp into visible viewport so boundary parts don't incorrectly jump to the cushion
                const cx = Math.max(35, Math.min(window.innerWidth - 35, tempGlobal.x));
                const cy = Math.max(35, Math.min(window.innerHeight - 35, tempGlobal.y));
                h.badge.position.set(cx, cy);
                h.badge.visible = tipsOn;
            } else {
                h.isOffscreen = true;
            }
        }

        if (h.isSequence || h.isReset || h.isOffscreen) {
            let ox = h.badgeOffset?.x;
            let oy = h.badgeOffset?.y;
            if (ox === undefined) {
                ox = h.isReset ? -90 : (h.isSequence ? 90 : 0);
            }
            if (oy === undefined) {
                oy = h.isReset ? 25 : (h.isSequence ? -20 : -80);
            }
            const targetX = Math.max(40, Math.min(window.innerWidth - 40, anchorX + ox));
            const targetY = Math.max(40, Math.min(window.innerHeight - 40, anchorY + oy));
            h.badge.position.set(targetX, targetY);
            h.badge.visible = tipsOn;
        }

        const active = h === hoveredHotspot;
        const now = performance.now() / 1000;
        const pop = easeOutBack(Math.min(Math.max((now - tipsOnAt - (h.badge.num - 1) * 0.02) / 0.3, 0), 1));
        const sway = Math.sin(now * 2.1 + h.badge.num * 0.55);
        h.badge.bob.y = Math.sin(now * 1.3 + h.badge.num * 0.55) * 1.5;
        h.badge.scale.set((active ? 1.15 : 1) * (1 + sway * 0.035) * pop);
        // nagami parity: markers go muted while a motion (or interaction voice) plays
        h.badge.alpha = (active ? 1 : 0.88) * Math.min(pop, 1) * (busyNow ? 0.35 : 1);
    }

    updateHotspotCounter();

    // Overlap prevention pass (Spring relaxation: ensures badges never stack)
    const MIN_DIST = 38;
    for (let pass = 0; pass < 5; pass++) {
        for (let i = 0; i < hotspots.length; i++) {
            const b1 = hotspots[i].badge;
            if (!b1 || !b1.visible) continue;
            for (let j = i + 1; j < hotspots.length; j++) {
                const b2 = hotspots[j].badge;
                if (!b2 || !b2.visible) continue;
                let dx = b2.position.x - b1.position.x;
                let dy = b2.position.y - b1.position.y;
                let dist = Math.hypot(dx, dy);
                if (dist < MIN_DIST) {
                    if (dist < 0.1) { dx = (j - i) * 6; dy = 12; dist = Math.hypot(dx, dy); }
                    const overlap = (MIN_DIST - dist) / 2;
                    const shiftX = (dx / dist) * overlap;
                    const shiftY = (dy / dist) * overlap;
                    b1.position.x = Math.max(35, Math.min(window.innerWidth - 35, b1.position.x - shiftX));
                    b1.position.y = Math.max(35, Math.min(window.innerHeight - 35, b1.position.y - shiftY));
                    b2.position.x = Math.max(35, Math.min(window.innerWidth - 35, b2.position.x + shiftX));
                    b2.position.y = Math.max(35, Math.min(window.innerHeight - 35, b2.position.y + shiftY));
                }
            }
        }
    }

    if (pointerGlobal.x >= 0 && !(press && press.dragging)) {
        setHovered(findHotspotAtPoint(pointerGlobal));
    }
}

const DRAG_THRESHOLD = 4;
let press = null;

function canvasPoint(e) {
    const r = app.view.getBoundingClientRect();
    return new PIXI.Point(e.clientX - r.left, e.clientY - r.top);
}

function setupPointerEvents() {
    const canvas = app.view;
    canvas.addEventListener('pointermove', (e) => {
        touchActivity();
        const p = canvasPoint(e);
        pointerGlobal.copyFrom(p);
        if (model && gazeFollowEnabled) {
            model.focus(e.clientX, e.clientY);
        }
        engineTriggers?.onEvent({ type: 'move', x: p.x, y: p.y, t: performance.now() }, null);
        if (pendingParam && engineParams && !paramDragZone
            && Math.hypot(p.x - pendingParam.x, p.y - pendingParam.y) > 4) {
            engineParams.onDragStart(pendingParam.zone, pendingParam.x, pendingParam.y);
            paramDragZone = pendingParam.zone;
            paramDragLastT = performance.now();
        }
        if (paramDragZone && engineParams) {
            const now = performance.now();
            engineParams.onDragMove(paramDragZone, p.x, p.y, now - paramDragLastT);
            paramDragLastT = now;
        }
        if (placementLocked) {
            const h = findHotspotAtPoint(p);
            setHovered(h);
            return;
        }
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
        touchActivity();
        if (!model) return;
        const p = canvasPoint(e);
        const h = findHotspotAtPoint(p);
        if (h) {
            press = null;
            // data zones go through the trigger engine (click recognition,
            // cooldowns, busy gate, type-6 bypass); the anchored ▶/↺ badges
            // stay direct UI affordances
            if (h.zone) {
                engineTriggers?.onEvent({ type: 'down', x: p.x, y: p.y, t: performance.now() }, h.zone);
                // parameter-drag zones: arming is deferred until the pointer
                // actually moves (a plain tap must not pin the param)
                if (engineParams && (h.zone.param || (h.zone.trigger && h.zone.trigger.type === 13))) {
                    pendingParam = { zone: h.zone, x: p.x, y: p.y };
                }
                return;
            }
            const now = performance.now();
            if (now - h.lastFired < h.cooldown) return;
            if (!h.isReset && interactionBusy()) return;
            h.lastFired = now;
            lastTap = h.action;
            engineLastAction = h.action;
            if (h.isReset) StateManager.reset();
            else {
                const lineKey = window.MizuDialogue?.keyForAction(h.action);
                if (lineKey) dialogue?.say(lineKey);
                StateManager.playAction(h.action);
            }
            return;
        }
        if (placementLocked) {
            // The empty-canvas tap is an interaction too: it must respect the
            // busy gate (a running animation+voice is never cut) exactly like
            // zone clicks do.
            if (interactionBusy()) return;
            // In locked mode: tapping on model advances sequence if in resting sequence
            if (StateManager.currentState > 0 && StateManager.activeSequence?.nextAction) {
                StateManager.next();
                return;
            }
            model.tap(e.clientX, e.clientY);
            const lineKey = window.MizuDialogue?.keyForAction('touch_body');
            if (lineKey) dialogue?.say(lineKey);
            return;
        }
        press = { start: p, last: p, dragging: false };
    });

    window.addEventListener('pointerup', (e) => {
        touchActivity();
        if (engineTriggers) {
            const p = canvasPoint(e);
            engineTriggers.onEvent({ type: 'up', x: p.x, y: p.y, t: performance.now() }, null);
        }
        if (paramDragZone && engineParams) {
            engineParams.onDragEnd(paramDragZone);
            paramDragZone = null;
        }
        pendingParam = null;
        if (press && press.dragging) {
            canvas.style.cursor = hoveredHotspot ? 'pointer' : 'grab';
            saveView();
        }
        press = null;
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        touchActivity();
        if (!model || placementLocked) return;
        zoomAt(canvasPoint(e), Math.exp(-e.deltaY * 0.001));
        saveView();
    }, { passive: false });
}

const ZOOM_MIN = 0.3, ZOOM_MAX = 3;
let placementBase = null; // { designHeight, ppu, scale, effX, effY } from skins + index
let view = { dx: 0, dy: 0, zoom: 1 };
let currentCamera = { x: 0, y: 0, zoom: 1 };
let targetCamera = { x: 0, y: 0, zoom: 1 };

function sampleCameraParameters() {
    if (!model?.internalModel?.coreModel) return { x: 0, y: 0, zoom: 1 };
    const cm = model.internalModel.coreModel;
    const ids = cm._model?.parameters?.ids;
    if (!ids) return { x: 0, y: 0, zoom: 1 };

    let camX = 0, camY = 0, camS = 0;

    const getParam = (name) => {
        const idx = ids.indexOf(name);
        return idx >= 0 ? cm.getParameterValueByIndex(idx) : 0;
    };

    // 1. Native model camera parameters (calibrated 1:1, without arbitrary 3x/2.5x multipliers)
    camX += getParam('CameraX');
    camY += getParam('CameraY');
    camS += getParam('CameraS') * 0.02;

    camX += (getParam('ParamCameraPositionX') + getParam('ParamCameraX'));
    camY += (getParam('ParamCameraPositionY') + getParam('ParamCameraY'));
    camS += getParam('ParamCameraScale') * 0.02;

    camX += (getParam('ParamCaraCameraPositionX') + getParam('ParamCharaMainPositionX'));
    camY += (getParam('ParamCaraCameraPositionY') + getParam('ParamCharaMainPositionY'));
    camS += (getParam('ParamCaraCameraScale') + getParam('ParamCharaMainScale')) * 0.02;

    // 2. Active interaction / sequence offset from skins.json (e.g. Takao kneading offsetY = -250)
    const seqOffset = StateManager.getSequenceOffset();
    camX += seqOffset.x;
    camY += seqOffset.y;

    return {
        x: camX,
        y: camY,
        zoom: Math.max(0.4, Math.min(2.5, 1 + camS))
    };
}

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
    currentCamera = { x: 0, y: 0, zoom: 1 };
    targetCamera = { x: 0, y: 0, zoom: 1 };
    view = loadView();
    renderPlacement();
    console.log('[mizu] placement:', { ...placementBase, view });
}

function renderPlacement() {
    const b = placementBase;
    if (!b || !model) return;
    const w = window.innerWidth, h = window.innerHeight;
    const uiScale = h / b.designHeight;
    const effZoom = view.zoom * currentCamera.zoom;
    model.scale.set(b.scale / b.ppu * uiScale * effZoom);
    model.anchor.set(0.5, 0.5);
    const effX = (b.effX + view.dx + currentCamera.x) * uiScale;
    const effY = (view.dy - b.effY - currentCamera.y) * uiScale;
    model.position.set(w / 2 + effX, h / 2 + effY);
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
    engineZones = null;
    engineState = null;
    engineTriggers = null;
    if (engineParams) engineParams.resetParams();
    engineParams = null;
    engineLastAction = null;
    paramDragZone = null;
    // cross-model state: a motion cut by the switch must not trigger a
    // phantom camera restore or leak tick bookkeeping into the next model
    motionWasPlaying = false;
    motionWasPlayingGroup = null;
    motionTouchedCamera.clear();
    cameraRestore = null;
    activeMotionSince = null;
    lastTap = null;
    if (window.__mizu) window.__mizu.engine = null;
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
    const [loaded, skins, bgTexture, words, animatorFades] = await Promise.all([
        PIXI.live2d.Live2DModel.from(`assets/${prefab}/${prefab}.model3.json`, {
            autoInteract: false,
            autoUpdate: false,
        }),
        loadSkins(prefab),
        // scene background; a bg failure must not kill the model render
        bgUrl ? loadTexture(bgUrl).catch(err => {
            console.error('[mizu] bg load failed:', err);
            return null;
        }) : null,
        loadWords(prefab),
        loadAnimatorFades(prefab),
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
    applyMotionLoopPolicy(model, animatorFades);
    currentSkins = skins;
    StateManager.init(skins);
    try {
        setupInteractionEngine(skins);
    } catch (err) {
        console.error('[mizu] interaction engine setup failed:', err);
        engineZones = null; engineState = null; engineTriggers = null; engineParams = null;
        window.__mizu.engine = null;
    }
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

// Single unified ticker loop: drives Cubism update, camera lerp, hotspots, and render
function tick() {
    if (!model) return;
    const t0 = performance.now();
    const mm = model.internalModel.motionManager;

    // 1. Adaptive FPS: Active (60fps) if motion playing, camera moving, or recent interaction
    const isPlayingMotion = mm.state.currentGroup !== undefined && mm.state.currentGroup !== StateManager.currentIdleGroup;
    const isPointerActive = (t0 - lastActiveTime) < 5000;
    const shouldBeActive = isPlayingMotion || isPointerActive || isDynamicCameraLerping;

    const idleFps = Math.min(30, userTargetFps);
    const activeFps = userTargetFps;
    const targetFps = shouldBeActive ? activeFps : idleFps;
    if (app.ticker.maxFPS !== targetFps) {
        app.ticker.maxFPS = targetFps;
        perf.maxFPS = targetFps;
        perf.mode = shouldBeActive ? 'active' : 'idle';
    }

    // 0.4.0 motion-state wedges:
    // (a) a reserved idle motion that never started leaves reservedIdleGroup
    //     set forever, so shouldRequestIdleMotion() never fires again;
    // (b) a one-shot can keep LOOPING despite the loop flag above (observed on
    //     wuqi_3 touch_special: _isLoop=false yet the queue entry never
    //     finishes), which wedges the same machinery AND reads as busy forever.
    //     Enforce the parsed duration: past it, stop the queue and complete the
    //     state — the idle request flow restarts on the next tick.
    if (mm.state.currentGroup === undefined && mm.state.reservedIdleGroup !== undefined) {
        mm.state.setReservedIdle(undefined, undefined);
    }
    const curGroup = mm.state.currentGroup;
    if (curGroup && curGroup !== mm.groups.idle) {
        if (activeMotionSince?.group !== curGroup) {
            activeMotionSince = { group: curGroup, t: t0 };
            cameraRestore = null; // the new motion owns the camera params again
        }
        const durMs = mm.__mizuDurations?.[curGroup];
        if (durMs && t0 - activeMotionSince.t > durMs + 400) {
            if (typeof mm._stopAllMotions === 'function') mm._stopAllMotions();
            mm.state.complete();
            activeMotionSince = null;
        }
    } else {
        activeMotionSince = null;
    }

    // 2. Manual unified Cubism update (pass elapsed ms from app.ticker)
    const tCubismStart = performance.now();
    model.update(app.ticker.deltaMS);
    const tCubism = performance.now() - tCubismStart;

    // Camera-parameter restore (spec BUG-4): motions may pan/zoom the view by
    // writing the fixed Cubism camera vocabulary; when one ends the container
    // would otherwise stay displaced. Skins whose idle motions animate the
    // camera heal themselves — this lerp is the safety net for the rest, and
    // it replaces the old per-skin "safety check" parameter list.
    trackMotionCameraTouch();
    if (motionWasPlaying && !isPlayingMotion) {
        const endedGroup = motionWasPlayingGroup;
        if (motionTouchedCamera.size) {
            const cm = model.internalModel.coreModel;
            const ids = cm._model?.parameters?.ids;
            if (ids) {
                const start = new Map();
                for (const name of motionTouchedCamera) {
                    const i = ids.indexOf(name);
                    if (i >= 0) start.set(i, cm.getParameterValueByIndex(i));
                }
                if (start.size) cameraRestore = { start, t0: t0 };
            }
            motionTouchedCamera.clear();
        }
        // Engine hooks on motion end: revert bookkeeping (pendingRevert) and
        // type-5 removeComList visibility restoration.
        if (engineState) {
            engineState.onMotionEnded(endedGroup);
            const pr = engineState.pendingRevert();
            if (pr && model) model.internalModel.motionManager.groups.idle = pr.group;
        }
        applyRemoveComList(endedGroup, false);
    }
    // type-10 animationPlay feed: normalized progress of the playing motion
    if (isPlayingMotion && engineTriggers && activeMotionSince) {
        const durMs = mm.__mizuDurations?.[activeMotionSince.group];
        if (durMs) {
            engineTriggers.setMotionProgress({
                group: activeMotionSince.group,
                index: mm.state.currentIndex,
                normalized: Math.min(1, (t0 - activeMotionSince.t) / durMs),
            });
        }
    }
    motionWasPlayingGroup = isPlayingMotion ? mm.state.currentGroup : null;
    motionWasPlaying = isPlayingMotion;
    if (cameraRestore) {
        const cm = model.internalModel.coreModel;
        const defs = cm?._model?.parameters?.defaultValues;
        const k = Math.min(1, (t0 - cameraRestore.t0) / CAMERA_RESTORE_MS);
        const e = 1 - Math.pow(1 - k, 3); // ease-out cubic, no snap
        for (const [i, startV] of cameraRestore.start) {
            cm.setParameterValueByIndex(i, startV + (defs[i] - startV) * e);
        }
        if (k >= 1) cameraRestore = null;
    }

    // 3.5. Prop Manager: smooth facial expression overrides
    PropManager.updateTick(app.ticker.deltaMS);

    // 3.6. Interaction engine frame work: pending click fires, long-press
    // stepping, param easing and relations
    engineTriggers?.tick(t0);
    if (engineParams) {
        engineParams.tick(app.ticker.deltaMS);
        engineParams.applyRelations(t0);
    }

    // 3. Dynamic camera tracking with smooth 60fps interpolation
    const tCamStart = performance.now();
    targetCamera = sampleCameraParameters();
    const lerp = 0.18;
    const dx = targetCamera.x - currentCamera.x;
    const dy = targetCamera.y - currentCamera.y;
    const dz = targetCamera.zoom - currentCamera.zoom;
    isDynamicCameraLerping = (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01 || Math.abs(dz) > 0.001);
    if (isDynamicCameraLerping) {
        currentCamera.x += dx * lerp;
        currentCamera.y += dy * lerp;
        currentCamera.zoom += dz * lerp;
        renderPlacement();
    }
    const tCam = performance.now() - tCamStart;

    // 4. Badges track animated vertices (visual layer only — hit-test bounds
    // are computed independently, see computeHotspotBounds/findHotspotAtPoint)
    let tHotspots = 0;
    if (tipsOn && hotspots.length) {
        const tHotspotsStart = performance.now();
        updateHotspots();
        tHotspots = performance.now() - tHotspotsStart;
    }

    // 5. Rolling average telemetry (exponential smoothing)
    const totalTick = performance.now() - t0;
    perf.cubismMs = Math.round((perf.cubismMs * 0.9 + tCubism * 0.1) * 100) / 100;
    perf.cameraMs = Math.round((perf.cameraMs * 0.9 + tCam * 0.1) * 100) / 100;
    perf.hotspotsMs = Math.round((perf.hotspotsMs * 0.9 + tHotspots * 0.1) * 100) / 100;
    perf.totalTickMs = Math.round((perf.totalTickMs * 0.9 + totalTick * 0.1) * 100) / 100;
    perf.fps = Math.round(app.ticker.FPS);
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
            touchActivity();
            if (!model || !motionGroups().includes(group)) return 'false';
            StateManager.playAction(group);
            return 'true';
        },
        perf() {
            return JSON.stringify(perf);
        },
        renderFrame(dtMs = 1000 / 60) {
            app.ticker.update(performance.now());
            app.renderer.render(app.stage);
            return app.view.toDataURL("image/jpeg", 0.95);
        },
        pause() {
            app.ticker.stop();
            perf.mode = 'paused';
            return 'paused';
        },
        resume() {
            app.ticker.start();
            touchActivity();
            return 'resumed';
        },
        tap(x, y) {
            touchActivity();
            const canvas = app?.view || document.querySelector('canvas');
            if (!canvas) return 'false';
            const rect = canvas.getBoundingClientRect();
            const clientX = rect.left + (x !== undefined ? x : rect.width / 2);
            const clientY = rect.top + (y !== undefined ? y : rect.height / 2);
            const opts = { clientX, clientY, bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true };
            canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
            setTimeout(() => {
                window.dispatchEvent(new PointerEvent('pointerup', opts));
            }, 50);
            return 'true';
        },
        fps(target) {
            if (typeof target === 'number' && target > 0) {
                app.ticker.maxFPS = target;
                perf.maxFPS = target;
            }
            return String(app.ticker.maxFPS);
        },
        gaze(on) {
            setGaze(on !== undefined ? Boolean(on) : !gazeFollowEnabled);
            return JSON.stringify(gazeFollowEnabled);
        },
        lang(l) {
            if (l) setLanguage(l);
            return JSON.stringify(currentLang);
        },
        state(cmd) {
            if (!model) return JSON.stringify({ ok: false, error: 'no model' });
            if (cmd === 'next') {
                StateManager.next();
            } else if (cmd === 'reset') {
                StateManager.reset();
            } else if (typeof cmd === 'number' || (cmd && !isNaN(parseInt(cmd, 10)))) {
                StateManager.setState(parseInt(cmd, 10));
            }
            return JSON.stringify({
                ok: true,
                current: StateManager.currentState,
                idleGroup: StateManager.currentIdleGroup,
                sequence: StateManager.activeSequence,
                nextAction: StateManager.activeSequence?.nextAction ?? null,
            });
        },
        model(prefab) {
            switchModel(prefab);
            return 'ok';
        },
        tips(on) {
            setTips(on !== undefined ? Boolean(on) : !tipsOn);
            return JSON.stringify(tipsOn);
        },
        lock(locked) {
            setLock(locked !== undefined ? Boolean(locked) : !placementLocked);
            return JSON.stringify(placementLocked);
        },
        tooltip(on) {
            setTooltip(on !== undefined ? Boolean(on) : !tipsTooltipEnabled);
            return JSON.stringify(tipsTooltipEnabled);
        },
        status() {
            return JSON.stringify({
                prefab: MODEL, view, tips: tipsOn, muted: dialogue?.state.mute ?? null,
                chatter: dialogue?.state.chatter ?? null, groups: motionGroups().length,
                lastTap, hotspots: hotspots.length, placementLocked,
                engineZones: engineZones ? engineZones.zones.length : 0,
                engine: engineState ? engineState.describe() : null,
                gaze: gazeFollowEnabled, lang: currentLang,
                fps: Math.round(app.ticker.FPS), maxFPS: app.ticker.maxFPS, perf,
                state: {
                    current: StateManager.currentState,
                    idleGroup: StateManager.currentIdleGroup,
                    sequence: StateManager.activeSequence,
                    nextAction: StateManager.activeSequence?.nextAction ?? null,
                },
                zones: hotspots.map(h => ({ a: h.action, x: Math.round(h.badge.position.x), y: Math.round(h.badge.position.y) })),
            });
        },
    };
    window.__mizuSyntheticTap = (x, y) => window.mizu.tap(x, y);
    window.__mizuSetPaused = (paused) => paused ? window.mizu.pause() : window.mizu.resume();
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
        app, model: null, bg: null, hotspots, paraRange: null, perf, PropManager,
        engine: null,
        get tipsOn() { return tipsOn; },
        get view() { return { ...view }; },
        toggleTips: () => tipsToggle.click(),
        resetView: () => resetView(),
        get paramSnapshot() { return engineParams ? engineParams.snapshot() : null; },
    };
    [catalog, placementIndex] = await Promise.all([loadCatalog(), loadPlacementIndex()]);
    if (window.MizuDialogue) {
        dialogue = window.MizuDialogue.init({ settings: loadSettings(), onChange: saveSettings });
        window.__mizu.dialogue = dialogue;
        // chatter consults the interaction gate so it never cuts a running line
        window.__mizuBusy = () => interactionBusy();
    }
    setupPointerEvents();
    PropManager.init();
    installControlApi();
    app.ticker.add(tick);
    window.addEventListener('resize', onResize);
    setTooltip(tipsTooltipEnabled);
    setGaze(gazeFollowEnabled, false);
    setLock(placementLocked, false);
    if (window.MizuPicker && Object.keys(catalog).length) {
        picker = window.MizuPicker.init({ catalog, current: MODEL, onSelect: switchModel });
    }
    setLanguage(currentLang, false);
    await loadModel(MODEL);
}

main().catch(err => {
    // probe hook for render checks (handover A4): failures visible without console
    window.__mizu = { ...(window.__mizu || {}), app, error: err && err.message ? err.message : String(err) };
    console.error('[mizu] model load failed:', err);
});
