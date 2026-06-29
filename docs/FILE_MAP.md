# File Map
> Per-file index for AI agents. Read the relevant entry BEFORE opening a file;
> read only the line ranges the entry points to. Update entries after any
> structural change (see $repo-map skill).
Last full audit: 2026-06-29 | Files mapped: 16

## Root

### README.md (~73 lines, md, map-updated 2026-06-29)
Purpose: concise public API overview for RSS generation and feed merging.
Structure:
- API usage examples for `/api/rss`, `/api/rss/merge`, and `/api/rss/status`.
Depends on: current Next.js route behavior.

### SETUP.md (~241 lines, md, map-updated 2026-06-29)
Purpose: setup and deployment guide covering OpenAI-compatible LLMs, Redis, Vercel, and troubleshooting.
Structure:
- Env var reference for `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, Redis/KV, and admin password.
- API examples and deployment notes for Vercel.
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

## app

### app/layout.tsx (~34 lines, tsx, map-updated 2026-06-29)
Purpose: root metadata and layout wrapper for the Next.js app.
Structure:
- `metadata`: app title and description.
- `RootLayout`: wraps app content with HTML/body and global font classes.

### app/page.tsx (~311 lines, tsx, map-updated 2026-06-29)
Purpose: client-side dashboard for generating RSS links and managing site selector configs.
Structure:
- `Home` component: local state for generator fields, admin password, selector configs, and errors.
- Handlers build `/api/rss` links and POST global selector configs.
Depends on: `/api/config/selectors`, `GlobalSiteConfig`, `SiteSelectors`.

### app/globals.css (css, map-updated 2026-06-29)
Purpose: global Tailwind/CSS styling for the app shell.

## app/api

### app/api/rss/route.ts (~378 lines, ts, map-updated 2026-06-29)
Purpose: primary RSS/Atom generator endpoint; fetches webpage markdown, asks an LLM for structured feed data, stabilizes dates, and emits XML.
Structure:
- `getOpenAI` (L25): lazy OpenAI SDK client using `OPENAI_API_KEY` and optional `OPENAI_BASE_URL`.
- `fetchWithJina` / `fetchWithJinaCache` (L43): Jina Reader fetch with selector headers and 24h cache.
- `buildSystemPrompt` (L94): schema and extraction rules for JSON-mode LLM output.
- `generateFeedData` (L134): model fallback loop, `response_format: { type: "json_object" }`, JSON parsing, structure validation.
- `stabiliseDates` (L211): reconciles item dates against persistent registry.
- `GET` (L256): query parsing, cache invalidation, fetch/generate/build response pipeline.
Depends on: `openai`, Next cache APIs, `lib/storage`, `lib/xml-builder`, `lib/site-selectors`.
Gotchas: OpenAI-compatible JSON mode can reject requests unless input messages explicitly contain lowercase `json`; keep both system and user prompts explicit.

### app/api/rss/merge/route.ts (~174 lines, ts, map-updated 2026-06-29)
Purpose: merges multiple generated RSS feeds into a single RSS/Atom feed.
Structure:
- `GET`: validates `urls`, fetches internal `/api/rss` for each source, extracts items, sorts by pubDate, and rebuilds XML.
- `unescapeXml`: reverses XML escaping before passing items back to the XML builder.
Depends on: `lib/xml-builder`.
Gotchas: parses its own RSS output with regex, which is acceptable only because this project controls the XML shape.

### app/api/rss/status/route.ts (~71 lines, ts, map-updated 2026-06-29)
Purpose: exposes registry status for a generated feed URL.
Structure:
- `GET`: loads registry records, reports counts, date ranges, and up to five recent tracked articles.
Depends on: `lib/storage`.

### app/api/config/selectors/route.ts (~49 lines, ts, map-updated 2026-06-29)
Purpose: reads and writes global domain selector configuration used by Jina Reader.
Structure:
- `checkAuth`: compares `x-admin-password` with `ADMIN_PASSWORD` or a default.
- `GET`: returns global configs.
- `POST`: saves configs after password check.
Depends on: `lib/storage`.
Gotchas: default admin password is present when `ADMIN_PASSWORD` is unset.

## lib

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

### lib/storage.ts (~180 lines, ts, map-updated 2026-06-29)
Purpose: storage abstraction for article date registries and global selector configs.
Structure:
- Types: `ArticleRecord`, `UrlRegistry`, `GlobalSiteConfig`.
- Redis backend: lazy Upstash Redis initialization from Vercel KV/Upstash env vars.
- File backend: `.rss-cache/` locally or `/tmp/.rss-cache` on Vercel.
- Public API: `loadRegistry`, `saveRegistry`, `loadGlobalSiteConfigs`, `saveGlobalSiteConfigs`.
Depends on: `crypto`, `fs/promises`, `path`, `@upstash/redis`.
Gotchas: production filesystem fallback is not durable; Redis env vars are needed for persistence across cold starts.

### lib/xml-builder.ts (~151 lines, ts, map-updated 2026-06-29)
Purpose: builds well-formed RSS 2.0 and Atom XML from structured feed data.
Structure:
- Types: `RSSItem`, `RSSChannel`, `RSSFeedData`.
- `escapeXml`: escapes text for XML nodes/attributes.
- `buildRSS`: creates RSS 2.0 with optional `content:encoded`.
- `buildAtom`: creates Atom feed and converts RSS dates to ISO where possible.

## Other

### public/*.svg and app/favicon.ico (static assets, map-updated 2026-06-29)
Purpose: default static assets from the Next.js app scaffold.

### package-lock.json (generated, map-updated 2026-06-29)
Purpose: npm lockfile; do not read manually unless dependency resolution changes.

### eslint.config.mjs and postcss.config.mjs (config, map-updated 2026-06-29)
Purpose: project lint and PostCSS/Tailwind configuration.
