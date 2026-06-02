This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## API Reference

### `/api/rss`

Generates an RSS or Atom feed from a specified webpage.

**Query Parameters:**
- `url` (required): The target webpage URL.
- `fulltext` (optional): Set to `true` to include full article content instead of just a summary.
- `limit` (optional): Maximum number of articles to extract (1-30, default: 10).
- `format` (optional): `rss` (default) or `atom`.
- `refresh` (optional): Set to `true` to force cache invalidation and regenerate the feed.

#### Jina.ai CSS Selector Parameters

This project uses Jina.ai to fetch and parse web pages. You can control the extraction process by providing CSS selectors. These overrides take precedence over predefined site rules in `lib/site-selectors.ts`.

- `target` (optional): CSS selector for exact content to extract (`X-Target-Selector`).
- `remove` (optional): CSS selector for elements to remove, such as ads or navbars (`X-Remove-Selector`).
- `waitfor` (optional): CSS selector to wait for before extraction, useful for dynamic content (`X-Wait-For-Selector`).

**Example:**
```bash
curl "http://localhost:3000/api/rss?url=https://example.com/blog&target=article.content&remove=.ads,.nav"
```

### `/api/rss/merge`

Aggregates multiple RSS feeds into a single combined feed.

**Query Parameters:**
- `urls` (required): Comma-separated list of target webpage URLs.
- `title` (optional): Custom title for the aggregated feed.
- `limit` (optional): Maximum articles per source.
- `fulltext` (optional): Set to `true` for full article content.
- `format` (optional): `rss` (default) or `atom`.
