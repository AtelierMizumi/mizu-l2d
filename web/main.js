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
});
// Start capped at 30 FPS quiet desktop mode (SPEC §155)
app.ticker.maxFPS = 30;
document.body.appendChild(app.view);

// ---------- Performance instrumentation & Adaptive Activity (60fps active / 30fps idle) ----------
let lastActiveTime = performance.now();
let isDynamicCameraLerping = false;

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
    if (app.ticker.maxFPS !== 60) {
        app.ticker.maxFPS = 60;
        perf.maxFPS = 60;
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

const StateManager = {
    currentState: 0,
    currentIdleGroup: 'idle',
    baseIdleGroup: 'idle',
    activeSequence: null, // { prefix, step, action, nextAction, targetIdle }
    transitions: new Map(), // action.toLowerCase() -> { targetIdle, part, action, nextAction, prevAction }
    idleMotions: new Map(), // stateIndex -> motionGroupName
    actionOffsets: new Map(), // action.toLowerCase() -> { x, y }
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
        this.currentState = 0;
        this.activeSequence = null;
        this.currentSequenceOffset = { x: 0, y: 0 };
        this.transitions.clear();
        this.idleMotions.clear();
        this.actionOffsets.clear();
        this.currentState = 0;
        this.activeSequence = null;
        this.transitions.clear();
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
            for (const d of skins.drags) {
                const act = d.trigger?.action || (d.part && motions.includes(d.part.toLowerCase()) ? d.part.toLowerCase() : null);
                if (act && d.idle !== undefined) {
                    this.transitions.set(act.toLowerCase(), {
                        targetIdle: d.idle,
                        part: d.part,
                        action: act,
                        ignore: d.ignore || [],
                        enable: d.enable || []
                    });
                }
                if (act && (d.offsetX !== undefined || d.offsetY !== undefined)) {
                    this.actionOffsets.set(act.toLowerCase(), {
                        x: d.offsetX || 0,
                        y: d.offsetY || 0
                    });
                }
                // Map skin drag offset parameters (e.g. Takao kneading Touch_drag30 -> touch_drag6)
                if (d.param && (d.offsetX !== undefined || d.offsetY !== undefined)) {
                    const pLower = d.param.toLowerCase();
                    if (pLower.includes('30') || pLower.includes('31')) {
                        this.actionOffsets.set('touch_drag6', { x: d.offsetX || 0, y: d.offsetY || 0 });
                        this.actionOffsets.set('touch_drag5', { x: (d.offsetX || 0) * 0.5, y: (d.offsetY || 0) * 0.5 });
                        this.actionOffsets.set('touch_drag7', { x: d.offsetX || 0, y: d.offsetY || 0 });
                    }
                    if (pLower.includes('23') || pLower.includes('24')) {
                        this.actionOffsets.set('touch_drag8', { x: (d.offsetX || 0) * 0.5, y: (d.offsetY || 0) * 0.5 });
                        this.actionOffsets.set('touch_drag9', { x: d.offsetX || 0, y: d.offsetY || 0 });
                    }
                }
            }
        }

        const seqPrefixes = ['touch_drag', 'touch_idle'];
        for (const prefix of seqPrefixes) {
            const list = motions.filter(m => new RegExp(`^${prefix}\\d+$`, 'i').test(m)).sort((a,b) => {
                const na = parseInt(a.replace(/\D/g, ''), 10);
                const nb = parseInt(b.replace(/\D/g, ''), 10);
                return na - nb;
            });
            for (let i = 0; i < list.length; i++) {
                const act = list[i];
                const actLower = act.toLowerCase();
                const nextAct = i < list.length - 1 ? list[i + 1] : null;
                const prevAct = i > 0 ? list[i - 1] : null;
                let trans = this.transitions.get(actLower);
                if (!trans) {
                    const num = parseInt(act.replace(/\D/g, ''), 10);
                    const targetIdle = (i === list.length - 1) ? 0 : (this.idleMotions.has(num) ? num : (this.idleMotions.has(31 + num) ? 31 + num : 0));
                    trans = { targetIdle, action: act, part: act };
                    this.transitions.set(actLower, trans);
                }
                trans.nextAction = nextAct;
                trans.prevAction = prevAct;
            }
        }

        if (model) {
            model.internalModel.motionManager.groups.idle = this.baseIdleGroup;
        }
        this.updateUi();
    },

    playAction(action) {
        touchActivity();
        if (!model) return false;
        const actLower = action.toLowerCase();
        const trans = this.transitions.get(actLower);

        if (trans && trans.targetIdle !== undefined) {
            const targetIdle = trans.targetIdle;
            this.currentState = targetIdle;
            let idleGroup = this.baseIdleGroup;
            if (targetIdle > 0) {
                idleGroup = this.idleMotions.get(targetIdle) || `idle${targetIdle}`;
                const motions = Object.keys(model.internalModel.settings.motions || {});
                if (!motions.includes(idleGroup)) {
                    if (motions.includes(`touch_idle${targetIdle}`)) {
                        idleGroup = `touch_idle${targetIdle}`;
                    } else if (motions.includes(action)) {
                        idleGroup = action;
                    } else {
                        idleGroup = this.baseIdleGroup;
                    }
                }
            }
            this.currentIdleGroup = idleGroup;
            model.internalModel.motionManager.groups.idle = idleGroup;

            const match = actLower.match(/^([a-z_]+?)(\d+)$/);
            this.activeSequence = {
                prefix: match ? match[1] : 'custom',
                step: match ? parseInt(match[2], 10) : 1,
                action: action,
                nextAction: trans.nextAction,
                targetIdle: targetIdle
            };

            if (targetIdle === 0) {
                this.currentSequenceOffset = { x: 0, y: 0 };
                setTimeout(() => {
                    if (this.currentState === 0) {
                        this.restoreDefaults();
                        if (model) {
                            model.motion(this.baseIdleGroup, 0, 3);
                        }
                    }
                }, 750);
            } else {
                this.currentSequenceOffset = this.actionOffsets.get(actLower) || { x: 0, y: 0 };
            }

            console.log('[mizu-state] Transitioned via', action, '-> state:', targetIdle, 'idleGroup:', idleGroup, 'offset:', this.currentSequenceOffset, 'next:', trans.nextAction);
        } else {
            // Keep current resting idle pose so transient reactions do not kill the state
            model.internalModel.motionManager.groups.idle = this.currentIdleGroup;
        }

        const started = model.motion(action, undefined, 3);
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
        this.currentState = 0;
        this.activeSequence = null;
        this.currentIdleGroup = this.baseIdleGroup;
        this.currentSequenceOffset = { x: 0, y: 0 };
        this.restoreDefaults();
        if (model) {
            model.internalModel.motionManager.groups.idle = this.baseIdleGroup;
            const motions = Object.keys(model.internalModel.settings.motions || {});
            const resetMotion = motions.find(m => m.toLowerCase() === 'touch_drag10') ||
                                motions.find(m => m.toLowerCase() === 'touch_idle4') ||
                                this.baseIdleGroup;
            model.motion(resetMotion, undefined, 3);
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

        this.currentState = target;
        this.currentIdleGroup = idleGroup;
        model.internalModel.motionManager.groups.idle = idleGroup;

        for (const [act, trans] of this.transitions.entries()) {
            if (trans.targetIdle === target) {
                const match = act.match(/^([a-z_]+?)(\d+)$/);
                this.activeSequence = {
                    prefix: match ? match[1] : 'custom',
                    step: match ? parseInt(match[2], 10) : 1,
                    action: trans.action,
                    nextAction: trans.nextAction,
                    targetIdle: target
                };
                break;
            }
        }
        model.motion(idleGroup, undefined, 3);
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
        const isTakao = (MODEL === 'gaoxiong_7');
        setElem('pm-title', isTakao ? t('propTitle') : t('propHoverGeneric'));
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
        
        const isTakao = (MODEL === 'gaoxiong_7');
        const cm = model.internalModel?.coreModel;
        const motions = model.internalModel?.settings?.motions || {};
        const motionKeys = Object.keys(motions);

        // 1. Poses / Motions
        let poses = [];
        if (isTakao) {
            poses = [
                { act: 'touch_idle1', icon: '📸', vi: 'Ảnh casting 1 (Tạo dáng)', en: 'Casting Photo 1 (Posing)', tag: 'Photo Card' },
                { act: 'touch_idle19', icon: '📷', vi: 'Ảnh casting 2 (Ngồi nhìn)', en: 'Casting Photo 2 (Sitting)', tag: 'Photo Card' },
                { act: 'touch_idle17', icon: '👗', vi: 'Buổi chụp ảnh Studio', en: 'Studio Photoshoot Pose', tag: 'Session' },
                { act: 'touch_idle34', icon: '🎬', vi: 'Diễn xuất trước gương', en: 'Studio Mirror Acting', tag: 'Acting' },
                { act: 'idle', icon: '🔄', vi: 'Tư thế nghỉ cơ bản', en: 'Reset to Base Idle', tag: 'Base' }
            ];
        } else {
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
                    { rx: /manjuu|pet|cat|bird/i, icon: '🐥', vi: 'Thú cưng / Manjuu', en: 'Pet / Manjuu' },
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

function buildHotspots(skins) {
    if (skins !== undefined) currentSkins = skins;
    if (!model) return;
    badgeLayer.removeChildren();
    hotspots = [];

    const drawableIds = model.internalModel.getDrawableIDs();
    const groups = Object.keys(model.internalModel.settings.motions || {});
    const groupByName = new Map(groups.map(g => [g.toLowerCase(), g]));

    // 1. Primary character touch zones (TouchHead, TouchBody, TouchSpecial)
    const primaryZones = [
        { part: 'TouchHead', action: 'touch_head', labelKey: 'zoneHead' },
        { part: 'TouchBody', action: 'touch_body', labelKey: 'zoneBody' },
        { part: 'TouchSpecial', action: 'touch_special', labelKey: 'zoneSpecial' },
    ];
    for (const z of primaryZones) {
        const act = groupByName.get(z.action.toLowerCase());
        const idx = drawableIds.indexOf(z.part);
        if (act && idx !== -1) {
            hotspots.push({
                action: act,
                index: idx,
                part: z.part,
                label: t(z.labelKey),
                cooldown: 1000,
                lastFired: -Infinity,
                badge: makeBadge(hotspots.length + 1, String(hotspots.length + 1), 'normal'),
            });
        }
    }

    // 2. Sequence Next & Reset Hotspots
    if (StateManager.currentState === 0) {
        const drag1 = groupByName.get('touch_drag1');
        if (drag1) {
            hotspots.push({
                action: drag1,
                index: -1,
                part: 'TouchDrag1',
                label: t('zoneDragStart'),
                isSequence: true,
                badgeOffset: { x: 85, y: -10 },
                cooldown: 1000,
                lastFired: -Infinity,
                badge: makeBadge(hotspots.length + 1, '▶', 'next'),
            });
        }
        const idle1 = groupByName.get('touch_idle1');
        if (idle1 && !drag1) {
            hotspots.push({
                action: idle1,
                index: -1,
                part: 'TouchIdle1',
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

        const resetAction = groups.find(m => m.toLowerCase() === 'touch_drag10') ||
                            groups.find(m => m.toLowerCase() === 'touch_idle4') ||
                            StateManager.baseIdleGroup;
        hotspots.push({
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


    // 3. Environment & Interactive Props Hotspots
    const isTakao = (MODEL === 'gaoxiong_7');
    if (isTakao) {
        // ArtMesh301..305 belong to Part114/115 (Manjuu Casting Acrylic Board)
        const indices = [179, 180, 181, 182, 183];
        hotspots.push({
            action: 'open_prop_menu',
            index: 179,
            meshIndices: indices,
            part: 'ManjuuCastingBoard',
            label: t('propHover'),
            isProp: true,
            cooldown: 400,
            lastFired: -Infinity,
            badge: makeBadge(hotspots.length + 1, '📋', 'prop'),
        });
    } else {
        const cm = model.internalModel.coreModel;
        if (cm?._model?.parts) {
            const parts = cm._model.parts;
            for (let p = 0; p < parts.ids.length; p++) {
                const pid = parts.ids[p].toLowerCase();
                if (pid.includes('prop') || pid.includes('board') || pid.includes('item') || pid.includes('table') || pid.includes('desk') || pid.includes('phone')) {
                    const drawables = cm._model.drawables;
                    const dIndices = [];
                    for (let d = 0; d < drawables.ids.length; d++) {
                        if (drawables.parentPartIndices[d] === p) dIndices.push(d);
                    }
                    if (dIndices.length > 0) {
                        hotspots.push({
                            action: 'open_prop_menu',
                            index: dIndices[0],
                            meshIndices: dIndices,
                            part: parts.ids[p],
                            label: t('propHoverGeneric'),
                            isProp: true,
                            cooldown: 400,
                            lastFired: -Infinity,
                            badge: makeBadge(hotspots.length + 1, '⚙️', 'prop'),
                        });
                        break;
                    }
                }
            }
        }
    }

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
    const blacklisted = new Set();
    if (currentSkins?.tips?.idleBlackList) {
        for (const rule of currentSkins.tips.idleBlackList) {
            if (rule.idle && rule.idle.includes(StateManager.currentState)) {
                for (const p of (rule.parts || [])) blacklisted.add(p);
            }
        }
    }

    for (const h of hotspots) {
        h.isOffscreen = false;
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
        h.badge.alpha = (active ? 1 : 0.88) * Math.min(pop, 1);
    }

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
            const now = performance.now();
            if (now - h.lastFired < h.cooldown) return;
            h.lastFired = now;
            if (h.isProp) {
                PropManager.toggle();
                return;
            }
            lastTap = h.action;
            StateManager.playAction(h.action);
            const lineKey = window.MizuDialogue?.keyForAction(h.action);
            if (lineKey) dialogue?.say(lineKey);
            return;
        }
        if (placementLocked) {
            // In locked mode: tapping on model advances sequence if in resting sequence
            if (StateManager.currentState > 0 && StateManager.activeSequence?.nextAction) {
                StateManager.next();
                return;
            }
            model.tap(e.clientX, e.clientY);
            dialogue?.say('touch');
            return;
        }
        press = { start: p, last: p, dragging: false };
    });

    window.addEventListener('pointerup', () => {
        touchActivity();
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
    const [loaded, skins, bgTexture, words] = await Promise.all([
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
    currentSkins = skins;
    StateManager.init(skins);
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

    const targetFps = shouldBeActive ? 60 : 30;
    if (app.ticker.maxFPS !== targetFps) {
        app.ticker.maxFPS = targetFps;
        perf.maxFPS = targetFps;
        perf.mode = shouldBeActive ? 'active' : 'idle';
    }

    // 0.4.0 leaves a stale idle reservation behind when an idle motion is
    // requested but never started (state.complete() clears currentGroup but
    // nothing clears reservedIdleGroup), so shouldRequestIdleMotion() never
    // fires again and auto-idle silently stops. Drop the stale reservation
    // whenever no motion is current; state.start() re-sets it legitimately.
    if (mm.state.currentGroup === undefined && mm.state.reservedIdleGroup !== undefined) {
        mm.state.setReservedIdle(undefined, undefined);
    }

    // 2. Manual unified Cubism update (pass elapsed ms from app.ticker)
    const tCubismStart = performance.now();
    model.update(app.ticker.deltaMS);
    const tCubism = performance.now() - tCubismStart;

    // Safety check: when at base idle (state 0) and not playing an active motion, prevent any interaction parameters from remaining stuck
    if (StateManager.currentState === 0 && !isPlayingMotion) {
        const cm = model.internalModel.coreModel;
        if (cm?._model?.parameters) {
            const ids = cm._model.parameters.ids;
            const defs = cm._model.parameters.defaultValues;
            const checkParams = ['Param60', 'Param52', 'Param53', 'Param74', 'Param50', 'Touch_drag21', 'Touch_drag19', 'Touch_drag20', 'Touch_drag17', 'Touch_drag14'];
            for (const pid of checkParams) {
                const idx = ids.indexOf(pid);
                if (idx >= 0 && Math.abs(cm.getParameterValueByIndex(idx) - defs[idx]) > 0.01) {
                    cm.setParameterValueByIndex(idx, defs[idx]);
                }
            }
        }
    }

    // 3.5. Prop Manager: smooth facial expression overrides
    PropManager.updateTick(app.ticker.deltaMS);

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
        get tipsOn() { return tipsOn; },
        get view() { return { ...view }; },
        toggleTips: () => tipsToggle.click(),
        resetView: () => resetView(),
    };
    [catalog, placementIndex] = await Promise.all([loadCatalog(), loadPlacementIndex()]);
    if (window.MizuDialogue) {
        dialogue = window.MizuDialogue.init({ settings: loadSettings(), onChange: saveSettings });
        window.__mizu.dialogue = dialogue;
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
