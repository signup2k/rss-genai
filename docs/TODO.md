# TODO

## Current Task

- [x] Switch default LLM provider/model to DeepSeek `deepseek-v4-flash`.
- [x] Add lightweight LLM input truncation and bad item filtering.
- [x] Run local lint and production build validation.
- [x] Push the change to GitHub so Vercel auto-deploys.

## Previous Task

- [x] Diagnose `/api/rss` failure for `https://www.ml.com/capital-market-outlook.html`.
- [x] Patch OpenAI-compatible JSON-mode prompt so `json_object` validation accepts the request.
- [x] Run local lint and production build validation.
- [x] Deploy the fix to production before re-testing `https://rss-genai.vercel.app/api/rss?url=https://www.ml.com/capital-market-outlook.html`.

## Follow-ups

- [ ] Consider adding a small unit or integration test around prompt construction if a test runner is introduced.
