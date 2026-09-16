# File map

Last structural update: 2026-09-16.

## Rule pipeline

- `rules/index.ts`: reviewed production rule allowlist.
- `rules/man-insights.ts`: Man Group Insights rule, including disclosure form.
- `rules/README.md`: publishing workflow.
- `lib/rule-schema.ts`: RuleV1 types and runtime validation.
- `lib/rule-registry.ts`: validates rules at module load and resolves IDs.
- `lib/rule-engine.ts`: bounded HTML/XML fetch, Cheerio extraction, runtime
  assertions, URL normalization, and optional full text.
- `rules/citadel-market-insights.ts`: Citadel native RSS rule using the reviewed
  Jina transport to reach the Cloudflare-protected origin.
- `lib/feed-service.ts`: shared orchestration used by single and merged feeds.
- `docs/RULE_FORMAT.md`: harness-facing rule contract.
- `tests/rule-engine.test.ts`: deterministic fixture coverage.

## HTTP routes

- `app/api/rules/route.ts`: public metadata for registered rules.
- `app/api/rss/route.ts`: RSS/Atom generation by registered rule ID.
- `app/api/rss/merge/route.ts`: combines 2-10 registered feeds.
- `app/api/rss/status/route.ts`: date-registry diagnostics by rule ID.
- `app/page.tsx`: read-only rule catalogue and feed links.

## Shared runtime

- `lib/url-utils.ts`: URL validation, normalization, and canonical identity.
- `lib/feed-postprocessor.ts`: persistent first-seen date stabilization.
- `lib/storage.ts`: Upstash Redis with local atomic-file fallback.
- `lib/xml-builder.ts`: RSS 2.0 and Atom serialization.

## Project configuration

- `package.json`: Next.js scripts and runtime dependencies.
- `SETUP.md`: local and production setup.
- `README.md`: public overview and API examples.
