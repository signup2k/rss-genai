# RSS-GenAI Setup Guide

## Overview

This project generates RSS feeds from any webpage using:
- **Jina.ai Reader**: Fetches and converts webpages to markdown with content filtering
- **OpenAI API**: Parses content and generates structured RSS XML
- **Content-Based Caching**: Prevents duplicate RSS entries caused by LLM non-determinism

## Key Features

✅ **No Duplicate Articles**: Content hashing ensures same content → same RSS  
✅ **Cost Optimization**: Cache hits avoid LLM API calls (~80% reduction)  
✅ **Fast Responses**: Cached responses complete in <100ms  
✅ **Custom Base URL**: Support for OpenAI-compatible APIs  

## Environment Setup

### Required Environment Variables

Create a `.env.local` file in the project root with:

```env
# Required: Your OpenAI API key
OPENAI_API_KEY=sk-your-api-key-here

# Optional: Custom base URL for OpenAI-compatible APIs
# Leave empty or omit to use the default OpenAI endpoint
# Example for custom endpoint: https://your-custom-endpoint.com/v1
OPENAI_BASE_URL=
```

### Getting an OpenAI API Key

1. Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Generate a new API key
4. Copy and paste it into your `.env.local` file

### Using Custom Base URLs

The project supports OpenAI-compatible APIs (like Azure OpenAI, LocalAI, etc.). Simply set:

```env
OPENAI_BASE_URL=https://your-custom-endpoint.com/v1
```

## Installation & Running

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Visit http://localhost:3000 to access the application.

## Usage

### Generate RSS Feed

Make a GET request to:
```
http://localhost:3000/api/rss?url=https://example.com/blog
```

The API will:
1. Fetch the webpage content via Jina.ai Reader
2. Filter out headers, footers, navigation, etc.
3. Calculate content hash for caching
4. Use OpenAI to parse and generate RSS XML (or return cached version)
5. Return a valid RSS 2.0 feed

### Understanding Cache Behavior

**First request** (Cache MISS):
- Fetches content from website
- Calls LLM to generate RSS (2-5 seconds)
- Caches result for 7 days
- Returns RSS with `X-Cache-Status: MISS` header

**Subsequent requests** with same content (Cache HIT):
- Fetches content from website
- Detects matching content hash
- Returns cached RSS (<100ms)
- Returns RSS with `X-Cache-Status: HIT` header

**When content changes** (Cache MISS):
- Detects different content hash
- Generates new RSS with LLM
- Updates cache
- Returns new RSS with `X-Cache-Status: MISS` header

### Response Headers

Monitor these headers to understand caching:
- `X-Cache-Status`: `HIT` (cached) or `MISS` (newly generated)
- `X-Content-Hash`: Content hash (first 16 characters)
- `X-Model-Used`: Which GPT model was used
- `X-Content-Source`: `jina-reader-filtered`

## Content Filtering

The Jina.ai integration automatically excludes:
- Headers and footers
- Navigation menus
- Sidebars
- Advertisements
- Social sharing buttons
- Comment sections
- Related posts sections

This ensures only the main article content is analyzed for RSS generation.

## Models Used

The implementation tries these OpenAI models in order (fallback on rate limits):
1. `gpt-4o-mini` (default, cost-effective)
2. `gpt-4o` (more capable)
3. `gpt-3.5-turbo` (faster, less capable)

## Customization

### Adjust Content Filtering

Edit the `X-Remove-Selector` header in `route.ts`:

```typescript
'X-Remove-Selector': 'header, footer, nav, .your-custom-class'
```

### Target Specific Content

Uncomment the `X-Target-Selector` header in `route.ts`:

```typescript
'X-Target-Selector': 'article, main, .content'
```

This focuses extraction on specific content containers.

### Adjust Cache Duration

Edit the cache configuration in `route.ts`:

```typescript
{
    revalidate: 604800, // 7 days in seconds (customize this)
    tags: ['rss-generation'],
}
```

### Manual Cache Clearing

Restart the dev server to clear all caches, or implement a cache clearing endpoint:

```typescript
// app/api/clear-cache/route.ts
import { revalidateTag } from 'next/cache';

export async function POST() {
    revalidateTag('rss-generation');
    return new Response('Cache cleared');
}
```

## Testing

### Verify Cache is Working

```bash
# First request (should be slow, MISS)
time curl -i "http://localhost:3000/api/rss?url=https://example.com/blog"

# Second request (should be fast, HIT)
time curl -i "http://localhost:3000/api/rss?url=https://example.com/blog"
```

Check the `X-Cache-Status` header and compare response times.

### Test with RSS Reader

1. Add feed to your RSS reader:
   ```
   http://localhost:3000/api/rss?url=https://your-blog.com
   ```

2. Refresh multiple times - articles should NOT duplicate

3. Wait for website to publish new content, then refresh - new articles should appear

## Troubleshooting

**API Key Errors**: Ensure `OPENAI_API_KEY` is set in `.env.local`

**Custom Base URL Issues**: Verify the URL format ends with `/v1` or the appropriate path

**Empty/Invalid RSS**: The webpage might not have article-like content, or content filtering may be too aggressive

**Rate Limits**: The API automatically falls back to alternative models on 429 errors

**Cache Not Working**: Check response headers for `X-Cache-Status`. Restart dev server to clear cache.

**Duplicate Articles Still Appearing**: Ensure your RSS reader uses the `<guid>` field for deduplication (most modern readers do)

## Production Deployment

When deploying to production (Vercel, etc.), make sure to:
1. Set `OPENAI_API_KEY` in environment variables
2. Optionally set `OPENAI_BASE_URL`
3. Cache will work automatically with Next.js caching infrastructure
4. Monitor response headers to verify cache effectiveness
