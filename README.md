# RSS Rules

A small deterministic service that turns websites into RSS 2.0 or Atom feeds.
Production only executes versioned rules that were tested in the external
harness. It does not use an LLM, guess selectors, or fetch caller-provided URLs.

## Run locally

```bash
npm install
npm run dev
```

## Publish a rule

Develop and verify a `RuleV1` object in the harness, then add it to the `RULES`
array in `rules/index.ts`. The full contract is documented in
`docs/RULE_FORMAT.md`.

## API

```bash
curl "http://localhost:3000/api/rules"
curl "http://localhost:3000/api/rss?id=site-blog"
curl "http://localhost:3000/api/rss?id=site-blog&format=atom"
curl "http://localhost:3000/api/rss?id=site-blog&fulltext=true&limit=20"
curl "http://localhost:3000/api/rss/merge?id=site-blog&id=other-news"
curl "http://localhost:3000/api/rss/status?id=site-blog"
```

Run `npm run check` before publishing. The production pipeline is deliberately short:

```text
registered RuleV1 → bounded HTML fetch → Cheerio CSS extraction
                  → URL/date normalization → RSS/Atom serialization
```
