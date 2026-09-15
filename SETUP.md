# Setup

Requires Node.js 20 or newer. No model API key or external content-conversion
service is required.

```bash
npm install
npm run dev
```

## Optional persistence

Without Redis, local development stores first-seen article dates under
`.rss-cache/`. A Vercel filesystem is ephemeral, so production should configure
`KV_REST_API_URL` and `KV_REST_API_TOKEN`. The native
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` names also work.

## Deployment

1. Add harness-tested rules to `rules/index.ts`.
2. Run `npm run check`.
3. Deploy the repository.
4. Confirm `/api/rules` contains the expected IDs.
5. Request each feed once and inspect `/api/rss/status?id=...`.

Production clients select a registered rule ID. They cannot send a target URL
or selector, so unreviewed websites are never fetched.
