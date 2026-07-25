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
//   source    (optional) — "auto" (default), "jina", or "markdown"
//   markdownMethod (optional) — markdown.new method: "auto" (default), "ai", or "browser"
//   extract   (optional) — "auto" (default), "llm", "deterministic", or "shadow"

import { buildRSS, buildAtom, type RSSFeedData, type RSSItem } from "@/lib/xml-builder";
import { canonicalArticleUrl } from "@/lib/url-utils";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    const repeatedUrls = searchParams.getAll("url").map((url) => url.trim()).filter(Boolean);
    const urlsParam = searchParams.get("urls");
    if (repeatedUrls.length === 0 && !urlsParam) {
        return new Response(
            JSON.stringify({
                error: 'Missing "urls" parameter',
                usage: "/api/rss/merge?urls=https://site1.com,https://site2.com",
                parameters: {
                    urls: "(required) Repeated url= parameters, or comma-separated urls= values",
                    title: "(optional) Custom feed title",
                    limit: "(optional) Articles per source, 1-30, default 10",
                    fulltext: "(optional) 'true' for full article content",
                    format: "(optional) 'rss' (default) or 'atom'",
                    source: "(optional) 'auto' (default), 'jina', or 'markdown'",
                    markdownMethod: "(optional) markdown.new method: 'auto' (default), 'ai', or 'browser'",
                    extract: "(optional) 'auto' (default), 'llm', 'deterministic', or 'shadow'",
                },
            }, null, 2),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const requestedUrls = repeatedUrls.length > 0
        ? repeatedUrls
        : (urlsParam || "").split(",").map((u) => u.trim()).filter(Boolean);
    const urls = [...new Set(requestedUrls)];
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
    const source = searchParams.get("source");
    const markdownMethod = searchParams.get("markdownMethod");
    const extract = searchParams.get("extract");

    // Build the internal API URL base (same origin)
    const origin = new URL(request.url).origin;

    // Fetch all feeds in parallel
    const results = await Promise.allSettled(
        urls.map(async (url) => {
            const params = new URLSearchParams({
                url,
                limit: String(limit),
                ...(fulltext ? { fulltext: "true" } : {}),
                ...(source ? { source } : {}),
                ...(markdownMethod ? { markdownMethod } : {}),
                ...(extract ? { extract } : {}),
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
    const sourceLinks: string[] = [];

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
            const content = block
                .match(/<content:encoded>([\s\S]*?)<\/content:encoded>/)?.[1]
                ?.trim()
                .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1");

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
        const channelLink = xml.match(
            /<channel>[\s\S]*?<link>([\s\S]*?)<\/link>/
        )?.[1]?.trim();
        if (channelLink) sourceLinks.push(unescapeXml(channelLink));
    }

    if (allItems.length === 0 && errors.length > 0) {
        return new Response(
            JSON.stringify({ error: "All source feeds failed", details: errors }, null, 2),
            { status: 502, headers: { "Content-Type": "application/json" } }
        );
    }

    const uniqueItems = new Map<string, RSSItem & { sourceUrl: string }>();
    for (const item of allItems) {
        const identity = canonicalArticleUrl(item.link);
        if (!uniqueItems.has(identity)) {
            uniqueItems.set(identity, item);
        }
    }
    allItems.splice(0, allItems.length, ...uniqueItems.values());

    // Sort all items by date (newest first)
    allItems.sort((a, b) => {
        const dateA = a.pubDate ? new Date(a.pubDate).getTime() : 0;
        const dateB = b.pubDate ? new Date(b.pubDate).getTime() : 0;
        const safeDateA = Number.isNaN(dateA) ? 0 : dateA;
        const safeDateB = Number.isNaN(dateB) ? 0 : dateB;
        return safeDateB - safeDateA;
    });

    // Build the aggregated feed
    const feedTitle = customTitle || `Merged Feed: ${sourceNames.join(" + ") || "Multiple Sources"}`;
    const feed: RSSFeedData = {
        channel: {
            title: feedTitle,
            link: sourceLinks[0] || urls[0] || "",
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
            "Cache-Control": "s-maxage=1800, stale-while-revalidate=1800",
            "X-Sources-Count": `${urls.length}`,
            "X-Articles-Count": `${allItems.length}`,
            "X-Errors-Count": `${errors.length}`,
        },
    });
}

/** Unescape XML entities back to plain text (since we re-escape in the builder) */
function unescapeXml(str: string): string {
    const entities: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
    };
    return str.replace(
        /&(amp|lt|gt|quot|apos);/g,
        (entity) => entities[entity] || entity
    );
}
