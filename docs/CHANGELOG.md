# Changelog

## 2026-06-29

- Fixed `/api/rss` JSON-mode prompt compatibility by adding explicit lowercase `json` instructions to both system and user messages before using `response_format: { type: "json_object" }`.
- Cleaned existing ESLint issues in the selector config route, site selector helper, and dashboard page so project lint passes.
- Added initial project context, TODO, changelog, and file map documentation for future coding-agent work.

Validation:
- `npm run lint` passed.
- `npm run build` passed.
