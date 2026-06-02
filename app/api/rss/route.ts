// File: app/api/rss/route.ts
//
// Generates RSS/Atom feeds from any webpage using:
//   - Jina.ai Reader: fetches & converts webpages to markdown
//   - OpenAI-compatible LLM: parses content into structured JSON
//   - Programmatic XML builder: generates well-formed RSS/Atom XML
//   - Persistent registry (Upstash Redis on Vercel, file-system locally):
//     prevents date drift & duplicate articles across regenerations
//
// Query parameters:
//   url       (required) — target webpage URL
//   fulltext  (optional) — "true" to include full article content
//   limit     (optional) — number of articles to extract (1-30, default 10)
//   format    (optional) — "rss" (default) or "atom"
//   refresh   (optional) — "true" to force regeneration, bypassing cache

import OpenAI from "openai";
import { unstable_cache, revalidateTag } from "next/cache";
import { loadRegistry, saveRegistry } from "@/lib/storage";
import { buildRSS, buildAtom, type RSSFeedData, type RSSItem } from "@/lib/xml-builder";
import { resolveSelectors, type SiteSelectors } from "@/lib/site-selectors";

// --- OpenAI client (lazy-initialized to avoid build-time errors) ---

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
    if (!_openai) {
        _openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.OPENAI_BASE_URL || undefined,
        });
    }
    return _openai;
}

// --- Model configuration ---
// Supports OPENAI_MODEL env var for single model, or falls back to a chain.

function getModels(): string[] {
    if (process.env.OPENAI_MODEL) {
        return [process.env.OPENAI_MODEL];
    }
    return ["gpt-5.4-mini", "gpt-4o-mini", "gpt-4o"];
}

// --- Jina Reader ---

async function fetchWithJina(url: string, selectors: SiteSelectors): Promise<string> {
    const jinaUrl = `https://r.jina.ai/${url}`;
    
    const headers: Record<string, string> = {
        "Accept": "text/markdown",
    };

    if (selectors.targetSelector) {
        headers["X-Target-Selector"] = selectors.targetSelector;
    }
    
    if (selectors.removeSelector) {
        headers["X-Remove-Selector"] = selectors.removeSelector;
    }

    if (selectors.waitForSelector) {
        headers["X-Wait-For-Selector"] = selectors.waitForSelector;
    }

    const response = await fetch(jinaUrl, {
        headers,
    });

    if (!response.ok) {
        throw new Error(`Jina Reader failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
}

const fetchWithJinaCache = unstable_cache(
    async (url: string, targetSelector?: string, removeSelector?: string, waitForSelector?: string) => {
        console.log(`[Jina] Fetching fresh content for: ${url}`);
        return fetchWithJina(url, { targetSelector, removeSelector, waitForSelector });
    },
    ["jina-fetch"],
    {
        revalidate: 86400, // 24 hours
        tags: ["jina-fetch"],
    }
);

// --- LLM: Structured JSON output ---
// Instead of asking the LLM to produce raw XML (fragile, escaping issues),
// we ask it to produce structured JSON which we then serialise to XML.

function buildSystemPrompt(limit: number, fulltext: boolean): string {
    const contentInstruction = fulltext
        ? `   * "description": Brief summary (1-2 sentences)
   * "content": The FULL article text content (preserve paragraphs, keep it readable)`
        : `   * "description": Brief summary (1-2 sentences)`;

    return `You are an RSS feed data extractor. Parse the provided webpage content and output structured JSON.

OUTPUT FORMAT — respond with ONLY a JSON object, no markdown, no explanation:
{
  "channel": {
    "title": "Feed title",
    "link": "https://website-url.com",
    "description": "Brief feed description"
  },
  "items": [
    {
      "title": "Article title (exact text from source)",
      "link": "https://absolute-url-to-article",
${contentInstruction}
      "pubDate": "Publication date in RFC 822 format (e.g. Fri, 27 Dec 2024 00:00:00 GMT)",
      "categories": ["tag1", "tag2"]
    }
  ]
}

RULES:
1. Extract up to ${limit} recent articles/posts
2. All URLs must be absolute (include https://domain.com prefix)
3. Only include actual articles/posts, not navigation, ads, or other page elements
4. DATES: Extract the ACTUAL publication date from the page content. Look for date patterns near article titles, bylines, or metadata. If you absolutely cannot find any date, use "NO_DATE_FOUND" — do NOT invent or guess a date.
5. Categories: extract tags, labels, or topic categories if visible. Use an empty array [] if none found.
6. Output ONLY the JSON object. No markdown code blocks, no explanation.`;
}

interface LLMResult {
    feedData: RSSFeedData;
    modelUsed: string;
}

const generateFeedData = unstable_cache(
    async (targetUrl: string, pageContent: string, limit: number, fulltext: boolean): Promise<LLMResult> => {
        const models = getModels();
        const systemPrompt = buildSystemPrompt(limit, fulltext);

        let lastError: unknown = null;

        for (const modelId of models) {
            try {
                console.log(`[RSS-Gen] Trying model: ${modelId} for ${targetUrl}`);
                const response = await getOpenAI().chat.completions.create({
                    model: modelId,
                    messages: [
                        { role: "system", content: systemPrompt },
                        {
                            role: "user",
                            content: `Parse this webpage content from ${targetUrl} and extract article data:\n\n${pageContent}`,
                        },
                    ],
                    temperature: 0,
                    max_tokens: 8192,
                    seed: 42,
                    response_format: { type: "json_object" },
                });

                const raw = response.choices[0]?.message?.content || "";
                // Strip any markdown code fences (just in case)
                const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();

                let parsed: RSSFeedData;
                try {
                    parsed = JSON.parse(cleaned) as RSSFeedData;
                } catch (parseErr) {
                    console.log(`[RSS-Gen] JSON parse failed for ${modelId}:`, parseErr);
                    lastError = new Error("LLM output is not valid JSON");
                    continue;
                }

                // Validate structure
                if (!parsed.channel?.title || !Array.isArray(parsed.items) || parsed.items.length === 0) {
                    console.log(`[RSS-Gen] Invalid feed structure from ${modelId}`);
                    lastError = new Error("LLM output missing required fields");
                    continue;
                }

                // Normalise items: ensure guid = link if not provided
                for (const item of parsed.items) {
                    if (!item.guid) item.guid = item.link;
                }

                console.log(`[RSS-Gen] Successfully extracted ${parsed.items.length} articles with ${modelId}`);
                return { feedData: parsed, modelUsed: modelId };
            } catch (error: unknown) {
                lastError = error;
                const statusCode = (error as { status?: number })?.status;
                if (statusCode === 429 || statusCode === 503) {
                    console.log(`Model ${modelId} rate-limited (${statusCode}), trying next...`);
                    continue;
                }
                // For other errors, don't try the next model
                break;
            }
        }

        throw lastError || new Error("All models failed to generate feed data");
    },
    ["rss-generation-v3"],
    {
        revalidate: 86400, // 24 hours
        tags: ["rss-generation"],
    }
);

// --- Date stabilisation ---
// After LLM extracts article data, we reconcile every item against the
// persistent registry so that:
//   1. Articles seen before keep their original pubDate (no date drift).
//   2. Articles with "NO_DATE_FOUND" get the date they were first seen.
//   3. Truly new articles get their LLM-extracted date (or first-seen date).

async function stabiliseDates(targetUrl: string, items: RSSItem[]): Promise<RSSItem[]> {
    const registry = await loadRegistry(targetUrl);
    const nowRFC822 = new Date().toUTCString();
    let newArticles = 0;
    let reusedDates = 0;

    const stabilised: RSSItem[] = items.map((item) => {
        const guid = item.guid || item.link;
        if (!guid) return item;

        const existing = registry[guid];

        if (existing) {
            // Article already known — always use the ORIGINAL date we stored
            reusedDates++;
            return { ...item, pubDate: existing.pubDate };
        } else {
            // New article — determine its date
            let dateToStore: string;
            if (item.pubDate && item.pubDate !== "NO_DATE_FOUND") {
                dateToStore = item.pubDate;
            } else {
                dateToStore = nowRFC822;
            }

            registry[guid] = {
                guid,
                pubDate: dateToStore,
                firstSeenISO: new Date().toISOString(),
                title: item.title,
            };
            newArticles++;

            return { ...item, pubDate: dateToStore };
        }
    });

    await saveRegistry(targetUrl, registry);
    console.log(
        `[DateStab] ${targetUrl}: ${newArticles} new, ${reusedDates} dates reused, ${Object.keys(registry).length} total tracked`
    );

    return stabilised;
}

// --- Route Handler ---

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    // --- Parse query parameters ---
    const targetUrl = searchParams.get("url");
    if (!targetUrl) {
        return new Response(
            JSON.stringify({
                error: 'Missing "url" parameter',
                usage: "/api/rss?url=https://site.com",
                parameters: {
                    url: "(required) Target webpage URL",
                    fulltext: "(optional) 'true' for full article content",
                    limit: "(optional) Number of articles, 1-30, default 10",
                    format: "(optional) 'rss' (default) or 'atom'",
                    refresh: "(optional) 'true' to force regeneration",
                    target: "(optional) CSS selector for exact content to extract",
                    remove: "(optional) CSS selector for elements to remove",
                    waitfor: "(optional) CSS selector to wait for before extraction",
                },
            }, null, 2),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const fulltext = searchParams.get("fulltext") === "true";
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10", 10) || 10, 1), 30);
    const format = searchParams.get("format") === "atom" ? "atom" : "rss";
    const refresh = searchParams.get("refresh") === "true";

    const apiSelectors = {
        targetSelector: searchParams.get("target") || undefined,
        removeSelector: searchParams.get("remove") || undefined,
        waitForSelector: searchParams.get("waitfor") || undefined,
    };
    const selectors = await resolveSelectors(targetUrl, apiSelectors);

    // --- Force cache invalidation if requested ---
    if (refresh) {
        console.log(`[API] Force refresh requested for: ${targetUrl}`);
        revalidateTag("rss-generation", { expire: 0 });
        revalidateTag("jina-fetch", { expire: 0 });
    }

    // --- Step 1: Fetch webpage content via Jina Reader (cached 24h) ---
    let pageContent: string;
    let jinaFetchTime: number;
    try {
        console.log(`[API] Request for: ${targetUrl} (limit=${limit}, fulltext=${fulltext}, format=${format})`);
        const startTime = Date.now();
        pageContent = await fetchWithJinaCache(
            targetUrl,
            selectors.targetSelector,
            selectors.removeSelector,
            selectors.waitForSelector
        );
        jinaFetchTime = Date.now() - startTime;
        console.log(`[Jina] ${jinaFetchTime < 100 ? "Cache HIT" : "Cache MISS"} (${jinaFetchTime}ms) — ${pageContent.length} chars`);
    } catch (error) {
        console.error("[Jina] Fetch error:", error);
        return new Response(
            JSON.stringify({
                error: "Failed to fetch webpage content",
                message: error instanceof Error ? error.message : String(error),
                url: targetUrl,
            }, null, 2),
            { status: 502, headers: { "Content-Type": "application/json" } }
        );
    }

    // --- Step 2: Extract feed data via LLM (cached 24h) ---
    let cacheStatus = "MISS";
    try {
        const startTime = Date.now();
        const result = await generateFeedData(targetUrl, pageContent, limit, fulltext);
        const duration = Date.now() - startTime;
        cacheStatus = duration < 100 ? "HIT" : "MISS";
        console.log(`[RSS] ${cacheStatus} (${duration}ms) — ${result.feedData.items.length} articles`);

        // --- Step 3: Stabilise dates against persistent registry ---
        const stabilisedItems = await stabiliseDates(targetUrl, result.feedData.items);
        const stabilisedFeed: RSSFeedData = {
            channel: result.feedData.channel,
            items: stabilisedItems,
        };

        // --- Step 4: Build XML ---
        const xml = format === "atom" ? buildAtom(stabilisedFeed) : buildRSS(stabilisedFeed);
        const contentType = format === "atom"
            ? "application/atom+xml; charset=utf-8"
            : "application/xml; charset=utf-8";

        return new Response(xml, {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "s-maxage=86400, stale-while-revalidate=86400",
                "X-Model-Used": result.modelUsed,
                "X-Content-Source": "jina-reader-filtered",
                "X-RSS-Cache-Status": cacheStatus,
                "X-Jina-Cache-Status": jinaFetchTime < 100 ? "HIT" : "MISS",
                "X-Jina-Fetch-Time": `${jinaFetchTime}ms`,
                "X-Article-Count": `${stabilisedItems.length}`,
                "X-Feed-Format": format,
                "X-Fulltext": fulltext ? "true" : "false",
            },
        });
    } catch (error: unknown) {
        console.error("RSS generation error:", error);
        return new Response(
            JSON.stringify({
                error: "Failed to generate feed",
                message: error instanceof Error ? error.message : String(error),
                status: (error as { status?: number })?.status || "unknown",
            }, null, 2),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}