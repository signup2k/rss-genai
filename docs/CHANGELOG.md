# Changelog

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
