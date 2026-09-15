# Changelog

## 2026-09-15

- Published the first production rule for Man Group Insights. It performs the
  site's deterministic investor-disclosure form handshake with an isolated
  cookie jar, extracts all three insight views, and supports article full text.
- Replaced runtime model inference with versioned, deterministic RuleV1 objects.
- Restricted production fetching to registered rules and removed caller-provided
  target URLs and selectors.
- Added bounded HTML fetching, Cheerio CSS extraction, runtime assertions,
  optional rule-scoped full text, and a shared feed service.
- Removed the model SDK, Markdown conversion providers, adapters, snapshots,
  extraction modes, and mutable selector configuration.
- Changed single, merge, and status APIs to use rule IDs.
- Added fixture tests, a rule catalogue, rule documentation, and `npm run check`.
- Upgraded Next.js from 16.1.1 to 16.3.5 to address published advisories.

Validation:
- Live Man Insights extraction returned 18 unique items; the RSS endpoint
  returned six requested items and full-text extraction returned article body.
- Rule-engine fixture tests passed.
- ESLint passed.
- Production build passed.

## 2026-07-25

- Preserved the target protocol in both Jina Reader endpoint URLs.
- Added centralized target/article URL validation, source URL allowlisting,
  HTTPS normalization, tracking-parameter cleanup, and consistent link/GUID use.
- Made adapter candidates authoritative so the LLM cannot rewrite article URLs.
- Versioned incremental snapshots, included candidate content fingerprints, and
  made `refresh=true` bypass page, LLM, link-health, and snapshot caches.
- Changed the default extraction mode to `auto`.
- Transparently migrated the retired Deutsche Bank Research URL to
  `equityview.research.db.com` and excluded image assets from its adapter.
- Added cached 404/410 link checks and best-effort per-article full-text fetching.
- Reduced feed/Markdown cache windows from 24 hours to 30 minutes.
- Removed the dashboard password, while adding selector payload validation.
- Deduplicated merged items, supported repeated `url` parameters, handled
  all-source failure explicitly, and fixed CDATA/entity handling.
- Removed invalid XML control characters and stabilized feed update timestamps.

Validation:
- Live legacy Deutsche Bank auto extraction returned three current HTTPS PDF links.
- A second Deutsche Bank request reused the versioned snapshot with no LLM call.
- Live Morgan Stanley extraction returned only HTTPS article links.
- Live full-text extraction populated `content:encoded`.
- `npm run lint` passed.
- `npm run build` passed.

## 2026-07-09

- Added domain-adapted article candidate extraction for Bridgewater, CSIS,
  Deutsche Bank Research, Morgan Stanley, and Citadel Securities.
- Changed `extract=auto` to send only newly discovered candidate cards to the
  LLM and reuse persistent Redis/file snapshots when candidate URLs are unchanged.
- Added markdown.new JSON payload normalization and a China-accessible Jina
  Reader fallback endpoint.
- Kept unsupported and full-text pages on the existing full LLM path.
- Made `refresh=true` URL-scoped instead of invalidating every feed cache.
- Added extraction strategy, adapter, confidence, and model response headers.
- Added and documented `llm`, `deterministic`, `auto`, and `shadow` modes.

Validation:
- Live first-run incremental and second-run zero-LLM snapshot checks passed for
  all five configured domains.
- `npm run lint` passed.
- `npm run build` passed.

## 2026-06-30

- Added `source=auto|jina|markdown` and `markdownMethod=auto|ai|browser` support for webpage markdown fetching.
- Default fetch behavior now tries Jina.ai Reader first and falls back to markdown.new if Jina fails.
- Added dashboard controls for markdown source selection and removed the unused local `.vscode/` folder.
- Updated `/api/rss/merge` to pass markdown source options through to internal `/api/rss` calls.
- Switched the default OpenAI-compatible provider to DeepSeek using `DEEPSEEK_API_KEY`, default base URL `https://api.deepseek.com`, and default model `deepseek-v4-flash`.
- Kept `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` as fallback environment variables.
- Capped webpage content sent to the LLM at 100,000 characters.
- Added lightweight RSS item normalization that drops LLM items without a usable `title` or `link`.

Validation:
- `npm run lint` passed.
- `npm run build` passed.

## 2026-06-29

- Fixed `/api/rss` JSON-mode prompt compatibility by adding explicit lowercase `json` instructions to both system and user messages before using `response_format: { type: "json_object" }`.
- Cleaned existing ESLint issues in the selector config route, site selector helper, and dashboard page so project lint passes.
- Added initial project context, TODO, changelog, and file map documentation for future coding-agent work.

Validation:
- `npm run lint` passed.
- `npm run build` passed.
