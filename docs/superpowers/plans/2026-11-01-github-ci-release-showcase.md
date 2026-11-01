# GitHub CI/CD, Release Automation & Showcase Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish an ultra-fast, change-aware GitHub CI pipeline (spelling, code quality, syntax gates), automated GitHub Release packaging, and an interactive showcase GitHub Pages website for `mizu-l2d`.

**Architecture:** 
1. `.github/workflows/ci.yml` uses path-filtering (`dorny/paths-filter`) and fast typo/linter checks (`crate-ci/typos`, Python compile, JS syntax check, zero-hardcode grep gate) to ensure lightweight, < 30s checks on PRs and pushes without heavy full-suite bloat.
2. `.github/workflows/release.yml` triggers on version tags (`v*`), packaging clean distribution archives with SHA-256 checksums and automated release notes.
3. `showcase/` provides a modern dark-aesthetic interactive showcase web application (live touch interaction simulator, architecture visualizer, performance telemetry highlights, installation runbook) automatically deployed to GitHub Pages via `.github/workflows/pages.yml`.

**Tech Stack:** GitHub Actions, `crate-ci/typos`, `dorny/paths-filter`, Node.js, Python 3, HTML5 / CSS3 (Glassmorphism & Canvas), `actions/deploy-pages`.

**Spec:** User requirements (2026-11-01): Fast incremental checks, typo and code quality focus, release packaging, interactive GitHub Pages showcase.

---

## Global Constraints

- **Lightweight CI:** CI execution time must remain under 60 seconds on standard GitHub Actions runners; no heavy full browser AC probe runs in default PR checks.
- **Path-Filtered Checks:** Only test modified components (e.g. docs changes only check spelling; web changes check JS syntax; Python changes compile check).
- **Clean Distribution Archives:** Release tarballs must exclude local dev files, `.git`, `build/`, `*.pyc`, `web/assets`, and temporary artifacts.
- **No External Proprietary Bloat:** Showcase pages must not bundle copyrighted Live2D moc3 binary assets; interactive showcase uses simulated live interaction canvas and visualizers.
- **Strict Git Boundary:** Local commits only; do not push without user consent.

---

## Review Focus

1. **Typo false positives on Japanese/Chinese pinyin identifiers:** Ensure typos ignore technical terms (`moc3`, `niri`, `layer-shell`, `prefabs`, `gaoxiong`, `antu`, `azurlane`, `nagami`, `paintable`).
2. **Path filtering correctness:** Verify `ci.yml` properly handles PRs touching multiple folders and skips redundant checks.
3. **Release archive purity:** Verify tarball builds with exact permissions and contains no untracked `.tmp` or cache artifacts.
4. **GitHub Pages static asset routing:** Ensure CSS/JS/images use relative paths so they resolve correctly on `https://ateliermizumi.github.io/mizu-l2d/`.
5. **Mobile & high-DPI responsiveness:** Verify the showcase layout scales cleanly on both desktop (1080p/4K) and mobile viewports.

---

## Tasks

### Task 1: Lightweight Code Quality & Typo CI (`.github/workflows/ci.yml`)

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `_typos.toml`

**Step 1: Create `_typos.toml` configuration**
Configure `crate-ci/typos` to ignore technical identifiers specific to Azur Lane, Live2D, Wayland, and Linux:
```toml
[default.extend-words]
moc = "moc"
niri = "niri"
prefabs = "prefabs"
antu = "antu"
gaoxiong = "gaoxiong"
benningdun = "benningdun"
wuqi = "wuqi"
nagami = "nagami"
paintable = "paintable"
```

**Step 2: Create `.github/workflows/ci.yml`**
Implement path-filtered workflow:
- Job 1: `typos`: Runs `crate-ci/typos` across repo.
- Job 2: `quality-web`: Triggers only if `web/**` or `tests/**` changed. Runs `node --check` and engine syntax sanity checks.
- Job 3: `quality-python`: Triggers only if `wall/**` or `scripts/**` changed. Runs `python3 -m py_compile`.
- Job 4: `grep-gate`: Ensures zero per-skin hardcodes in `web/engine/`.

**Step 3: Test syntax and actions locally**
Run `python3 -m py_compile` and node check locally.

**Step 4: Commit**
`git add _typos.toml .github/workflows/ci.yml && git commit -m "ci: add lightweight incremental quality and typo workflows"`

---

### Task 2: Automated GitHub Release Workflow (`.github/workflows/release.yml`)

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `scripts/package-release.sh`

**Step 1: Create `scripts/package-release.sh`**
Script that:
- Reads version from git tag or argument.
- Creates clean tarball: `mizu-l2d-${VERSION}.tar.gz`.
- Computes SHA-256: `sha256sum mizu-l2d-${VERSION}.tar.gz > mizu-l2d-${VERSION}.tar.gz.sha256`.

**Step 2: Create `.github/workflows/release.yml`**
Workflow triggered on `push: tags: ['v*']`:
- Checks out repo.
- Runs `scripts/package-release.sh`.
- Uses `softprops/action-gh-release@v2` with generated tarball and sha256.

**Step 3: Verification**
Test `scripts/package-release.sh v0.2.0` in local `/tmp` workspace.

**Step 4: Commit**
`git add scripts/package-release.sh .github/workflows/release.yml && git commit -m "ci(release): add automated tag packaging and release pipeline"`

---

### Task 3: Showcase Landing Page (`showcase/`)

**Files:**
- Create: `showcase/index.html`
- Create: `showcase/style.css`
- Create: `showcase/app.js`

**Step 1: Design `showcase/index.html`**
Structure:
- Navbar: Branding, GitHub link, Architecture, Runbook, Demo.
- Hero Section: Tagline, Key metrics badge (342MB RAM, 0% CPU on cover, 16 triggers, Wayland native).
- Interactive Live Simulator: WebGL/Canvas touch demo with interactive character hotspot simulation, dialogue speech bubbles, and pose changer.
- Architectural Deep-Dive Cards:
  - 1. The Mirror Spike (`Gtk.WidgetPaintable` memory saver).
  - 2. Pause on Cover (`niri msg event-stream` power management).
  - 3. Data-driven Hotspot Engine (zero hardcoding).
  - 4. Hotplug Resilience (HDMI dynamic failover).
- Live Telemetry & Benchmark Comparison chart.
- Quickstart Runbook for Arch Linux & Niri (`pacman`, `systemd`, `config.toml`).
- Footer with AtelierMizumi credits and documentation links.

**Step 2: Implement styling in `showcase/style.css`**
- Dark obsidian background `#090a0f`, neon cyan `#4ef2d2`, vibrant sakura `#ff6b9d`.
- Modern typography (Inter + Fira Code), fluid responsive grid, glassmorphic cards with frosted backdrop filters.

**Step 3: Implement interactivity in `showcase/app.js`**
- Interactive canvas simulator with mouse tracking, click wave animation, simulated dialogue lines, and live telemetry ticker (FPS / RAM counters).

**Step 4: Commit**
`git add showcase/ && git commit -m "feat(showcase): create interactive showcase landing page"`

---

### Task 4: GitHub Pages Automated Deployment (`.github/workflows/pages.yml`)

**Files:**
- Create: `.github/workflows/pages.yml`

**Step 1: Create `.github/workflows/pages.yml`**
- Trigger: `push` on branch `master` (when `showcase/**` changes) and `workflow_dispatch`.
- Permissions: `pages: write`, `id-token: write`.
- Steps:
  - Checkout.
  - Setup Pages (`actions/configure-pages@v5`).
  - Upload artifact (`actions/upload-pages-artifact@v3`, path `showcase`).
  - Deploy (`actions/deploy-pages@v4`).

**Step 2: Commit**
`git add .github/workflows/pages.yml && git commit -m "ci(pages): add automated deployment workflow for showcase website"`

---

### Task 5: Verification & Documentation

**Files:**
- Modify: `README.md` (Add CI badges, GitHub Pages showcase link, and Quickstart).
- Modify: `STATUS.md` (Record CI/CD & Showcase milestone).

**Step 1: Update README.md**
Add top badges:
- CI Status Badge
- GitHub Pages Showcase Link
- License & Version Tag

**Step 2: Test Showcase Locally**
Run `python3 -m http.server 8989 --directory showcase` and verify in headless browser probe.

**Step 3: Commit**
`git add README.md STATUS.md && git commit -m "docs: link showcase page and CI workflows in README"`
