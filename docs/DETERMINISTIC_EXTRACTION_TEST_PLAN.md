# Deterministic Extraction Feasibility Test

## Goal

Determine whether RSS item extraction can use deterministic parsing by default
and reserve the LLM for pages that cannot be parsed reliably.

This test does not change the production route.

## Input Under Test

Use the Markdown returned by the same reader class used in production. Include
representative page types:

1. A financial research/topic page.
2. A conventional news or blog index.
3. A technical blog index.
4. A page with noisy navigation or card layouts.

## Prototype Algorithm

1. Parse Markdown links in the form `[title](URL)`.
2. Resolve relative links against the target URL.
3. Reject same-page anchors, assets, login/share/navigation links, and titles
   that are too short or look like UI labels.
4. Prefer links appearing under article-like headings or whose URL paths look
   like article permalinks.
5. Deduplicate by canonicalized URL.
6. Look near each accepted link for a recognizable publication date.
7. Return at most the requested number of items.

The prototype intentionally does not use an LLM and does not contain
site-specific rules.

## Evaluation

Manually inspect the first ten extracted items for each page.

- **Precision:** accepted items that are real articles / accepted items.
- **Usable result:** at least five real articles, or all available articles
  when the page contains fewer than five.
- **Title quality:** title is meaningful and not a navigation label.
- **Link quality:** absolute, unique, and points to the corresponding article.
- **Date coverage:** publication dates found when visibly present in Markdown.

## Decision Threshold

Proceed with deterministic-first production extraction when:

- At least 75% of representative pages produce a usable result.
- Overall article precision is at least 90%.
- Failures can be detected automatically, rather than silently returning a
  low-quality feed.

Pages below the confidence threshold must continue to use the existing LLM
path. Domain-specific rules are a later optimization, not part of this test.

## Safety Checks for a Production Implementation

- Never replace an existing valid feed with an empty deterministic result.
- Emit the extraction strategy and confidence in response headers/logs.
- Keep an explicit query option to force deterministic or LLM extraction.
- Compare both paths in shadow mode before changing the default.
- Record invocation counts and fallback reasons to verify actual cost savings.

## Feasibility Run — 2026-07-09

Four live pages were fetched through Jina Reader and evaluated with a standalone
prototype. No production source code or LLM was used.

| Page | Dominant permalink family | Items inspected | Real articles | Usable |
| --- | --- | ---: | ---: | --- |
| Merrill Capital Market Outlook | `/content/ml/en/capital-market-outlook` | 10 | 10 | Yes |
| Next.js Blog | `/blog` | 10 | 10 | Yes |
| OpenAI News | `/index` | 7 | 7 | Yes |
| BBC News | `/news/articles` | 10 | 10 | Yes |

Observed article precision was 37/37 (100%), and all four pages met the usable
result threshold. The dominant-permalink-family heuristic was important:
ranking individual links by an article-likelihood score produced incorrect
ordering on the long Next.js archive, while grouping by permalink family and
preserving source order produced the expected recent-item order.

### Limitations Found

- Markdown card links sometimes combine title, category, date, and summary in
  one label. Titles therefore need conservative cleanup.
- A date found in a broad text window can belong to the preceding card. Date
  extraction must prefer the link label, then the URL, then a tightly scoped
  preceding date line.
- BBC exposed no per-item dates in the listing Markdown. Such items should use
  the existing first-seen date behavior rather than guessing.
- OpenAI had valid articles on another hostname, but the dominant family
  intentionally selected the main site's `/index` items. This is desirable by
  default but should be configurable.

### Decision

The feasibility threshold passed. Implement the parser behind a shadow/explicit
mode first. It should fall back to the current LLM path when confidence is low,
and it should not become the default until its output has been compared against
the existing path on the user's actual subscribed URLs.

## Broader Live-Test Revision — 2026-07-09

Testing Bridgewater, CSIS, DB Research, Morgan Stanley, and Citadel Securities
invalidated the earlier confidence model. Structurally consistent URL families
can still be topic pages, filters, or series indexes, so confidence-gated generic
extraction is not safe as an automatic default.

`auto` now means domain-adapted incremental extraction: an adapter identifies
candidate cards, persistent snapshots track processed URLs, and the LLM sees
only new candidate blocks. Unsupported sites use the full LLM path. The generic
deterministic parser remains available only as an explicit experimental mode.
