# RSS GenAI

Generate RSS 2.0 or Atom feeds from webpages that do not publish feeds of their
own. The app converts a page to Markdown, extracts only source-backed article
URLs, and builds XML locally.

The default `auto` mode uses lightweight site adapters where available and an
OpenAI-compatible LLM for article metadata. Unsupported sites fall back to the
full-page LLM path. Article links are normalized and checked before publication.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). See [SETUP.md](SETUP.md)
for environment variables and deployment details.

## API Reference

### `/api/rss`

Generates an RSS or Atom feed from a specified webpage.

**Query Parameters:**
- `url` (required): The target webpage URL.
- `fulltext` (optional): Set to `true` to fetch article Markdown as full-text
  content on a best-effort basis.
- `limit` (optional): Maximum number of articles to extract (1-30, default: 10).
- `format` (optional): `rss` (default) or `atom`.
- `refresh` (optional): Set to `true` to bypass page, LLM, link-health, and
  incremental snapshot caches for this feed.
- `source` (optional): `auto` (default), `jina`, or `markdown`. `auto` tries Jina first and falls back to markdown.new.
- `markdownMethod` (optional): markdown.new method: `auto` (default), `ai`, or `browser`.
- `extract` (optional): `auto` (default), `llm`, `deterministic`, or `shadow`.
  `auto` uses a site adapter to identify article cards, sends only new cards to
  the LLM, and reuses a persistent snapshot when no new URLs appear. Unsupported
  sites fall back to the full LLM path.

#### Markdown Source Parameters

This project can fetch markdown through Jina.ai Reader or markdown.new. CSS selector overrides only apply to Jina.ai Reader.

- `target` (optional): CSS selector for exact content to extract (`X-Target-Selector`).
- `remove` (optional): CSS selector for elements to remove, such as ads or navbars (`X-Remove-Selector`).
- `waitfor` (optional): CSS selector to wait for before extraction, useful for dynamic content (`X-Wait-For-Selector`).

**Example:**
```bash
curl "http://localhost:3000/api/rss?url=https://example.com/blog&target=article.content&remove=.ads,.nav"
curl "http://localhost:3000/api/rss?url=https://example.com/blog&source=markdown&markdownMethod=browser"
curl "http://localhost:3000/api/rss?url=https://example.com/blog&extract=deterministic"
curl "http://localhost:3000/api/rss?url=https://example.com/blog&extract=auto"
```

### `/api/rss/merge`

Aggregates multiple RSS feeds into a single combined feed.

**Query Parameters:**
- `url` (recommended): Repeat this parameter for each target webpage URL.
- `urls` (compatible): Comma-separated target URLs.
- `title` (optional): Custom title for the aggregated feed.
- `limit` (optional): Maximum articles per source.
- `fulltext` (optional): Set to `true` for full article content.
- `format` (optional): `rss` (default) or `atom`.
- `extract` (optional): extraction mode forwarded to each source.
- `source` (optional): `auto` (default), `jina`, or `markdown`.
- `markdownMethod` (optional): markdown.new method: `auto` (default), `ai`, or `browser`.
