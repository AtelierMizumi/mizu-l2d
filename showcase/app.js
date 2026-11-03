// Mizu-L2D Showcase Controller (showcase/app.js)

(function () {
    const video = document.getElementById("real-video-player");
    if (video) {
        // Ensure video plays smoothly
        video.play().catch(() => {
            // Autoplay with sound might be blocked, ensure muted playback works
            video.muted = true;
            video.play().catch(() => {});
        });
    }
})();
