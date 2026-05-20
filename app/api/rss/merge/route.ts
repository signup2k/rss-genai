// File: app/api/rss/merge/route.ts
//
// Aggregates multiple RSS feeds into a single combined feed.
// Usage: /api/rss/merge?urls=https://blog1.com,https://blog2.com&title=My+Feed
//
// Query parameters:
//   urls      (required) — comma-separated list of target webpage URLs
//   title     (optional) — custom title for the aggregated feed
//   limit     (optional) — max articles per source (1-30, default 10)
//   fulltext  (optional) — "true" to include full article content
//   format    (optional) — "rss" (default) or "atom"

import { buildRSS, buildAtom, type RSSFeedData, type RSSItem } from "@/lib/xml-builder";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    const urlsParam = searchParams.get("urls");
    if (!urlsParam) {
        return new Response(
            JSON.stringify({
                error: 'Missing "urls" parameter',
                usage: "/api/rss/merge?urls=https://site1.com,https://site2.com",
                parameters: {
                    urls: "(required) Comma-separated target webpage URLs",
                    title: "(optional) Custom feed title",
                    limit: "(optional) Articles per source, 1-30, default 10",
                    fulltext: "(optional) 'true' for full article content",
                    format: "(optional) 'rss' (default) or 'atom'",
                },
            }, null, 2),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const urls = urlsParam.split(",").map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) {
        return new Response(JSON.stringify({ error: "No valid URLs provided" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    if (urls.length > 10) {
        return new Response(JSON.stringify({ error: "Maximum 10 URLs allowed per merge" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const customTitle = searchParams.get("title");
    const fulltext = searchParams.get("fulltext") === "true";
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10", 10) || 10, 1), 30);
    const format = searchParams.get("format") === "atom" ? "atom" : "rss";

    // Build the internal API URL base (same origin)
    const origin = new URL(request.url).origin;

    // Fetch all feeds in parallel
    const results = await Promise.allSettled(
        urls.map(async (url) => {
            const params = new URLSearchParams({
                url,
                limit: String(limit),
                ...(fulltext ? { fulltext: "true" } : {}),
                format: "rss", // always fetch as RSS internally for parsing
            });

            const res = await fetch(`${origin}/api/rss?${params}`);
            if (!res.ok) {
                throw new Error(`Failed for ${url}: ${res.status}`);
            }

            const xml = await res.text();
            return { url, xml };
        })
    );

    // Collect all items from all feeds
    const allItems: Array<RSSItem & { sourceUrl: string }> = [];
    const errors: string[] = [];
    const sourceNames: string[] = [];

    for (const result of results) {
        if (result.status === "rejected") {
            errors.push(String(result.reason));
            continue;
        }

        const { url, xml } = result.value;

        // Quick & simple: extract items from RSS XML using regex
        // (We control the XML format since we generated it, so this is safe)
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        while ((match = itemRegex.exec(xml)) !== null) {
            const block = match[1];
            const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "";
            const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "";
            const guid = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1]?.trim() ?? link;
            const description = block.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.trim() ?? "";
            const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";

            // Extract categories
            const categories: string[] = [];
            const catRegex = /<category>([\s\S]*?)<\/category>/g;
            let catMatch;
            while ((catMatch = catRegex.exec(block)) !== null) {
                categories.push(catMatch[1].trim());
            }

            // Extract content:encoded if present
            const content = block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/)?.[1]?.trim();

            allItems.push({
                title: unescapeXml(title),
                link: unescapeXml(link),
                guid: unescapeXml(guid),
                description: unescapeXml(description),
                pubDate: unescapeXml(pubDate),
                categories: categories.map(unescapeXml),
                content: content ? content : undefined,
                sourceUrl: url,
            });
        }

        // Extract channel title for naming
        const channelTitle = xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
        if (channelTitle) sourceNames.push(unescapeXml(channelTitle));
    }

    // Sort all items by date (newest first)
    allItems.sort((a, b) => {
        const dateA = a.pubDate ? new Date(a.pubDate).getTime() : 0;
        const dateB = b.pubDate ? new Date(b.pubDate).getTime() : 0;
        return dateB - dateA;
    });

    // Build the aggregated feed
    const feedTitle = customTitle || `Merged Feed: ${sourceNames.join(" + ") || "Multiple Sources"}`;
    const feed: RSSFeedData = {
        channel: {
            title: feedTitle,
            link: urls[0] || "",
            description: `Aggregated feed from ${urls.length} sources`,
        },
        items: allItems,
    };

    const xml = format === "atom" ? buildAtom(feed) : buildRSS(feed);
    const contentType = format === "atom"
        ? "application/atom+xml; charset=utf-8"
        : "application/xml; charset=utf-8";

    return new Response(xml, {
        headers: {
            "Content-Type": contentType,
            "Cache-Control": "s-maxage=86400, stale-while-revalidate=86400",
            "X-Sources-Count": `${urls.length}`,
            "X-Articles-Count": `${allItems.length}`,
            "X-Errors": errors.length > 0 ? errors.join("; ") : "none",
        },
    });
}

/** Unescape XML entities back to plain text (since we re-escape in the builder) */
function unescapeXml(str: string): string {
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}
