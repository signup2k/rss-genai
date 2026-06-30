# Changelog

## 2026-06-30

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
