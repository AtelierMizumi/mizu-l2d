// Mizu-L2D Interactive Showcase Simulator (showcase/app.js)

(function () {
    const canvas = document.getElementById('sim-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const dialogueElem = document.getElementById('sim-dialogue');
    const dialogueText = document.getElementById('dialogue-text');
    const hudState = document.getElementById('hud-pose');
    const hudFps = document.getElementById('hud-fps');
    const simLog = document.getElementById('sim-log');

    const btnHead = document.getElementById('btn-tap-head');
    const btnBody = document.getElementById('btn-tap-body');
    const btnElevator = document.getElementById('btn-tap-elevator');
    const btnReset = document.getElementById('btn-reset-pose');
    const btnClearLog = document.getElementById('btn-clear-log');

    const chkCover = document.getElementById('chk-cover');
    const chkHints = document.getElementById('chk-hints');
    const chkMirror = document.getElementById('chk-mirror');

    let state = 0; // 0 = idle base, 1 = elevator button hold
    let isCovered = false;
    let showHints = true;
    let dialogueTimer = null;
    let animFrameId = null;
    let lastTime = performance.now();
    let frameCount = 0;
    let fps = 60.0;
    let ripples = [];

    // Interaction hotzones (proportional to canvas size)
    const zones = [
        { id: 'touch_head', label: 'touch_head', x: 300, y: 140, r: 50 },
        { id: 'touch_body', label: 'touch_body', x: 300, y: 280, r: 65 },
        { id: 'touch_idle1', label: 'elevator_ctrl', x: 440, y: 290, r: 35 },
    ];

    const lines = {
        touch_head: [
            "Commander, patting my head won't make the elevator arrive faster!",
            "Ehehe... That tickles a bit, Commander.",
        ],
        touch_body: [
            "Need something? I'm currently monitoring building logistics.",
            "All sensors nominal. The wallpaper layer is drawing smoothly.",
        ],
        touch_idle1: [
            "Switching floor selection... Holding pose for sequence chain.",
            "Elevator going up! Chaining to pose state 1.",
        ],
        reset: [
            "Restoring baseline idle pose. Mesh coordinates settled.",
        ],
    };

    function appendLog(category, text) {
        if (!simLog) return;
        const entry = document.createElement('div');
        entry.className = `log-entry ${category}`;
        entry.textContent = text;
        simLog.appendChild(entry);
        simLog.scrollTop = simLog.scrollHeight;
    }

    function triggerSpeech(zoneId, customLine) {
        let text = customLine;
        if (!text && lines[zoneId]) {
            const arr = lines[zoneId];
            text = arr[Math.floor(Math.random() * arr.length)];
        }
        if (!text) return;

        if (dialogueTimer) clearTimeout(dialogueTimer);
        dialogueText.textContent = text;
        dialogueElem.style.display = 'block';
        dialogueElem.style.opacity = '1';

        dialogueTimer = setTimeout(() => {
            dialogueElem.style.opacity = '0';
            setTimeout(() => {
                if (dialogueElem.style.opacity === '0') dialogueElem.style.display = 'none';
            }, 300);
        }, 3600);
    }

    function fireInteraction(zoneId) {
        if (isCovered) {
            appendLog('warn', `[busy-gate] tap on ${zoneId} ignored: render loop is paused by niri cover`);
            return;
        }

        ripples.push({
            x: zoneId === 'touch_head' ? 300 : (zoneId === 'touch_idle1' ? 440 : 300),
            y: zoneId === 'touch_head' ? 140 : (zoneId === 'touch_idle1' ? 290 : 280),
            r: 5,
            alpha: 1.0,
        });

        if (zoneId === 'touch_idle1') {
            state = 1;
            hudState.textContent = 'State: Idle 1 (Pose Switch)';
            appendLog('action', `[engine] zone touch_idle1 fired -> StateManager.setState(1)`);
            triggerSpeech(zoneId);
        } else if (zoneId === 'reset') {
            state = 0;
            hudState.textContent = 'State: Idle 0 (Base)';
            appendLog('ok', `[engine] StateManager.reset() -> restored baseIdleGroup`);
            triggerSpeech(zoneId);
        } else {
            appendLog('action', `[engine] zone ${zoneId} fired -> playing motion & voice`);
            triggerSpeech(zoneId);
        }
    }

    // Canvas drawing loop
    function render(now) {
        if (isCovered) {
            hudFps.textContent = 'FPS: 0.0 (PAUSED)';
            return;
        }

        frameCount++;
        if (now - lastTime >= 1000) {
            fps = Math.round((frameCount * 1000) / (now - lastTime));
            hudFps.textContent = `FPS: ${fps}.0`;
            frameCount = 0;
            lastTime = now;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const t = now * 0.002;
        const breathY = Math.sin(t) * 4;
        const breathScale = 1 + Math.sin(t * 0.8) * 0.01;

        // Background subtle grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 1;
        for (let x = 0; x < canvas.width; x += 40) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += 40) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }

        // Draw model avatar silhouette
        ctx.save();
        ctx.translate(300, 310 + breathY);
        ctx.scale(breathScale, breathScale);

        // Body outline
        ctx.fillStyle = 'rgba(78, 242, 210, 0.08)';
        ctx.strokeStyle = state === 1 ? 'rgba(255, 107, 157, 0.7)' : 'rgba(78, 242, 210, 0.5)';
        ctx.lineWidth = 2;

        // Torso & dress
        ctx.beginPath();
        ctx.moveTo(-50, -50);
        ctx.bezierCurveTo(-70, 80, -90, 160, -110, 200);
        ctx.lineTo(110, 200);
        ctx.bezierCurveTo(90, 160, 70, 80, 50, -50);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Head
        ctx.beginPath();
        ctx.arc(0, -160, 48, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Hair / Antenna ribbons
        ctx.beginPath();
        ctx.moveTo(-35, -190);
        ctx.quadraticCurveTo(-70, -220, -90, -170);
        ctx.moveTo(35, -190);
        ctx.quadraticCurveTo(70, -220, 90, -170);
        ctx.stroke();

        // Elevator panel (state indicator)
        if (state === 1) {
            ctx.fillStyle = 'rgba(255, 107, 157, 0.2)';
            ctx.strokeStyle = 'var(--accent-sakura)';
            ctx.strokeRect(120, -50, 40, 70);
            ctx.fillRect(120, -50, 40, 70);
            ctx.fillStyle = '#ff6b9d';
            ctx.font = '10px monospace';
            ctx.fillText('ACTIVE', 123, -15);
        }

        ctx.restore();

        // Draw Hitzone overlays if enabled
        if (showHints) {
            for (const z of zones) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(z.x, z.y + (z.id !== 'touch_idle1' ? breathY : 0), z.r, 0, Math.PI * 2);
                ctx.fillStyle = z.id === 'touch_idle1' && state === 1 ? 'rgba(255, 107, 157, 0.15)' : 'rgba(78, 242, 210, 0.08)';
                ctx.strokeStyle = z.id === 'touch_idle1' && state === 1 ? 'rgba(255, 107, 157, 0.5)' : 'rgba(78, 242, 210, 0.4)';
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.fill();

                // Zone badge label
                ctx.font = '10px sans-serif';
                ctx.fillStyle = z.id === 'touch_idle1' && state === 1 ? '#ff6b9d' : '#4ef2d2';
                ctx.textAlign = 'center';
                ctx.fillText(`▶ ${z.label}`, z.x, z.y + (z.id !== 'touch_idle1' ? breathY : 0) - z.r - 6);
                ctx.restore();
            }
        }

        // Draw Click Ripples
        for (let i = ripples.length - 1; i >= 0; i--) {
            const r = ripples[i];
            r.r += 2.5;
            r.alpha -= 0.03;
            if (r.alpha <= 0) {
                ripples.splice(i, 1);
                continue;
            }
            ctx.save();
            ctx.beginPath();
            ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(78, 242, 210, ${r.alpha})`;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        }

        animFrameId = requestAnimationFrame(render);
    }

    // Canvas click detection
    canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clickX = (e.clientX - rect.left) * scaleX;
        const clickY = (e.clientY - rect.top) * scaleY;

        for (const z of zones) {
            const dx = clickX - z.x;
            const dy = clickY - z.y;
            if (Math.sqrt(dx * dx + dy * dy) <= z.r) {
                fireInteraction(z.id);
                return;
            }
        }
        // Empty canvas tap
        fireInteraction('touch_body');
    });

    // Button event listeners
    btnHead?.addEventListener('click', () => fireInteraction('touch_head'));
    btnBody?.addEventListener('click', () => fireInteraction('touch_body'));
    btnElevator?.addEventListener('click', () => fireInteraction('touch_idle1'));
    btnReset?.addEventListener('click', () => fireInteraction('reset'));
    btnClearLog?.addEventListener('click', () => {
        if (simLog) simLog.innerHTML = '<div class="log-entry system">[system] Log cleared.</div>';
    });

    // Toggle listeners
    chkCover?.addEventListener('change', (e) => {
        isCovered = e.target.checked;
        if (isCovered) {
            appendLog('warn', `[niri] workspace covered by windows -> app.ticker.stop() [0% GPU]`);
        } else {
            appendLog('ok', `[niri] workspace uncovered -> app.ticker.start() [Resumed 60fps]`);
            lastTime = performance.now();
            animFrameId = requestAnimationFrame(render);
        }
    });

    chkHints?.addEventListener('change', (e) => {
        showHints = e.target.checked;
        appendLog('system', `[ui] hitzone badges: ${showHints ? 'enabled' : 'hidden'}`);
    });

    chkMirror?.addEventListener('change', (e) => {
        if (e.target.checked) {
            appendLog('ok', `[mirror] HDMI-A-1 paintable active. 1 WebProcess serves 2 outputs (342MB RSS).`);
        } else {
            appendLog('system', `[mirror] secondary output disconnected.`);
        }
    });

    // Start loop
    animFrameId = requestAnimationFrame(render);
})();
