// Mizu-L2D Interactive Showcase Controller (showcase/app.js)

(function () {
    const video = document.getElementById("real-video-player");
    const dialogueElem = document.getElementById("sim-dialogue");
    const dialogueText = document.getElementById("dialogue-text");
    const hudState = document.getElementById("hud-pose");
    const hudFps = document.getElementById("hud-fps");
    const simLog = document.getElementById("sim-log");

    const btnHead = document.getElementById("btn-tap-head");
    const btnBody = document.getElementById("btn-tap-body");
    const btnSpecial = document.getElementById("btn-tap-special");
    const btnReset = document.getElementById("btn-reset-pose");
    const btnClearLog = document.getElementById("btn-clear-log");

    const chkCover = document.getElementById("chk-cover");
    const chkHints = document.getElementById("chk-hints");
    const chkMirror = document.getElementById("chk-mirror");

    let dialogueTimer = null;

    const lines = {
        touch_head: [
            "Commander, patting my head while I am taking the sea breeze?",
            "The warmth of the sun and your presence... brings me tranquility.",
        ],
        touch_body: [
            "The tide is gentle today. Are you ready for our next sortie?",
            "All Iris Libre communications nominal. Wallpaper layer drawing at 144Hz.",
        ],
        touch_special: [
            "Commander?! Such boldness under the open azure sky...",
            "A holy blessing upon you... but please maintain decorum here.",
        ],
        main_1: [
            "The flag of Iris Libre flutters proudly in the summer wind!",
            "Restoring baseline pose. Interactive model and eye-gaze tracking active.",
        ],
    };

    function appendLog(category, text) {
        if (!simLog) return;
        const entry = document.createElement("div");
        entry.className = "log-entry " + category;
        const ts = new Date().toISOString().substring(11, 19);
        entry.textContent = "[" + ts + "] [" + category + "] " + text;
        simLog.appendChild(entry);
        simLog.scrollTop = simLog.scrollHeight;
    }

    function triggerDialogue(type) {
        const pool = lines[type] || lines.main_1;
        const line = pool[Math.floor(Math.random() * pool.length)];

        if (dialogueText) dialogueText.textContent = line;
        if (dialogueElem) {
            dialogueElem.style.display = "block";
            dialogueElem.style.animation = "none";
            void dialogueElem.offsetWidth;
            dialogueElem.style.animation = "fadeIn 0.25s ease-out";
        }

        clearTimeout(dialogueTimer);
        dialogueTimer = setTimeout(() => {
            if (dialogueElem) dialogueElem.style.display = "none";
        }, 4500);

        if (hudState) {
            hudState.textContent = "Trigger: " + type;
        }

        appendLog("trigger", "Fired action: " + type + " -> \"" + line.substring(0, 38) + "...\"");

        // Briefly speed up or loop video for motion
        if (video) {
            video.currentTime = (video.currentTime + 0.5) % Math.max(1, video.duration || 3);
            video.play().catch(() => {});
        }
    }

    // Button event listeners
    if (btnHead) btnHead.addEventListener("click", () => triggerDialogue("touch_head"));
    if (btnBody) btnBody.addEventListener("click", () => triggerDialogue("touch_body"));
    if (btnSpecial) btnSpecial.addEventListener("click", () => triggerDialogue("touch_special"));
    if (btnReset) btnReset.addEventListener("click", () => triggerDialogue("main_1"));

    if (btnClearLog && simLog) {
        btnClearLog.addEventListener("click", () => {
            simLog.innerHTML = "";
            appendLog("system", "Log buffer cleared.");
        });
    }

    // Cover toggle (Pause on cover simulation)
    if (chkCover) {
        chkCover.addEventListener("change", (e) => {
            if (e.target.checked) {
                if (video) video.pause();
                if (hudFps) hudFps.textContent = "FPS: 0.0 (PAUSED)";
                appendLog("power", "Workspaces occluded: app.ticker.stop() -> GPU 0.0%, 0 FPS");
            } else {
                if (video) video.play().catch(() => {});
                if (hudFps) hudFps.textContent = "FPS: 60.0";
                appendLog("power", "Workspace revealed: app.ticker.start() -> resumed at 60 FPS");
            }
        });
    }

    // Mirror toggle
    if (chkMirror) {
        chkMirror.addEventListener("change", (e) => {
            if (e.target.checked) {
                appendLog("mirror", "Gtk.WidgetPaintable attached to secondary monitor HDMI-A-1 (RSS: 342MB)");
            } else {
                appendLog("mirror", "Detached secondary surface. Single monitor mode active.");
            }
        });
    }

    // Hints toggle
    if (chkHints) {
        chkHints.addEventListener("change", (e) => {
            appendLog("config", "Debug hitzones overlay: " + (e.target.checked ? "ON" : "OFF"));
        });
    }

    // Initialize initial log
    appendLog("system", "Showcase loaded with Richelieu (lisailiu_2) live video stream.");
    appendLog("ipc", "Socket connected: /run/user/1000/mizu-l2d-wall.sock (ready)");
})();
