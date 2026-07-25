# Project Context

## Overview

RSS GenAI is a Next.js app that generates RSS or Atom feeds from arbitrary
webpages. The main endpoint fetches content through a Markdown provider layer,
extracts source-backed article data through adapters or an OpenAI-compatible
LLM, validates and stabilizes the items, then serializes them to XML locally.

## Stack

- Next.js 16 with App Router and React 19.
- TypeScript.
- OpenAI SDK 4.x pointed at DeepSeek's OpenAI-compatible API by default.
- Upstash Redis or Vercel KV for persistent article date registries and selector configs, with local file fallback.

## Important Files

- `app/api/rss/route.ts`: primary feed generation route.
- `app/api/rss/merge/route.ts`: combines multiple generated RSS feeds.
- `app/api/rss/status/route.ts`: reports registry/debug status for a feed URL.
- `app/api/config/selectors/route.ts`: stores global Jina selector configs.
- `lib/storage.ts`: Redis/file storage abstraction.
- `lib/markdown-provider.ts`: bounded Jina/markdown.new fetching and caching.
- `lib/feed-extractor.ts`: LLM, deterministic, and incremental extraction.
- `lib/feed-postprocessor.ts`: link health, dates, and full-text enrichment.
- `lib/site-selectors.ts`: selector resolution logic.
- `lib/url-utils.ts`: target/article URL validation, normalization, and legacy rewrites.
- `lib/xml-builder.ts`: RSS/Atom XML serialization.

## Current Status

- 2026-06-29: Fixed an OpenAI-compatible JSON-mode validation failure by ensuring both system and user messages explicitly contain lowercase `json` while keeping `response_format: { type: "json_object" }`.
- 2026-06-30: Switched default LLM provider/model to DeepSeek `deepseek-v4-flash`; added lightweight LLM input truncation and item filtering.
- 2026-06-30: Added markdown.new as a fallback markdown source when Jina.ai Reader is unavailable.
- 2026-07-09: Added deterministic Markdown extraction with explicit `deterministic`,
  confidence-gated `auto`, and comparison-only `shadow` modes. The default
  remains `llm` until actual subscriptions have been compared.
- 2026-07-09: Replaced confidence-gated `auto` with domain adapters and
  persistent incremental snapshots after broader live testing found confident
  false positives. Adapters cover Bridgewater, CSIS, DB Research, Morgan
  Stanley, and Citadel Securities.
- 2026-07-25: Made source-backed `auto` extraction the default, centralized URL
  normalization, versioned snapshots, made refresh bypass all feed-local caches,
  added link-health filtering and best-effort per-article full text, and
  transparently migrated the legacy Deutsche Bank Research source.

## Constraints

- Do not generate XML directly with the LLM; keep XML serialization in `lib/xml-builder.ts`.
- Preserve explicit JSON-mode instructions when changing prompts. Some providers reject `json_object` requests unless request messages visibly include lowercase `json`.
- Default LLM env vars are `DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL`, and optional `DEEPSEEK_MODEL`; `OPENAI_*` vars remain fallback-compatible.
- Page content sent to the LLM is capped at 100,000 characters to keep personal-use cost and latency bounded.
- Extraction defaults to `auto`, configurable with `EXTRACTION_MODE` or the
  per-request `extract` parameter. `auto` is incremental for supported domain
  adapters and falls back to the allowlisted full-page LLM path elsewhere.
- Default content source is `source=auto`: try the global and China-accessible
  Jina endpoints, then markdown.new. Jina CSS selectors only apply to Jina.
- `refresh=true` bypasses page, LLM, link-health, and snapshot caches only for
  the requested feed; it must not invalidate shared tags for other feeds.
- Production persistence depends on Redis/KV env vars; filesystem fallback on Vercel is not durable.
