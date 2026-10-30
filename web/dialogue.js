// R1d dialogue: a game-style bubble at the bottom centre, the skin's voice clip
// and a periodic chatter line. Lines come from data/words/<prefab>.json
// (scripts/build-words.py). Exposed as window.MizuDialogue.init({ settings,
// onChange }).
(function () {
    const MIN_READING_MS = 4800;   // minimum time a line stays on screen (ms)
    const MS_PER_CHAR = 85;        // reading pacing per character
    const AUDIO_POST_PAD_MS = 1200; // reading grace period after audio completes
    const COOLDOWN_MS = 1500;      // minimum gap between lines (not for login)
    const CHATTER_MIN_MS = 3 * 60000;
    const CHATTER_MAX_MS = 8 * 60000;
    const CHATTER_KEYS = ['main1', 'main2', 'main3', 'main4'];

    const INSTANCE_ID = 'view_' + Math.random().toString(36).slice(2, 9);
    let lastActiveAt = Date.now();
    let audioChannel = null;
    let currentAudioToken = null;

    try {
        if (typeof BroadcastChannel !== 'undefined') {
            audioChannel = new BroadcastChannel('mizu_audio_channel');
        }
    } catch (_) {}

    function updateActiveTimestamp() {
        lastActiveAt = Date.now();
    }
    window.addEventListener('pointerdown', updateActiveTimestamp, { passive: true });
    window.addEventListener('pointermove', updateActiveTimestamp, { passive: true });

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
    let currentLineText = '';

    // Listen to shared audio channel to prevent duplicates across multiple monitors
    if (audioChannel) {
        audioChannel.onmessage = (e) => {
            const msg = e.data;
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'AUDIO_CLAIM') {
                // Another monitor instance is playing this audio stream
                if (msg.owner !== INSTANCE_ID) {
                    if (audio && currentAudioToken === msg.token) {
                        stopAudio();
                    }
                }
            } else if (msg.type === 'AUDIO_METADATA') {
                // Synchronize reading bubble duration across both monitors
                if (msg.token === currentAudioToken) {
                    clearTimeout(hideTimer);
                    hideTimer = setTimeout(() => hideBubble(), msg.duration);
                }
            } else if (msg.type === 'CHATTER_SYNC') {
                // If another monitor triggered idle chatter, show speech bubble in sync
                if (msg.owner !== INSTANCE_ID) {
                    show(msg.line);
                }
            }
        };
    }

    function shouldPlayAudioLocally(token) {
        if (state.mute) return false;
        const now = Date.now();
        try {
            const raw = localStorage.getItem('mizu_audio_lease');
            if (raw) {
                const lease = JSON.parse(raw);
                // If the same audio token was claimed by another window within 600ms
                if (lease.token === token && lease.owner !== INSTANCE_ID && (now - lease.time < 600)) {
                    // Tie-breaker: if this window was interacted with much more recently, take over
                    if (lastActiveAt > lease.activeAt + 300) {
                        // Allow takeover
                    } else {
                        return false;
                    }
                }
            }
            localStorage.setItem('mizu_audio_lease', JSON.stringify({
                token,
                time: now,
                owner: INSTANCE_ID,
                activeAt: lastActiveAt
            }));
            return true;
        } catch (_) {
            return true;
        }
    }

    // game event -> voice key: head/body/special taps, drag/touch states and main poses
    function keyForAction(action) {
        if (!action) return 'touch';
        const a = String(action).toLowerCase();
        if (a === 'touch_head' || a === 'headtouch') return 'headtouch';
        if (a === 'touch_body' || a === 'touch') return 'touch';
        if (a === 'touch_special' || a === 'touch2') return 'touch2';
        if (a.startsWith('touch_drag') || a.startsWith('touch_idle')) {
            return (words && words['touch2']) ? 'touch2' : 'touch';
        }
        const m = /^main_?(\\d)$/.exec(a);
        if (m) return `main${m[1]}`;
        return 'touch';
    }

    function buildDom() {
        let bubble = document.getElementById('dialogue-bubble');
        let text = bubble ? bubble.querySelector('.dialogue-text') : null;
        if (!bubble) {
            bubble = document.createElement('div');
            bubble.id = 'dialogue-bubble';
            bubble.setAttribute('role', 'status');
            bubble.setAttribute('aria-live', 'polite');
            text = document.createElement('div');
            text.className = 'dialogue-text';
            bubble.append(text);
            document.body.append(bubble);
        }

        const muteBtn = document.getElementById('voice-mute');
        const chatterBtn = document.getElementById('voice-chatter');

        if (muteBtn) {
            muteBtn.addEventListener('click', () => setMuted(!state.mute));
        }
        if (chatterBtn) {
            chatterBtn.addEventListener('click', () => setChatter(!state.chatter));
        }

        return { bubble, text, muteBtn, chatterBtn };
    }

    function refreshButtons() {
        if (els.muteBtn) {
            els.muteBtn.classList.toggle('off', state.mute);
            els.muteBtn.setAttribute('aria-pressed', String(state.mute));
        }
        if (els.chatterBtn) {
            els.chatterBtn.classList.toggle('off', !state.chatter);
            els.chatterBtn.setAttribute('aria-pressed', String(state.chatter));
        }
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
            try {
                audio.pause();
                audio.currentTime = 0;
                audio.onloadedmetadata = null;
                audio.onended = null;
                audio.onerror = null;
                audio.removeAttribute('src');
            } catch (_) {}
            audio = null;
        }
    }

    function hideBubble() {
        if (!els?.bubble) return;
        els.bubble.classList.remove('show');
    }

    function computeReadingDuration(line) {
        if (!line) return MIN_READING_MS;
        return Math.max(MIN_READING_MS, Math.min(12000, line.length * MS_PER_CHAR));
    }

    function show(line, customDurationMs) {
        if (!els?.text || !els?.bubble) return;
        currentLineText = line || '';
        els.text.textContent = currentLineText;

        // If not already shown, add show class; if already shown, keep it without flickering
        els.bubble.classList.add('show');
        clearTimeout(hideTimer);

        const duration = customDurationMs || computeReadingDuration(line);
        hideTimer = setTimeout(() => hideBubble(), duration);
    }

    function playAudio(url, line, token) {
        stopAudio();
        if (!url || state.mute) return;

        currentAudioToken = token || (url + '_' + Math.floor(Date.now() / 250));

        // Coordinate across multi-monitor setup: only ONE instance plays audio stream
        if (!shouldPlayAudioLocally(currentAudioToken)) {
            return;
        }

        if (audioChannel) {
            audioChannel.postMessage({
                type: 'AUDIO_CLAIM',
                token: currentAudioToken,
                owner: INSTANCE_ID,
                url
            });
        }

        const baseReadingMs = computeReadingDuration(line);

        try {
            audio = new Audio();
            audio.preload = 'auto';
            audio.src = url;
            audio.volume = 1.0;

            audio.onloadedmetadata = () => {
                if (!audio || state.mute) return;
                const audioDurationMs = Math.ceil(audio.duration * 1000) + AUDIO_POST_PAD_MS;
                const dynamicDuration = Math.max(baseReadingMs, audioDurationMs);
                clearTimeout(hideTimer);
                hideTimer = setTimeout(() => hideBubble(), dynamicDuration);

                // Broadcast synchronized duration so all monitor bubbles dismiss at the same time
                if (audioChannel) {
                    audioChannel.postMessage({
                        type: 'AUDIO_METADATA',
                        token: currentAudioToken,
                        duration: dynamicDuration
                    });
                }
            };

            audio.onended = () => {
                // When audio playback ends, wait a brief reading buffer before dismissal
                clearTimeout(hideTimer);
                hideTimer = setTimeout(() => hideBubble(), AUDIO_POST_PAD_MS);
            };

            audio.onerror = (err) => {
                console.warn('[dialogue] audio resource load error:', err);
            };

            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch((err) => {
                    console.warn('[dialogue] audio playback error/policy:', err);
                });
            }
        } catch (err) {
            console.warn('[dialogue] audio initialization error:', err);
        }
    }

    // says the line for `key`; returns false when the model has no such line
    function say(key, { force = false } = {}) {
        if (!key) key = 'touch';
        if (key === 'touch_body') key = 'touch';
        if (key === 'touch_head') key = 'headtouch';
        if (key === 'touch_special') key = 'touch2';

        let entry = words && words[key] ? words[key] : null;
        if ((!entry || !entry.line) && words) {
            // Intelligent fallback: touch -> main1 -> first entry
            entry = words['touch'] || words['main1'] || Object.values(words)[0];
        }
        if (!entry || !entry.line) return false;
        const now = performance.now();
        if (!force && now - lastSayAt < COOLDOWN_MS) return false;
        lastSayAt = now;

        const token = `${entry.audio || key}_${Math.floor(Date.now() / 300)}`;
        show(entry.line);
        playAudio(entry.audio, entry.line, token);
        return true;
    }

    function chatterKeys() {
        return CHATTER_KEYS.filter(k => words && words[k] && words[k].line);
    }

    // random pick that never repeats the previous chatter line
    function chatterNow() {
        const now = Date.now();
        // Prevent multi-screen collision: ensure at least 30s between idle chatter across all screens
        try {
            const lastSharedChatter = parseInt(localStorage.getItem('mizu_shared_chatter_ts') || '0', 10);
            if (now - lastSharedChatter < 30000) {
                return false;
            }
            localStorage.setItem('mizu_shared_chatter_ts', String(now));
        } catch (_) {}

        const keys = chatterKeys().filter(k => k !== lastKey);
        const pool = keys.length ? keys : chatterKeys();
        if (!pool.length) return false;
        lastKey = pool[Math.floor(Math.random() * pool.length)];
        const entry = words && words[lastKey];
        if (entry && audioChannel) {
            audioChannel.postMessage({
                type: 'CHATTER_SYNC',
                owner: INSTANCE_ID,
                key: lastKey,
                line: entry.line
            });
        }
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
        if (els?.bubble) els.bubble.classList.remove('show');
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
            setChatterInterval(minMs, maxMs) {
                chatterMin = minMs;
                chatterMax = maxMs;
                scheduleChatter();
            },
            get state() { return { ...state }; },
            get text() { return els?.text ? els.text.textContent : ''; },
            get visible() { return els?.bubble ? els.bubble.classList.contains('show') : false; },
            get playing() { return !!audio; },
        };
    }

    window.MizuDialogue = { init, keyForAction };
})();
