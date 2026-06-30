# RSS-GenAI Setup Guide

## Overview

This project generates RSS/Atom feeds from any webpage using:
- **Markdown fetchers**: Jina.ai Reader first, with markdown.new fallback for outages
- **DeepSeek LLM (OpenAI-compatible API)**: Parses content and outputs structured JSON
- **Programmatic XML Builder**: Generates well-formed RSS 2.0 / Atom XML from structured data
- **Persistent Registry** (Upstash Redis on Vercel, file-system locally): Prevents duplicate RSS entries and date drift across regenerations

## Key Features

✅ **No Duplicate Articles**: GUID-based deduplication with persistent date tracking  
✅ **Structured Output**: LLM outputs JSON → code builds XML (no more XML escaping issues)  
✅ **Model Fallback**: Automatic fallback through multiple models on rate limits  
✅ **Full-Text RSS**: Optional full article content in feed entries  
✅ **Multi-Source Aggregation**: Merge multiple sites into a single feed  
✅ **Atom Support**: Generate RSS 2.0 or Atom feeds  
✅ **Custom Base URL**: Support for OpenAI-compatible APIs  
✅ **Vercel-Ready**: Registry persists across cold starts via Upstash Redis  

## Environment Setup

### Required Environment Variables

Create a `.env.local` file in the project root with:

```env
# Required: Your DeepSeek API key
DEEPSEEK_API_KEY=sk-your-api-key-here

# Optional: Custom DeepSeek/OpenAI-compatible base URL
# If omitted, uses https://api.deepseek.com
DEEPSEEK_BASE_URL=

# Optional: Specify a single model (skips fallback chain)
# If not set, uses: deepseek-v4-flash
DEEPSEEK_MODEL=

# Backward-compatible fallback env vars are still accepted:
# OPENAI_API_KEY=
# OPENAI_BASE_URL=
# OPENAI_MODEL=

# Optional (Vercel): Upstash Redis for persistent article date registry
# These are auto-injected when you add Upstash Redis via Vercel Marketplace
KV_REST_API_URL=
KV_REST_API_TOKEN=
# Or use Upstash native env var names:
# UPSTASH_REDIS_REST_URL=
# UPSTASH_REDIS_REST_TOKEN=
```

### Getting a DeepSeek API Key

1. Visit [DeepSeek Platform](https://platform.deepseek.com/)
2. Sign in or create an account
3. Generate a new API key
4. Copy and paste it into your `.env.local` file

### Setting Up Upstash Redis (for Vercel Deployment)

The article date registry needs persistent storage on Vercel (serverless filesystem is ephemeral). 

1. Go to [Vercel Marketplace → Redis](https://vercel.com/marketplace?category=storage&search=redis)
2. Add Upstash Redis integration to your project
3. The environment variables (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) are auto-injected
4. Free tier: 10,000 requests/day, 256 MB — more than enough for personal use

> **Local development**: If Redis env vars are not set, the app automatically falls back to file-system storage (`.rss-cache/` directory). No setup needed for local dev.

## Installation & Running

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Visit http://localhost:3000 to access the application.

## API Reference

### 1. Generate RSS Feed

```
GET /api/rss?url=<target-url>
```

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `url` | ✅ | — | Target webpage URL |
| `fulltext` | ❌ | `false` | Set to `true` to include full article content |
| `limit` | ❌ | `10` | Number of articles to extract (1-30) |
| `format` | ❌ | `rss` | Output format: `rss` or `atom` |
| `refresh` | ❌ | `false` | Set to `true` to force regeneration (bypass cache) |
| `source` | ❌ | `auto` | Markdown source: `auto`, `jina`, or `markdown` |
| `markdownMethod` | ❌ | `auto` | markdown.new method: `auto`, `ai`, or `browser` |

**Examples:**

```bash
# Basic RSS feed
curl "http://localhost:3000/api/rss?url=https://example.com/blog"

# Full-text feed with 20 articles
curl "http://localhost:3000/api/rss?url=https://example.com/blog&fulltext=true&limit=20"

# Atom format
curl "http://localhost:3000/api/rss?url=https://example.com/blog&format=atom"

# Force refresh (bypass cache)
curl "http://localhost:3000/api/rss?url=https://example.com/blog&refresh=true"

# Force markdown.new instead of Jina
curl "http://localhost:3000/api/rss?url=https://example.com/blog&source=markdown&markdownMethod=browser"
```

### 2. Multi-Source Aggregated Feed

```
GET /api/rss/merge?urls=<url1>,<url2>,...
```

Combines multiple sources into a single feed, sorted by date.

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `urls` | ✅ | — | Comma-separated list of target URLs (max 10) |
| `title` | ❌ | Auto-generated | Custom title for the merged feed |
| `limit` | ❌ | `10` | Articles per source (1-30) |
| `fulltext` | ❌ | `false` | Include full article content |
| `format` | ❌ | `rss` | Output format: `rss` or `atom` |
| `source` | ❌ | `auto` | Markdown source passed to each internal `/api/rss` call |
| `markdownMethod` | ❌ | `auto` | markdown.new method passed to each internal `/api/rss` call |

**Example:**

```bash
curl "http://localhost:3000/api/rss/merge?urls=https://blog1.com,https://blog2.com&title=My+Tech+Feed"
```

### 3. Feed Status / Health Check

```
GET /api/rss/status?url=<target-url>
```

Returns JSON with feed tracking information — useful for debugging.

**Example response:**

```json
{
  "url": "https://example.com/blog",
  "status": "active",
  "trackedArticles": 42,
  "newestFirstSeen": "2026-05-20T12:00:00.000Z",
  "oldestFirstSeen": "2026-01-15T08:30:00.000Z",
  "newestPubDate": "Tue, 20 May 2026 00:00:00 GMT",
  "oldestPubDate": "Wed, 15 Jan 2026 00:00:00 GMT",
  "recentArticles": [...]
}
```

## RSS Reader Setup

Add any of these URLs to your RSS reader (Feedly, Inoreader, NetNewsWire, etc.):

```
# Single source
https://your-vercel-app.vercel.app/api/rss?url=https://target-blog.com

# Full-text single source
https://your-vercel-app.vercel.app/api/rss?url=https://target-blog.com&fulltext=true

# Multi-source aggregated
https://your-vercel-app.vercel.app/api/rss/merge?urls=https://blog1.com,https://blog2.com
```

## Response Headers

Monitor these headers to understand caching and processing:

| Header | Values | Description |
|--------|--------|-------------|
| `X-RSS-Cache-Status` | `HIT` / `MISS` | RSS generation cache status |
| `X-Markdown-Cache-Status` | `HIT` / `MISS` | Webpage content fetch cache status |
| `X-Markdown-Source` | `jina` / `markdown` | Provider used for webpage markdown |
| `X-Markdown-Method` | `auto` / `ai` / `browser` / `n/a` | markdown.new method when used |
| `X-Model-Used` | Model name | Which LLM model was used |
| `X-Article-Count` | Number | Articles in the feed |
| `X-Feed-Format` | `rss` / `atom` | Output format |
| `X-Fulltext` | `true` / `false` | Whether full-text mode is active |
| `X-Markdown-Fetch-Time` | Duration | Time to fetch webpage content |

## Markdown Fetching

Default `source=auto` tries Jina.ai Reader first and falls back to markdown.new if Jina fails. Use `source=jina` or `source=markdown` to force one provider.

Jina.ai selector filtering can exclude:
- Headers and footers
- Navigation menus
- Sidebars
- Advertisements
- Social sharing buttons
- Comment sections
- Related posts sections

## Models

The implementation uses `deepseek-v4-flash` by default via DeepSeek's OpenAI-compatible API.

Set `DEEPSEEK_MODEL=your-model` to use a different DeepSeek model. `OPENAI_MODEL` remains accepted as a backward-compatible fallback.

## Architecture

```
Request → Markdown fetcher (cached 24h) → LLM extracts JSON → XML Builder → Date Stabilisation → Response
                                              │                    │               │
                                       Structured JSON        Well-formed     Persistent Registry
                                       (not raw XML)          RSS/Atom XML    (Redis or filesystem)
```

Key design decisions:
- **JSON → XML**: LLM outputs structured JSON, code builds XML. Eliminates all XML escaping issues.
- **Fetcher Fallback**: `source=auto` keeps Jina as the first choice and uses markdown.new when Jina is unavailable.
- **Date Registry**: Persistent storage ensures articles keep their original publication dates across regenerations.
- **Lazy Client Init**: OpenAI client is initialized on first request, not at module load time (enables clean builds without API keys).

## Troubleshooting

**API Key Errors**: Ensure `DEEPSEEK_API_KEY` is set in `.env.local` (local) or Vercel Environment Variables (production)

**Empty/Invalid RSS**: The webpage might not have article-like content, or content filtering may be too aggressive

**Rate Limits**: The API automatically falls back to alternative models on 429 errors

**Duplicate Articles in RSS Reader**: Use `refresh=true` to force regeneration. Check `/api/rss/status?url=...` to see tracked articles.

**Date Drift on Vercel**: Ensure Upstash Redis is configured. Without it, the date registry is lost on cold starts.

## Production Deployment (Vercel)

1. Push to GitHub (Vercel auto-deploys)
2. Set `DEEPSEEK_API_KEY` in Vercel Environment Variables
3. Optionally set `DEEPSEEK_BASE_URL` and `DEEPSEEK_MODEL`
4. Add Upstash Redis from Vercel Marketplace (for persistent date registry)
5. Monitor response headers to verify cache effectiveness
