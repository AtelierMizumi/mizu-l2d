// Mizu-L2D Showcase Controller (showcase/app.js)

(function () {
    // 1. Ensure video autoplay behaves smoothly
    const video = document.getElementById("real-video-player");
    if (video) {
        video.play().catch(() => {
            video.muted = true;
            video.play().catch(() => {});
        });
    }

    // 2. Screenshot Showcase Lightbox & Zoom Viewer
    const cards = Array.from(document.querySelectorAll(".screenshot-card"));
    const lightbox = document.getElementById("lightbox");
    if (!lightbox || cards.length === 0) return;

    const lightboxImg = document.getElementById("lightbox-img");
    const lightboxTitle = document.getElementById("lightbox-title");
    const lightboxDesc = document.getElementById("lightbox-desc");
    const lightboxCounter = document.getElementById("lightbox-counter");
    const closeBtn = lightbox.querySelector(".lightbox-close");
    const prevBtn = lightbox.querySelector(".lightbox-prev");
    const nextBtn = lightbox.querySelector(".lightbox-next");
    const overlay = lightbox.querySelector(".lightbox-overlay");
    const mediaWrap = lightbox.querySelector(".lightbox-media-wrap");

    // Extract item data from cards
    const galleryItems = cards.map((card) => {
        const img = card.querySelector("img");
        const title = card.querySelector("h4");
        const desc = card.querySelector("p");
        return {
            src: img ? img.getAttribute("src") : "",
            alt: img ? img.getAttribute("alt") : "",
            title: title ? title.textContent.trim() : "",
            desc: desc ? desc.textContent.trim() : ""
        };
    });

    let activeIndex = 0;
    let isZoomed = false;

    function renderActiveItem() {
        const item = galleryItems[activeIndex];
        if (!item) return;

        // Reset 1:1 zoom state when switching
        isZoomed = false;
        if (mediaWrap) mediaWrap.classList.remove("is-zoomed");

        lightboxImg.src = item.src;
        lightboxImg.alt = item.alt;
        if (lightboxTitle) lightboxTitle.textContent = item.title;
        if (lightboxDesc) lightboxDesc.textContent = item.desc;
        if (lightboxCounter) lightboxCounter.textContent = `${activeIndex + 1} / ${galleryItems.length}`;
    }

    function openLightbox(index) {
        activeIndex = index;
        renderActiveItem();
        lightbox.classList.add("is-open");
        lightbox.setAttribute("aria-hidden", "false");
        document.body.classList.add("lightbox-open");
    }

    function closeLightbox() {
        lightbox.classList.remove("is-open");
        lightbox.setAttribute("aria-hidden", "true");
        document.body.classList.remove("lightbox-open");
        if (mediaWrap) mediaWrap.classList.remove("is-zoomed");
        isZoomed = false;
    }

    function showPrev() {
        activeIndex = (activeIndex - 1 + galleryItems.length) % galleryItems.length;
        renderActiveItem();
    }

    function showNext() {
        activeIndex = (activeIndex + 1) % galleryItems.length;
        renderActiveItem();
    }

    function toggleZoom(e) {
        if (e) e.stopPropagation();
        isZoomed = !isZoomed;
        if (mediaWrap) {
            mediaWrap.classList.toggle("is-zoomed", isZoomed);
        }
    }

    // Attach click handlers to cards
    cards.forEach((card, idx) => {
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
        card.setAttribute("aria-label", `View screenshot: ${galleryItems[idx]?.title || "preview"}`);

        card.addEventListener("click", () => openLightbox(idx));
        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openLightbox(idx);
            }
        });
    });

    // Control buttons
    if (closeBtn) closeBtn.addEventListener("click", closeLightbox);
    if (overlay) overlay.addEventListener("click", closeLightbox);
    if (prevBtn) prevBtn.addEventListener("click", (e) => { e.stopPropagation(); showPrev(); });
    if (nextBtn) nextBtn.addEventListener("click", (e) => { e.stopPropagation(); showNext(); });

    // Click image to toggle 1:1 original pixel zoom
    if (lightboxImg) {
        lightboxImg.addEventListener("click", toggleZoom);
    }

    // Keyboard navigation
    window.addEventListener("keydown", (e) => {
        if (!lightbox.classList.contains("is-open")) return;
        if (e.key === "Escape") {
            closeLightbox();
        } else if (e.key === "ArrowLeft") {
            showPrev();
        } else if (e.key === "ArrowRight") {
            showNext();
        }
    });
})();
