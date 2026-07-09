# TODO

## Current Task

- [x] Replace unsafe confidence-gated auto extraction with domain adapters.
- [x] Normalize JSON-wrapped markdown.new responses.
- [x] Add persistent feed snapshots and process only newly discovered cards.
- [x] Add adapters for Bridgewater, CSIS, DB Research, Morgan Stanley, and Citadel Securities.
- [x] Verify first-run incremental LLM and subsequent zero-LLM snapshot behavior.
- [x] Make refresh URL-scoped so one manual refresh cannot invalidate every feed.
- [x] Validate deterministic Markdown extraction on four representative live pages.
- [x] Add deterministic, auto, and shadow extraction modes without changing the default.
- [x] Expose extraction strategy and confidence in response headers.
- [x] Run live endpoint, lint, and production build validation.
- [x] Remove unused `.vscode/` workspace folder.
- [x] Add markdown.new as a fallback markdown source for Jina outages.
- [x] Add dashboard/API controls for markdown source selection.
- [x] Run local lint and production build validation.

## Previous Task

- [x] Switch default LLM provider/model to DeepSeek `deepseek-v4-flash`.
- [x] Add lightweight LLM input truncation and bad item filtering.
- [x] Run local lint and production build validation.
- [x] Push the change to GitHub so Vercel auto-deploys.

## Older Task

- [x] Diagnose `/api/rss` failure for `https://www.ml.com/capital-market-outlook.html`.
- [x] Patch OpenAI-compatible JSON-mode prompt so `json_object` validation accepts the request.
- [x] Run local lint and production build validation.
- [x] Deploy the fix to production before re-testing `https://rss-genai.vercel.app/api/rss?url=https://www.ml.com/capital-market-outlook.html`.

## Follow-ups

- [ ] Consider adding a small unit or integration test around prompt construction if a test runner is introduced.
