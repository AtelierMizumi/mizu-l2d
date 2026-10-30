// R1c.2 model picker: a glass panel grouped by ship (167 ships / 239 skins
// from data/l2d_mapping.json), search over EN/CN/JP names, a "downloaded"
// filter, ships sorted by EN name (ship id breaks ties). Skins that are not on
// disk get a Tải button that calls /api/download (scripts/serve.py).
// Exposed as window.MizuPicker.init({ catalog, current, onSelect }).
(function () {
    const CACHE_KEY = 'mizu.downloaded';
    const PROBE_CONCURRENCY = 8;

    const readCache = () => {
        try { return JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {}; } catch { return {}; }
    };
    const writeCache = (obj) => {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch { /* ignore */ }
    };
    // accents folded so "agir" finds "Ägir"; CN/JP pass through unchanged
    const norm = (s) => (s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

    // some nagami names are unresolved template keys ("{namecode:430}"); drop them
    const clean = (s) => (s || '').replace(/\{namecode:\d+\}/g, '').replace(/\s+/g, ' ').trim();
    const cleanNames = (n = {}) => ({ EN: clean(n.EN), CN: clean(n.CN), JP: clean(n.JP) });

    function buildShips(catalog) {
        return Object.entries(catalog).map(([id, ship]) => {
            const names = cleanNames(ship.names);
            const skins = (ship.skins || []).map(s => {
                const sn = cleanNames(s.names);
                return {
                    prefab: s.prefab,
                    names: sn,
                    haystack: norm([s.prefab, sn.EN, sn.CN, sn.JP].join(' ')),
                };
            });
            return {
                id,
                names,
                skins,
                haystack: norm([names.EN, names.CN, names.JP].join(' ')),
            };
        }).sort((a, b) => (a.names.EN || '').localeCompare(b.names.EN || '', 'en')
            || Number(a.id) - Number(b.id));
    }

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function init({ catalog, current, onSelect }) {
        const ships = buildShips(catalog);
        const downloaded = readCache();
        let currentPrefab = current;
        let onlyDownloaded = false;
        let query = '';
        const expanded = new Set();
        const busy = new Map(); // prefab -> status text while Tải runs

        // ---- DOM ----
        const openBtn = el('button', 'picker-open');
        openBtn.type = 'button';
        openBtn.title = 'Chọn model';
        openBtn.setAttribute('aria-expanded', 'false');
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 40 40');
        svg.setAttribute('width', '40');
        svg.setAttribute('height', '40');
        svg.setAttribute('aria-hidden', 'true');
        const shape = (name, attrs) => {
            const node = document.createElementNS(svgNS, name);
            for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
            return node;
        };
        svg.append(
            shape('rect', { class: 'lens', x: 9, y: 10, width: 22, height: 20, rx: 5 }),
            shape('line', { class: 'bar', x1: 14, y1: 16, x2: 26, y2: 16 }),
            shape('line', { class: 'bar', x1: 14, y1: 20, x2: 26, y2: 20 }),
            shape('line', { class: 'bar', x1: 14, y1: 24, x2: 22, y2: 24 }));
        openBtn.append(svg);

        const panel = el('div', 'picker-panel');
        panel.hidden = true;
        const head = el('div', 'picker-head');
        const search = el('input', 'picker-search');
        search.type = 'search';
        search.placeholder = 'Tìm tàu / skin (EN, 中文, 日本語)';
        search.setAttribute('aria-label', 'Tìm model');
        const chip = el('button', 'picker-chip', 'Đã tải');
        chip.type = 'button';
        chip.setAttribute('aria-pressed', 'false');
        const count = el('div', 'picker-count');
        head.append(search, chip);
        const list = el('div', 'picker-list');
        panel.append(head, count, list);
        document.body.append(openBtn, panel);

        // ---- open/close ----
        function setOpen(open) {
            panel.hidden = !open;
            openBtn.setAttribute('aria-expanded', String(open));
            if (open) {
                probeDownloads();
                search.focus();
            }
        }
        openBtn.addEventListener('click', () => setOpen(panel.hidden));
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !panel.hidden) setOpen(false);
        });
        chip.addEventListener('click', () => {
            onlyDownloaded = !onlyDownloaded;
            chip.classList.toggle('on', onlyDownloaded);
            chip.setAttribute('aria-pressed', String(onlyDownloaded));
            render();
        });
        search.addEventListener('input', () => {
            query = norm(search.value.trim());
            render();
        });

        // ---- downloaded probe (HEAD, cached in localStorage) ----
        let probing = false;
        async function probeDownloads() {
            if (probing) return;
            const todo = ships.flatMap(s => s.skins.map(k => k.prefab))
                .filter(p => downloaded[p] !== true);
            if (!todo.length) return;
            probing = true;
            let next = 0;
            const worker = async () => {
                while (next < todo.length) {
                    const prefab = todo[next++];
                    try {
                        const resp = await fetch(`assets/${prefab}/${prefab}.model3.json`, { method: 'HEAD' });
                        downloaded[prefab] = resp.ok;
                    } catch {
                        downloaded[prefab] = false;
                    }
                }
            };
            await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));
            probing = false;
            writeCache(downloaded);
            render();
        }

        // ---- Tải ----
        async function download(prefab) {
            busy.set(prefab, 'Đang tải…');
            render();
            let last = '';
            try {
                const resp = await fetch(`api/download?prefab=${encodeURIComponent(prefab)}`, {
                    method: 'POST',
                    headers: { 'X-Mizu-Action': 'download' },
                });
                if (!resp.ok) throw new Error(resp.status === 404 || resp.status === 501
                    ? 'cần chạy scripts/serve.py' : `HTTP ${resp.status}`);
                const reader = resp.body.getReader();
                const decoder = new TextDecoder();
                let buf = '';
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    const lines = buf.split('\n');
                    buf = lines.pop();
                    for (const line of lines) if (line.trim()) last = line.trim();
                    busy.set(prefab, last.length > 40 ? `${last.slice(0, 40)}…` : (last || 'Đang tải…'));
                    render();
                }
                if (!last.startsWith('[exit 0]')) {
                    throw new Error(last || 'tải thất bại');
                }
                downloaded[prefab] = true;
                writeCache(downloaded);
                busy.delete(prefab);
            } catch (err) {
                busy.set(prefab, `Lỗi: ${err.message}`);
                console.error('[mizu] download failed:', prefab, err);
            }
            render();
        }

        // ---- render ----
        function matchesSkin(skin, shipMatched) {
            if (onlyDownloaded && downloaded[skin.prefab] !== true) return false;
            return !query || shipMatched || skin.haystack.includes(query);
        }

        let currentLang = 'vi';
        function isVi() { return (currentLang || 'vi') === 'vi'; }

        function render() {
            const frag = document.createDocumentFragment();
            let shown = 0, skinsShown = 0;
            for (const ship of ships) {
                const shipMatched = !query || ship.haystack.includes(query);
                const skins = ship.skins.filter(s => matchesSkin(s, shipMatched));
                if (!skins.length) continue;
                shown++;
                skinsShown += skins.length;
                const open = query ? true : (expanded.has(ship.id) || ship.skins.some(s => s.prefab === currentPrefab));
                const row = el('button', 'picker-ship' + (open ? ' open' : ''));
                row.type = 'button';
                row.append(el('span', 'picker-ship-en', ship.names.EN || ship.id));
                const sub = [ship.names.CN, ship.names.JP].filter(Boolean).join(' · ');
                if (sub) row.append(el('span', 'picker-ship-sub', sub));
                row.append(el('span', 'picker-ship-n', String(skins.length)));
                row.addEventListener('click', () => {
                    if (open) expanded.delete(ship.id); else expanded.add(ship.id);
                    render();
                });
                frag.append(row);
                if (!open) continue;
                for (const skin of skins) frag.append(skinRow(skin));
            }
            list.replaceChildren(frag);
            count.textContent = isVi()
                ? (`${shown} tàu · ${skinsShown} skin` + (probing ? ' · đang kiểm tra…' : ''))
                : (`${shown} ships · ${skinsShown} skins` + (probing ? ' · checking…' : ''));
        }

        function skinRow(skin) {
            const isCurrent = skin.prefab === currentPrefab;
            const isDown = downloaded[skin.prefab] === true;
            const row = el('div', 'picker-skin' + (isCurrent ? ' current' : ''));

            const thumb = el('img', 'picker-skin-thumb');
            thumb.src = `shots/${skin.prefab}.png`;
            thumb.alt = skin.names.EN || skin.prefab;
            thumb.loading = 'lazy';
            thumb.onerror = () => { thumb.style.display = 'none'; };
            row.append(thumb);

            const label = el('button', 'picker-skin-label');
            label.type = 'button';
            label.append(el('span', 'picker-skin-en', skin.names.EN || skin.prefab));
            const sub = [skin.names.CN, skin.names.JP].filter(Boolean).join(' · ');
            if (sub) label.append(el('span', 'picker-skin-sub', sub));
            if (isDown) {
                label.addEventListener('click', () => {
                    setOpen(false);
                    onSelect(skin.prefab);
                });
            } else {
                label.disabled = true;
            }
            row.append(label);
            if (busy.has(skin.prefab)) {
                row.append(el('span', 'picker-status', busy.get(skin.prefab)));
            } else if (!isDown) {
                const dl = el('button', 'picker-dl', isVi() ? 'Tải' : 'Download');
                dl.type = 'button';
                dl.title = isVi() ? 'Tải model này về máy' : 'Download model to local storage';
                dl.addEventListener('click', () => download(skin.prefab));
                row.append(dl);
            } else if (isCurrent) {
                row.append(el('span', 'picker-status', '●'));
            }
            return row;
        }

        function setLanguage(lang) {
            currentLang = lang || 'vi';
            openBtn.title = isVi() ? 'Đổi nhân vật Live2D' : 'Select Live2D Model';
            search.placeholder = isVi() ? 'Tìm tàu / skin (EN, 中文, 日本語)' : 'Search ship / skin (EN, CN, JP)';
            chip.textContent = isVi() ? 'Đã tải' : 'Downloaded';
            render();
        }

        render();
        return {
            // called after a successful switch so the highlight follows the model
            setCurrent(prefab) {
                currentPrefab = prefab;
                render();
            },
            setOpen,
            setLanguage,
        };
    }

    window.MizuPicker = { init };
})();
