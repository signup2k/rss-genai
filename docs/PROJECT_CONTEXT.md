# Project Context

## Overview

RSS GenAI is a Next.js app that generates RSS or Atom feeds from arbitrary webpages. The main endpoint fetches webpage content through Jina Reader, asks an OpenAI-compatible LLM to extract structured feed data, then serializes that data into XML locally.

## Stack

- Next.js 16 with App Router and React 19.
- TypeScript.
- OpenAI SDK 4.x with optional `OPENAI_BASE_URL` for compatible providers.
- Upstash Redis or Vercel KV for persistent article date registries and selector configs, with local file fallback.

## Important Files

- `app/api/rss/route.ts`: primary feed generation route.
- `app/api/rss/merge/route.ts`: combines multiple generated RSS feeds.
- `app/api/rss/status/route.ts`: reports registry/debug status for a feed URL.
- `app/api/config/selectors/route.ts`: stores global Jina selector configs.
- `lib/storage.ts`: Redis/file storage abstraction.
- `lib/site-selectors.ts`: selector resolution logic.
- `lib/xml-builder.ts`: RSS/Atom XML serialization.

## Current Status

- 2026-06-29: Fixed an OpenAI-compatible JSON-mode validation failure by ensuring both system and user messages explicitly contain lowercase `json` while keeping `response_format: { type: "json_object" }`.

## Constraints

- Do not generate XML directly with the LLM; keep XML serialization in `lib/xml-builder.ts`.
- Preserve explicit JSON-mode instructions when changing prompts. Some providers reject `json_object` requests unless request messages visibly include lowercase `json`.
- Production persistence depends on Redis/KV env vars; filesystem fallback on Vercel is not durable.
