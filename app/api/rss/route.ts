import { getRule } from "@/lib/rule-registry";
import { generateFeed } from "@/lib/feed-service";
import { buildAtom, buildRSS } from "@/lib/xml-builder";

const RSS_CACHE_SECONDS = 1_800;

function errorResponse(status: number, error: string, details?: Record<string, unknown>) {
    return Response.json({ error, ...details }, { status });
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();
    if (!id) {
        return errorResponse(400, 'Missing "id" parameter', {
            usage: "/api/rss?id=registered-rule-id",
        });
    }

    const rule = getRule(id);
    if (!rule) {
        return errorResponse(404, "Unknown feed rule", { id, rulesEndpoint: "/api/rules" });
    }

    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 10, 1), 30);
    const format = searchParams.get("format") === "atom" ? "atom" : "rss";
    const fulltext = searchParams.get("fulltext") === "true";

    try {
        const startedAt = Date.now();
        const feed = await generateFeed(rule, limit, fulltext);

        const xml = format === "atom" ? buildAtom(feed) : buildRSS(feed);
        return new Response(xml, {
            headers: {
                "Content-Type": format === "atom"
                    ? "application/atom+xml; charset=utf-8"
                    : "application/rss+xml; charset=utf-8",
                "Cache-Control": `s-maxage=${RSS_CACHE_SECONDS}, stale-while-revalidate=${RSS_CACHE_SECONDS}`,
                "X-Feed-Rule": rule.id,
                "X-Rule-Version": String(rule.version),
                "X-Extraction-Strategy": "css-rule",
                "X-Article-Count": String(feed.items.length),
                "X-Fetch-Time": `${Date.now() - startedAt}ms`,
            },
        });
    } catch (error) {
        console.error(`[Rule:${rule.id}] Feed generation failed`, error);
        return errorResponse(502, "Feed rule execution failed", {
            id: rule.id,
            message: error instanceof Error ? error.message : String(error),
        });
    }
}
