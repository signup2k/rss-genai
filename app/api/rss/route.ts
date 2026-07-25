import { createHash } from "crypto";

import { parseExtractionMode } from "@/lib/deterministic-extractor";
import { extractFeedData } from "@/lib/feed-extractor";
import {
    enrichFullText,
    filterUnavailableArticleLinks,
    stabiliseDates,
} from "@/lib/feed-postprocessor";
import {
    fetchPageContent,
    fetchPageContentCached,
    parseMarkdownMethod,
    parseMarkdownSource,
    type MarkdownProvider,
} from "@/lib/markdown-provider";
import { resolveSelectors } from "@/lib/site-selectors";
import {
    parseTargetUrl,
    rewriteLegacyTargetUrl,
} from "@/lib/url-utils";
import { buildAtom, buildRSS, type RSSFeedData } from "@/lib/xml-builder";

const RSS_CACHE_SECONDS = 1_800;

function jsonError(
    status: number,
    error: string,
    details?: Record<string, unknown>
): Response {
    return new Response(
        JSON.stringify({ error, ...details }, null, 2),
        { status, headers: { "Content-Type": "application/json" } }
    );
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const rawTargetUrl = searchParams.get("url");
    if (!rawTargetUrl) {
        return jsonError(400, 'Missing "url" parameter', {
            usage: "/api/rss?url=https://site.com",
            parameters: {
                url: "(required) Target webpage URL",
                fulltext: "(optional) 'true' for best-effort article full text",
                limit: "(optional) Number of articles, 1-30, default 10",
                format: "(optional) 'rss' (default) or 'atom'",
                refresh: "(optional) 'true' to bypass this feed's caches",
                source: "(optional) 'auto' (default), 'jina', or 'markdown'",
                markdownMethod: "(optional) 'auto', 'ai', or 'browser'",
                extract: "(optional) 'auto' (default), 'llm', 'deterministic', or 'shadow'",
                target: "(optional) Jina target CSS selector",
                remove: "(optional) Jina removal CSS selector",
                waitfor: "(optional) Jina wait-for CSS selector",
            },
        });
    }

    let registryUrl: string;
    let targetUrl: string;
    try {
        registryUrl = parseTargetUrl(rawTargetUrl).href;
        targetUrl = rewriteLegacyTargetUrl(registryUrl);
    } catch (error) {
        return jsonError(400, "Invalid target URL", {
            message: error instanceof Error ? error.message : String(error),
        });
    }

    const fulltext = searchParams.get("fulltext") === "true";
    const limit = Math.min(
        Math.max(parseInt(searchParams.get("limit") || "10", 10) || 10, 1),
        30
    );
    const format = searchParams.get("format") === "atom" ? "atom" : "rss";
    const refresh = searchParams.get("refresh") === "true";
    const source = parseMarkdownSource(searchParams.get("source"));
    const markdownMethod = parseMarkdownMethod(
        searchParams.get("markdownMethod")
    );
    const extractionMode = parseExtractionMode(
        searchParams.get("extract") || process.env.EXTRACTION_MODE || null
    );
    const selectors = await resolveSelectors(targetUrl, {
        targetSelector: searchParams.get("target") || undefined,
        removeSelector: searchParams.get("remove") || undefined,
        waitForSelector: searchParams.get("waitfor") || undefined,
    });

    let pageContent: string;
    let contentProvider: MarkdownProvider;
    let contentFetchTime: number;
    try {
        const startTime = Date.now();
        const fetched = refresh
            ? await fetchPageContent(
                targetUrl,
                source,
                markdownMethod,
                selectors
            )
            : await fetchPageContentCached(
                targetUrl,
                source,
                markdownMethod,
                selectors.targetSelector,
                selectors.removeSelector,
                selectors.waitForSelector
            );
        pageContent = fetched.content;
        contentProvider = fetched.provider;
        contentFetchTime = Date.now() - startTime;
        console.log(
            `[Markdown] ${refresh ? "BYPASS" : "MANAGED"} `
            + `(${contentFetchTime}ms, provider=${contentProvider}) — `
            + `${pageContent.length} chars`
        );
    } catch (error) {
        console.error("[Markdown] Fetch error:", error);
        return jsonError(502, "Failed to fetch webpage content", {
            message: error instanceof Error ? error.message : String(error),
            url: targetUrl,
        });
    }

    try {
        const snapshotContext = createHash("sha256")
            .update(JSON.stringify({
                contentProvider,
                source,
                markdownMethod,
                selectors,
            }))
            .digest("hex")
            .slice(0, 12);
        const result = await extractFeedData(
            extractionMode,
            targetUrl,
            pageContent,
            limit,
            refresh,
            snapshotContext
        );
        const availableItems = await filterUnavailableArticleLinks(
            result.feedData.items,
            targetUrl,
            refresh
        );
        if (availableItems.length === 0) {
            throw new Error("All extracted article links are unavailable or invalid");
        }

        const stabilisedItems = await stabiliseDates(
            registryUrl,
            targetUrl,
            availableItems
        );
        const outputItems = fulltext
            ? await enrichFullText(
                stabilisedItems,
                source,
                markdownMethod,
                selectors.removeSelector,
                refresh
            )
            : stabilisedItems;
        const feed: RSSFeedData = {
            channel: result.feedData.channel,
            items: outputItems,
        };
        const xml = format === "atom" ? buildAtom(feed) : buildRSS(feed);
        const contentType = format === "atom"
            ? "application/atom+xml; charset=utf-8"
            : "application/xml; charset=utf-8";

        return new Response(xml, {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": refresh
                    ? "no-store"
                    : `s-maxage=${RSS_CACHE_SECONDS}, stale-while-revalidate=${RSS_CACHE_SECONDS}`,
                "X-Model-Used": result.modelUsed,
                "X-Extraction-Mode": extractionMode,
                "X-Extraction-Strategy": result.strategy,
                "X-Deterministic-Confidence":
                    `${result.deterministicConfidence}`,
                "X-Extraction-Adapter": result.adapter || "none",
                "X-Content-Source": contentProvider === "jina"
                    ? "jina-reader-filtered"
                    : "markdown.new",
                "X-Markdown-Source": contentProvider,
                "X-Markdown-Method": contentProvider === "markdown"
                    ? markdownMethod
                    : "n/a",
                "X-RSS-Cache-Status": result.strategy === "snapshot"
                    ? "SNAPSHOT"
                    : (refresh ? "BYPASS" : "MANAGED"),
                "X-Markdown-Cache-Status": refresh ? "BYPASS" : "MANAGED",
                "X-Markdown-Fetch-Time": `${contentFetchTime}ms`,
                "X-Article-Count": `${outputItems.length}`,
                "X-Feed-Format": format,
                "X-Fulltext": fulltext ? "true" : "false",
                "X-Fulltext-Count":
                    `${outputItems.filter((item) => item.content).length}`,
                "X-Target-Rewritten": targetUrl === registryUrl
                    ? "false"
                    : "true",
            },
        });
    } catch (error: unknown) {
        console.error("RSS generation error:", error);
        return jsonError(500, "Failed to generate feed", {
            message: error instanceof Error ? error.message : String(error),
            status: (error as { status?: number })?.status || "unknown",
        });
    }
}
