// R1d dialogue: a game-style bubble at the bottom centre, the skin's voice clip
// (EN) and a periodic chatter line. Lines come from data/words/<prefab>.json
// (scripts/build-words.py). Exposed as window.MizuDialogue.init({ settings,
// onChange }).
(function () {
    const BUBBLE_MS = 3500;        // how long a line stays on screen
    const COOLDOWN_MS = 2000;      // minimum gap between lines (not for login)
    const CHATTER_MIN_MS = 3 * 60000;
    const CHATTER_MAX_MS = 8 * 60000;
    const CHATTER_KEYS = ['main1', 'main2', 'main3', 'main4'];

    let words = null;              // { key: { line, audio } } for the current model
    let lastKey = null;            // avoids repeating the previous chatter line
    let lastSayAt = -Infinity;
    let audio = null;
    let hideTimer = null;
    let chatterTimer = null;
    let chatterMin = CHATTER_MIN_MS;
    let chatterMax = CHATTER_MAX_MS;
    let state = { mute: false, chatter: true };
    let onChange = () => {};
    let els = null;

    // game event -> voice key (PLAN R1d): head/body/special taps and main poses
    function keyForAction(action) {
        if (action === 'touch_head') return 'headtouch';
        if (action === 'touch_body') return 'touch';
        if (action === 'touch_special') return 'touch2';
        const m = /^main_(\d)$/.exec(action || '');
        return m ? `main${m[1]}` : null;
    }

    function buildDom() {
        const bubble = document.createElement('div');
        bubble.id = 'dialogue-bubble';
        bubble.setAttribute('role', 'status');
        bubble.setAttribute('aria-live', 'polite');
        const text = document.createElement('div');
        text.className = 'dialogue-text';
        bubble.append(text);

        const svgNS = 'http://www.w3.org/2000/svg';
        const shape = (name, attrs) => {
            const node = document.createElementNS(svgNS, name);
            for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
            return node;
        };
        // glyph: list of [tag, attrs]; every button carries the same lens and slash
        const button = (id, title, glyph) => {
            const btn = document.createElement('button');
            btn.id = id;
            btn.type = 'button';
            btn.title = title;
            const svg = document.createElementNS(svgNS, 'svg');
            svg.setAttribute('viewBox', '0 0 40 40');
            svg.setAttribute('width', '40');
            svg.setAttribute('height', '40');
            svg.setAttribute('aria-hidden', 'true');
            svg.append(shape('circle', { class: 'lens', cx: 20, cy: 20, r: 12.5 }));
            for (const [tag, attrs] of glyph) svg.append(shape(tag, attrs));
            svg.append(shape('line', { class: 'slash', x1: 12, y1: 28, x2: 28, y2: 12 }));
            btn.append(svg);
            return btn;
        };
        const muteBtn = button('voice-mute', 'Tắt/bật tiếng', [
            ['path', { class: 'glyph', d: 'M14 17.5h3l4-3.5v12l-4-3.5h-3z' }],
            ['path', { class: 'glyph', d: 'M25 16.5a4.5 4.5 0 0 1 0 7' }],
        ]);
        const chatterBtn = button('voice-chatter', 'Lời thoại định kỳ', [
            ['path', { class: 'glyph', d: 'M13 16.5a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v3.5a4 4 0 0 1-4 4h-4l-3 2.5v-2.5a4 4 0 0 1-3-4z' }],
        ]);
        muteBtn.addEventListener('click', () => setMuted(!state.mute));
        chatterBtn.addEventListener('click', () => setChatter(!state.chatter));

        document.body.append(bubble, muteBtn, chatterBtn);
        return { bubble, text, muteBtn, chatterBtn };
    }

    function refreshButtons() {
        els.muteBtn.classList.toggle('off', state.mute);
        els.muteBtn.setAttribute('aria-pressed', String(state.mute));
        els.chatterBtn.classList.toggle('off', !state.chatter);
        els.chatterBtn.setAttribute('aria-pressed', String(state.chatter));
    }

    function setMuted(on) {
        state.mute = on;
        if (on) stopAudio();
        refreshButtons();
        onChange({ mute: on });
    }

    function setChatter(on) {
        state.chatter = on;
        refreshButtons();
        onChange({ chatter: on });
        if (on) scheduleChatter(); else clearTimeout(chatterTimer);
    }

    function stopAudio() {
        if (audio) {
            audio.pause();
            audio.removeAttribute('src');
            audio = null;
        }
    }

    function playAudio(url) {
        stopAudio();
        if (!url || state.mute) return;
        audio = new Audio(url);
        // a 404 or an autoplay refusal leaves the bubble text on its own
        audio.play().catch(() => {});
    }

    function show(line) {
        els.text.textContent = line;
        els.bubble.classList.add('show');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => els.bubble.classList.remove('show'), BUBBLE_MS);
    }

    // says the line for `key`; returns false when the model has no such line
    function say(key, { force = false } = {}) {
        const entry = words && key ? words[key] : null;
        if (!entry || !entry.line) return false;
        const now = performance.now();
        if (!force && now - lastSayAt < COOLDOWN_MS) return false;
        lastSayAt = now;
        show(entry.line);
        playAudio(entry.audio);
        return true;
    }

    function chatterKeys() {
        return CHATTER_KEYS.filter(k => words && words[k] && words[k].line);
    }

    // random pick that never repeats the previous chatter key
    function chatterNow() {
        const keys = chatterKeys().filter(k => k !== lastKey);
        const pool = keys.length ? keys : chatterKeys();
        if (!pool.length) return false;
        lastKey = pool[Math.floor(Math.random() * pool.length)];
        return say(lastKey, { force: true });
    }

    function scheduleChatter() {
        clearTimeout(chatterTimer);
        if (!state.chatter) return;
        const delay = chatterMin + Math.random() * (chatterMax - chatterMin);
        chatterTimer = setTimeout(() => {
            // only while the tab is visible: a hidden wallpaper or tab stays quiet
            if (document.visibilityState === 'visible') chatterNow();
            scheduleChatter();
        }, delay);
    }

    function load(next) {
        words = next || null;
        lastKey = null;
        stopAudio();
        clearTimeout(hideTimer);
        els.bubble.classList.remove('show');
        scheduleChatter();
    }

    function init(options) {
        const s = options.settings || {};
        state = { mute: !!s.mute, chatter: s.chatter !== false };
        onChange = options.onChange || onChange;
        els = buildDom();
        refreshButtons();
        return {
            load,
            say,
            keyForAction,
            setMuted,
            setChatter,
            chatterNow,
            // test hook: short intervals for the chatter check
            setChatterInterval(minMs, maxMs) {
                chatterMin = minMs;
                chatterMax = maxMs;
                scheduleChatter();
            },
            get state() { return { ...state }; },
            get text() { return els.text.textContent; },
            get visible() { return els.bubble.classList.contains('show'); },
            get playing() { return !!audio; },
        };
    }

    window.MizuDialogue = { init, keyForAction };
})();
