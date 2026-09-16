# Project context

RSS Rules is a Next.js service for deterministic RSS/Atom generation. An
external harness owns website analysis, fixture capture, live validation, and
rule authoring. This repository only contains and executes reviewed RuleV1
objects.

```text
rule id → registered RuleV1 → bounded HTML/XML fetch (direct or Jina transport)
        → CSS extraction
        → date stabilization → optional rule-scoped full text → XML
```

There is intentionally no fallback for unknown websites. Rules bind their own
source URL and allowed article hosts.

## Important files

- `rules/index.ts`: production rule allowlist.
- `lib/rule-schema.ts`: RuleV1 contract and fail-fast validation.
- `lib/rule-registry.ts`: validated rule lookup.
- `lib/rule-engine.ts`: HTML/XML fetching (direct or Jina transport), CSS
  extraction, and full text.
- `lib/feed-service.ts`: feed generation shared by HTTP routes.
- `app/api/rss/route.ts`: single-feed endpoint.
- `app/api/rss/merge/route.ts`: registered-feed aggregation.
- `lib/feed-postprocessor.ts`: stable first-seen dates.
- `lib/xml-builder.ts`: the only RSS/Atom serializer.

Do not add runtime inference, arbitrary target URLs, or a generic selector
fallback. Keep rule publication Git-backed until mutable publishing is needed.
