// File: app/api/rss/status/route.ts
//
// Returns the health/status of a tracked feed.
// Usage: /api/rss/status?url=https://blog.com
//
// Useful for debugging when your RSS reader shows unexpected behavior.

import { loadRegistry } from "@/lib/storage";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get("url");

    if (!targetUrl) {
        return new Response(
            JSON.stringify({
                error: 'Missing "url" parameter',
                usage: "/api/rss/status?url=https://site.com",
            }, null, 2),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const registry = await loadRegistry(targetUrl);
    const articles = Object.values(registry);

    if (articles.length === 0) {
        return new Response(
            JSON.stringify({
                url: targetUrl,
                status: "no_data",
                message: "No articles tracked for this URL. Generate a feed first with /api/rss?url=...",
            }, null, 2),
            { headers: { "Content-Type": "application/json" } }
        );
    }

    // Sort by firstSeen descending
    articles.sort((a, b) => new Date(b.firstSeenISO).getTime() - new Date(a.firstSeenISO).getTime());

    // Calculate stats
    const firstSeenDates = articles.map((a) => new Date(a.firstSeenISO).getTime());
    const pubDates = articles
        .filter((a) => a.pubDate && a.pubDate !== "NO_DATE_FOUND")
        .map((a) => new Date(a.pubDate).getTime())
        .filter((d) => !isNaN(d));

    const newestFirstSeen = new Date(Math.max(...firstSeenDates)).toISOString();
    const oldestFirstSeen = new Date(Math.min(...firstSeenDates)).toISOString();
    const newestPubDate = pubDates.length > 0 ? new Date(Math.max(...pubDates)).toUTCString() : null;
    const oldestPubDate = pubDates.length > 0 ? new Date(Math.min(...pubDates)).toUTCString() : null;

    return new Response(
        JSON.stringify({
            url: targetUrl,
            status: "active",
            trackedArticles: articles.length,
            newestFirstSeen,
            oldestFirstSeen,
            newestPubDate,
            oldestPubDate,
            recentArticles: articles.slice(0, 5).map((a) => ({
                title: a.title || "(untitled)",
                guid: a.guid,
                pubDate: a.pubDate,
                firstSeen: a.firstSeenISO,
            })),
        }, null, 2),
        { headers: { "Content-Type": "application/json" } }
    );
}
