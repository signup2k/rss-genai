# TODO

## Current Task

- [x] Diagnose `/api/rss` failure for `https://www.ml.com/capital-market-outlook.html`.
- [x] Patch OpenAI-compatible JSON-mode prompt so `json_object` validation accepts the request.
- [x] Run local lint and production build validation.
- [ ] Deploy the fix to production before re-testing `https://rss-genai.vercel.app/api/rss?url=https://www.ml.com/capital-market-outlook.html`.

## Follow-ups

- [ ] Consider adding a small unit or integration test around prompt construction if a test runner is introduced.
