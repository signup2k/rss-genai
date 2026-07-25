# File Map
> Per-file index for AI agents. Read the relevant entry BEFORE opening a file;
> read only the line ranges the entry points to. Update entries after any
> structural change (see $repo-map skill).
Last full audit: 2026-07-25 | Files mapped: 27

## Root

### README.md (~71 lines, md, map-updated 2026-07-25)
Purpose: concise public API overview for RSS generation and feed merging.
Structure:
- API usage examples for `/api/rss`, `/api/rss/merge`, and `/api/rss/status`, including markdown source and extraction-mode selection.
Depends on: current Next.js route behavior.

### SETUP.md (~277 lines, md, map-updated 2026-07-25)
Purpose: setup and deployment guide covering OpenAI-compatible LLMs, Redis, Vercel, and troubleshooting.
Structure:
- Env var reference for LLM settings, `EXTRACTION_MODE`, and Redis/KV.
- API examples, deterministic/auto/shadow extraction modes, markdown source options, and deployment notes for Vercel.
Gotchas: provider-specific OpenAI-compatible behavior may differ from official OpenAI.

### package.json (~28 lines, json, map-updated 2026-06-29)
Purpose: declares the Next.js app scripts and runtime dependencies.
Structure:
- Scripts: `dev`, `build`, `start`, `lint`.
- Dependencies: Next 16, React 19, OpenAI SDK 4.x, Upstash Redis.

### next.config.ts (~7 lines, ts, map-updated 2026-06-29)
Purpose: minimal Next.js configuration.
Structure:
- Exports an empty `NextConfig` object.

### tsconfig.json (~34 lines, json, map-updated 2026-06-29)
Purpose: TypeScript compiler settings for Next.js.
Structure:
- Uses path alias `@/*` to project root.

### CLAUDE.md (~1 line, md, map-updated 2026-06-29)
Purpose: instructs coding agents to use this file map before exploration.

### docs/DETERMINISTIC_EXTRACTION_TEST_PLAN.md (~114 lines, md, map-updated 2026-07-09)
Purpose: defines acceptance criteria and records the live feasibility run for deterministic Markdown extraction.
Structure:
- Prototype algorithm, quality thresholds, production safety checks, and results from four representative live pages.
Gotchas: the successful test validates deterministic-first feasibility, not an unconditional replacement for the LLM fallback.

## app

### app/layout.tsx (~34 lines, tsx, map-updated 2026-06-29)
Purpose: root metadata and layout wrapper for the Next.js app.
Structure:
- `metadata`: app title and description.
- `RootLayout`: wraps app content with HTML/body and global font classes.

### app/page.tsx (~341 lines, tsx, map-updated 2026-07-25)
Purpose: client-side dashboard for generating RSS links, choosing markdown source options, and managing site selector configs.
Structure:
- `Home` component: local state for generator fields, extraction/source options, selector configs, and errors.
- Handlers build `/api/rss` links with optional source/method params and POST global selector configs.
Depends on: `/api/config/selectors`, `GlobalSiteConfig`, `SiteSelectors`.

### app/globals.css (css, map-updated 2026-06-29)
Purpose: global Tailwind/CSS styling for the app shell.

## app/api

### app/api/rss/route.ts (~217 lines, ts, map-updated 2026-07-25)
Purpose: thin RSS/Atom request orchestrator.
Structure:
- `GET`: validates/rewrites the target, fetches Markdown, invokes extraction and
  post-processing, then builds XML and response headers.
Depends on: `lib/markdown-provider`, `lib/feed-extractor`,
`lib/feed-postprocessor`, `lib/url-utils`, `lib/xml-builder`.

### app/api/rss/merge/route.ts (~222 lines, ts, map-updated 2026-07-25)
Purpose: merges multiple generated RSS feeds into a single RSS/Atom feed.
Structure:
- `GET`: accepts repeated `url` or compatible `urls` input, fetches sources,
  deduplicates items, sorts by valid dates, and rebuilds XML.
- `unescapeXml`: reverses XML escaping before passing items back to the XML builder.
Depends on: `lib/xml-builder`, `lib/url-utils`.
Gotchas: parses its own RSS output with regex, which is acceptable only because this project controls the XML shape.

### app/api/rss/status/route.ts (~71 lines, ts, map-updated 2026-06-29)
Purpose: exposes registry status for a generated feed URL.
Structure:
- `GET`: loads registry records, reports counts, date ranges, and up to five recent tracked articles.
Depends on: `lib/storage`.

### app/api/config/selectors/route.ts (~57 lines, ts, map-updated 2026-07-25)
Purpose: reads and writes global domain selector configuration used by Jina Reader.
Structure:
- `GET`: returns global configs.
- `POST`: validates and saves the complete personal selector config.
Depends on: `lib/storage`.

## lib

### lib/candidate-extractor.ts (~284 lines, ts, map-updated 2026-07-25)
Purpose: normalizes provider payloads and extracts bounded article-card candidates for incremental LLM processing.
Structure:
- `normalizeMarkdownPayload`: unwraps markdown.new JSON responses.
- `extractArticleCandidates`: routes to adapters for Bridgewater, CSIS, DB Research, Morgan Stanley, and Citadel Securities.
- `buildCandidatePrompt`: serializes only new candidate blocks for the LLM.
Gotchas: unsupported domains intentionally return no candidates and use the full LLM path. The Deutsche Bank adapter accepts both its retired and current hosts but excludes cover-image assets.

### lib/deterministic-extractor.ts (~255 lines, ts, map-updated 2026-07-25)
Purpose: extracts feed items from reader Markdown without an LLM and reports a confidence score.
Structure:
- `parseExtractionMode`: validates `llm`, `deterministic`, `auto`, and `shadow`.
- `extractFeedDeterministically`: filters Markdown links, finds the dominant permalink family, preserves source order, cleans titles/dates, and builds feed data.
Depends on: RSS feed types from `lib/xml-builder`.
Gotchas: confidence measures structural consistency, not semantic correctness.

### lib/feed-extractor.ts (~485 lines, ts, map-updated 2026-07-25)
Purpose: source-backed feed extraction through deterministic, full LLM, and
adapter-incremental strategies.
Structure:
- OpenAI-compatible JSON extraction with a Markdown-derived URL allowlist.
- Adapter candidates remain authoritative for links and GUIDs.
- Versioned snapshots include candidate content fingerprints and context keys.
Gotchas: keep lowercase `json` in both prompt messages for provider compatibility.

### lib/feed-postprocessor.ts (~219 lines, ts, map-updated 2026-07-25)
Purpose: validates article availability, stabilizes dates, migrates registry
identities, and optionally fetches per-article full text.
Structure:
- Cached HEAD/GET confirmation drops only definite 404/410 links.
- Three-worker best-effort article Markdown enrichment.
- Registry migration merges HTTP/HTTPS identities and removes retired DB links.

### lib/markdown-provider.ts (~171 lines, ts, map-updated 2026-07-25)
Purpose: bounded and timed Markdown fetching through Jina Reader with
markdown.new fallback.
Structure:
- Preserves the full target URL for both Jina endpoints.
- Validates response size/content and caches pages for 30 minutes.
- Exports source/method parsers and cached/uncached fetch functions.
Gotchas: Jina selectors do not apply to markdown.new.

### lib/default-configs.ts (~20 lines, ts, map-updated 2026-06-29)
Purpose: built-in domain selector defaults for common sites.
Structure:
- `DEFAULT_SITE_CONFIGS`: selector configs for Medium, GitHub, X, and Twitter.
Depends on: `SiteSelectors` type from `lib/site-selectors`.

### lib/site-selectors.ts (~53 lines, ts, map-updated 2026-06-29)
Purpose: resolves CSS selectors for a target URL by combining API params, saved configs, defaults, and fallback removal selectors.
Structure:
- `SiteSelectors`: selector shape.
- `getSiteSelectors`: normalizes hostnames and loads matching saved/default config.
- `resolveSelectors`: applies precedence API params > saved/default > fallback removal selector.
Depends on: `lib/storage`, `lib/default-configs`.

### lib/storage.ts (~249 lines, ts, map-updated 2026-07-25)
Purpose: storage abstraction for article date registries, incremental feed snapshots, and global selector configs.
Structure:
- Types: `ArticleRecord`, `UrlRegistry`, `GlobalSiteConfig`.
- Redis backend: lazy Upstash Redis initialization from Vercel KV/Upstash env vars.
- Atomic file backend: `.rss-cache/` locally or `/tmp/.rss-cache` on Vercel.
- Public API includes registry, feed snapshot, and global selector load/save pairs.
Depends on: `crypto`, `fs/promises`, `path`, `@upstash/redis`.
Gotchas: production filesystem fallback is not durable; Redis env vars are needed for persistence across cold starts.

### lib/url-utils.ts (~130 lines, ts, map-updated 2026-07-25)
Purpose: central target/article URL validation, normalization, identity, source
allowlist collection, and known legacy target rewrites.
Structure:
- Rejects non-HTTP schemes and cross-host article links.
- Upgrades same-site HTTP links when the source is HTTPS and removes common
  tracking parameters.
- Rewrites the retired Deutsche Bank Research home URL to its current host.

### lib/xml-builder.ts (~168 lines, ts, map-updated 2026-07-25)
Purpose: builds well-formed RSS 2.0 and Atom XML from structured feed data.
Structure:
- Types: `RSSItem`, `RSSChannel`, `RSSFeedData`.
- `escapeXml`: escapes text for XML nodes/attributes.
- `buildRSS`: creates RSS 2.0 with optional `content:encoded`.
- `buildAtom`: creates Atom feed and converts RSS dates to ISO where possible.
Gotchas: XML-illegal control characters are removed before serialization.

## Other

### public/*.svg and app/favicon.ico (static assets, map-updated 2026-06-29)
Purpose: default static assets from the Next.js app scaffold.

### package-lock.json (generated, map-updated 2026-06-29)
Purpose: npm lockfile; do not read manually unless dependency resolution changes.

### eslint.config.mjs and postcss.config.mjs (config, map-updated 2026-06-29)
Purpose: project lint and PostCSS/Tailwind configuration.
