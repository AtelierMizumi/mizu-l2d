# Remote model sources — structure plan

Status: PLAN (v0, 2026-10-31). Owner request: stop storing the whole model
library locally (one prefab ≈ 10 MB, ~190+ skins) and fetch models on demand
from external sources instead, keeping the option of a self-hosted asset
store for later.

What already exists (build on it, don't replace it):

- `scripts/fetch-model.sh <prefab> [--bg]` — pulls one model + interaction
  data from the nagami.moe CDNs (`azlassets.nagami.moe/EN` for assets,
  `data.nagami.moe/live2d/EN` for interaction data) into
  `~/.local/share/mizu/l2d/<prefab>/`. Flat list of paths, no manifest,
  no verification, no cache management.
- `scripts/serve.py` — `POST /api/download?prefab=` (header-gated,
  origin-checked, one download at a time) runs `fetch-model.sh` and streams
  its output; the web picker and the shell model browser drive it today.
- `web/data/l2d_mapping.json` + `l2d_index.json` — the full ship → skin →
  prefab catalog mirrored locally. **Gitignored on purpose** (SPEC §12);
  everything below keeps that invariant.

## Goal state

```
catalog (remote, small JSON)  →  fetcher (verify + atomic)  →  local cache
        ▲                              │                       (quota, LRU)
        │                              ▼
source priority list            shell model browser
(nagami → mirrors → self-host)  ("download" button, progress, evict)
```

The local library stops being "everything I ever loaded" and becomes a cache
of recently used prefabs within a quota; anything else is one click away.

## Milestones

### M1 — Manifest per prefab (fetch-model v0.3) — SHIPPED 2026-10-31

Implemented in `scripts/fetch-model.py` (with `fetch-model.sh` as a thin
wrapper preserving the serve.py/shell contract):

- Model files resolved from `model3.json` (moc, textures, motions, physics,
  pose) with the third-party-CDN path-safety check kept.
- Downloads land in `<dest>.tmp-<pid>/`, sha256 is recorded per file into
  `.mizu-manifest.json`, then the directory is swapped in atomically; a failed
  run leaves the old model untouched. `--verify` re-checks an installed
  prefab; `--force` ignores the reuse shortcut.
- Files already present are reused without re-download; new files fetch with
  bounded parallelism (`--jobs`, default 3) and `curl -C -` resume.
- `--bg` still resolves the skin background from the mapping and records its
  hash in `l2d/bg/.mizu-manifest.json`.
- On success the cache ledger gets the prefab's size and last-used time.

### M2 — Cache management (`scripts/mizu-l2d-cache.py`) — SHIPPED 2026-10-31

- Ledger at `~/.local/share/mizu/l2d/.ledger.json` (module
  `scripts/l2d_ledger.py`): prefab → {last_used, pinned, bytes} + optional
  quota_bytes. Every writer (host, fetch, cache tool) does
  load-modify-atomic-replace so they interleave safely.
- The host touches `last_used` on every model load (`wall.py
  touch_last_used`, startup + `model` command); the shell refreshes its read
  after downloads, model switches, and cache operations.
- Commands: `status [--json] [--rescan]`, `scan` (seed the whole library),
  `touch`, `pin`/`unpin`, `evict`, `enforce [--quota GB] [--dry-run]`,
  `quota <GB>`, `verify [prefab]`.
- Policy: 2 GB default quota; eviction is LRU over unpinned prefabs and never
  touches the active model (`[wall] model`), pinned prefabs, or anything that
  does not look like an installed prefab. `enforce` only acts when invoked.
- Shell integration: IPC `l2dCacheStatus` / `l2dCacheEvict` / `l2dCacheClean`
  and a "Model storage" action on the Live2D settings card.

### M3 — Source priority list

- Config section (host + fetcher share it):

  ```toml
  [sources]
  order = ["nagami", "mirror-gh", "self"]
  nagami.assets = "https://azlassets.nagami.moe/EN"
  nagami.data = "https://data.nagami.live2d/EN"   # placeholder, keep current values
  mirror_gh.raw = "https://raw.githubusercontent.com/<repo>/<branch>"
  self.base = "https://assets.example.com/mizu"
  ```

- The fetcher walks the list and uses the first source that serves a valid
  manifest; per-source failure is logged, not fatal.
- Community GitHub mirrors (e.g. collected Live2D model repositories) slot in
  as `mirror-gh` without code changes — only base URLs change.

### M4 — Remote catalog

- The mirrored `l2d_mapping.json` becomes a *generated* artifact: a local
  generator script (`scripts/build-catalog.py`) produces
  `catalog.json` (prefab → {name, ship, skin, size, sha256-manifest URL,
  bg id}) from whatever source data is current.
- The catalog is published *somewhere remote* (any static HTTP host) and
  cached locally with a TTL; the browser lists remote entries that are not
  downloaded yet as "cloud" items.
- Content still never enters git: the repo ships the *generator* and the
  *schema*, never the data.

### M5 — Self-hosted asset store (later, only if still needed)

- A static object store (any web server, or Cloudflare R2 / S3) laid out as
  `<game>/<ship>/<skin>/…` plus a `catalog.json` at the bucket root — the
  same schema as M4, so the fetcher cannot tell the difference.
- Sync tool (`scripts/mizu-l2d-store.py push`) uploads the local library and
  regenerates `catalog.json` + manifests; optional private bucket via signed
  URLs or basic auth.
- This is the "chuẩn hoá" endpoint: one schema, N sources, the owner's own
  store being just the most reliable one.

## Licensing guardrails (unchanged, restated)

- Azur Lane content is Manjuu/Yongshi / Yostar / Bilibili IP — personal,
  local use only. This repo hosts **pointers and code**, never assets.
- Before any public release: catalog + downloader move to a private overlay
  (SPEC §12 amendment) or the amendment is reverted by the owner.
- A self-hosted store (M5) must stay private or be populated only with
  content the owner has rights to redistribute (e.g. Live2D's official free
  sample models, self-made models).

## Open questions [owner]

1. Cache quota default (2 GB?) and whether pinned models bypass it.
2. Should downloads ever run on metered connections / at boot, or only on
   explicit action (today: explicit only — recommended to keep)?
3. For M5: private bucket + auth vs. plain static hosting on the LAN only.
