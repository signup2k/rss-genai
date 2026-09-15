import { generateFeed } from "@/lib/feed-service";
import { getRule } from "@/lib/rule-registry";
import { canonicalArticleUrl } from "@/lib/url-utils";
import { buildAtom, buildRSS, type RSSFeedData, type RSSItem } from "@/lib/xml-builder";

export async function GET(request: Request) {
    const url = new URL(request.url);
    const ids = [...new Set([
        ...url.searchParams.getAll("id"),
        ...(url.searchParams.get("ids") || "").split(","),
    ].map((id) => id.trim()).filter(Boolean))];
    if (ids.length < 2 || ids.length > 10) {
        return Response.json({
            error: "Provide 2-10 registered rule ids",
            usage: "/api/rss/merge?id=first-rule&id=second-rule",
        }, { status: 400 });
    }

    const rules = ids.map((id) => getRule(id));
    const unknown = ids.filter((_, index) => !rules[index]);
    if (unknown.length) return Response.json({ error: "Unknown feed rules", ids: unknown }, { status: 404 });

    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 10, 1), 30);
    const fulltext = url.searchParams.get("fulltext") === "true";
    const results = await Promise.allSettled(
        rules.map((rule) => generateFeed(rule!, limit, fulltext))
    );

    const unique = new Map<string, RSSItem>();
    for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const item of result.value.items) {
            const identity = canonicalArticleUrl(item.link);
            if (!unique.has(identity)) unique.set(identity, item);
        }
    }
    const items = [...unique.values()].sort((left, right) => {
        const a = new Date(left.pubDate).getTime();
        const b = new Date(right.pubDate).getTime();
        return (Number.isNaN(b) ? 0 : b) - (Number.isNaN(a) ? 0 : a);
    });
    const failures = results.filter((result) => result.status === "rejected").length;
    if (!items.length) return Response.json({ error: "All feed rules failed", failures }, { status: 502 });

    const format = url.searchParams.get("format") === "atom" ? "atom" : "rss";
    const feed: RSSFeedData = {
        channel: {
            title: url.searchParams.get("title") || `Merged feed: ${ids.join(" + ")}`,
            link: url.origin,
            description: `Combined feed from ${ids.length} registered rules`,
        },
        items,
    };
    return new Response(format === "atom" ? buildAtom(feed) : buildRSS(feed), {
        headers: {
            "Content-Type": format === "atom" ? "application/atom+xml; charset=utf-8" : "application/rss+xml; charset=utf-8",
            "Cache-Control": "s-maxage=1800, stale-while-revalidate=1800",
            "X-Feed-Rules": ids.join(","),
            "X-Errors-Count": String(failures),
        },
    });
}
