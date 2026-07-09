// File: app/api/rss/route.ts
//
// Generates RSS/Atom feeds from any webpage using:
//   - Jina.ai Reader / markdown.new: fetches & converts webpages to markdown
//   - Deterministic Markdown parser with an OpenAI-compatible LLM fallback
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
//   source    (optional) — "auto" (default), "jina", or "markdown"

import OpenAI from "openai";
import { unstable_cache } from "next/cache";
import {
    loadFeedSnapshot,
    loadRegistry,
    saveFeedSnapshot,
    saveRegistry,
} from "@/lib/storage";
import { buildRSS, buildAtom, type RSSFeedData, type RSSItem } from "@/lib/xml-builder";
import { resolveSelectors, type SiteSelectors } from "@/lib/site-selectors";
import {
    extractFeedDeterministically,
    parseExtractionMode,
    type ExtractionMode,
} from "@/lib/deterministic-extractor";
import {
    buildCandidatePrompt,
    extractArticleCandidates,
    normalizeMarkdownPayload,
} from "@/lib/candidate-extractor";

// --- OpenAI-compatible client (lazy-initialized to avoid build-time errors) ---

const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com";
const DEFAULT_LLM_MODEL = "deepseek-v4-flash";
const MAX_PAGE_CONTENT_CHARS = 100_000;

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
    if (!_openai) {
        _openai = new OpenAI({
            apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
            baseURL: process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_LLM_BASE_URL,
        });
    }
    return _openai;
}

// --- Model configuration ---
// Supports DEEPSEEK_MODEL / OPENAI_MODEL env vars for overrides.

function getModels(): string[] {
    const model = process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL;
    if (model) {
        return [model];
    }
    return [DEFAULT_LLM_MODEL];
}

// --- Markdown fetchers ---

type MarkdownSource = "auto" | "jina" | "markdown";
type MarkdownProvider = "jina" | "markdown";
type MarkdownMethod = "auto" | "ai" | "browser";

interface PageFetchResult {
    content: string;
    provider: MarkdownProvider;
}

function parseMarkdownSource(value: string | null): MarkdownSource {
    if (value === "jina" || value === "markdown") {
        return value;
    }
    return "auto";
}

function parseMarkdownMethod(value: string | null): MarkdownMethod {
    if (value === "ai" || value === "browser") {
        return value;
    }
    return "auto";
}

async function fetchWithJina(url: string, selectors: SiteSelectors): Promise<string> {
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

    const endpoints = [
        `https://r.jina.ai/${url}`,
        `https://r.jinaai.cn/${url.replace(/^https?:\/\//, "")}`,
    ];
    let lastError: unknown;
    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, { headers });
            if (response.ok) return response.text();
            lastError = new Error(`Jina Reader failed: ${response.status} ${response.statusText}`);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("All Jina Reader endpoints failed");
}

async function fetchWithMarkdownNew(url: string, method: MarkdownMethod): Promise<string> {
    const response = await fetch("https://markdown.new/", {
        method: "POST",
        headers: {
            "Accept": "text/markdown",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            url,
            method,
        }),
    });

    if (!response.ok) {
        throw new Error(`markdown.new failed: ${response.status} ${response.statusText}`);
    }

    return normalizeMarkdownPayload(await response.text());
}

async function fetchPageContent(
    url: string,
    source: MarkdownSource,
    markdownMethod: MarkdownMethod,
    selectors: SiteSelectors
): Promise<PageFetchResult> {
    if (source === "markdown") {
        console.log(`[markdown.new] Fetching fresh content for: ${url} (method=${markdownMethod})`);
        return {
            content: await fetchWithMarkdownNew(url, markdownMethod),
            provider: "markdown",
        };
    }

    if (source === "jina") {
        console.log(`[Jina] Fetching fresh content for: ${url}`);
        return {
            content: await fetchWithJina(url, selectors),
            provider: "jina",
        };
    }

    try {
        console.log(`[Jina] Fetching fresh content for: ${url}`);
        return {
            content: await fetchWithJina(url, selectors),
            provider: "jina",
        };
    } catch (error) {
        console.warn(`[Jina] Failed, falling back to markdown.new for ${url}:`, error);
        return {
            content: await fetchWithMarkdownNew(url, markdownMethod),
            provider: "markdown",
        };
    }
}

const fetchPageContentCache = unstable_cache(
    async (
        url: string,
        source: MarkdownSource,
        markdownMethod: MarkdownMethod,
        targetSelector?: string,
        removeSelector?: string,
        waitForSelector?: string
    ) => {
        return fetchPageContent(url, source, markdownMethod, { targetSelector, removeSelector, waitForSelector });
    },
    ["markdown-fetch-v2"],
    {
        revalidate: 86400, // 24 hours
        tags: ["markdown-fetch"],
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

    return `You are an RSS feed data extractor. Parse the provided webpage content and output structured JSON (valid json).

OUTPUT FORMAT — respond with ONLY a JSON object (valid json), no markdown, no explanation:
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
6. Output ONLY the JSON object as valid json. No markdown code blocks, no explanation.`;
}

interface LLMResult {
    feedData: RSSFeedData;
    modelUsed: string;
}

interface ExtractionResult extends LLMResult {
    strategy: "llm" | "deterministic" | "incremental-llm" | "snapshot";
    deterministicConfidence: number;
    adapter: string;
}

function trimPageContent(pageContent: string): string {
    if (pageContent.length <= MAX_PAGE_CONTENT_CHARS) {
        return pageContent;
    }
    return `${pageContent.slice(0, MAX_PAGE_CONTENT_CHARS)}\n\n[Content truncated to ${MAX_PAGE_CONTENT_CHARS} characters before LLM extraction.]`;
}

function stringField(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function normaliseItems(items: unknown[]): RSSItem[] {
    const normalised: Array<RSSItem | null> = items
        .map((item) => {
            const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
            const title = stringField(record.title);
            const link = stringField(record.link);
            if (!title || !link) return null;

            return {
                title,
                link,
                guid: stringField(record.guid) || link,
                description: stringField(record.description) || title,
                pubDate: stringField(record.pubDate) || "NO_DATE_FOUND",
                categories: Array.isArray(record.categories)
                    ? record.categories.map(stringField).filter(Boolean)
                    : [],
                content: stringField(record.content) || undefined,
            };
        });

    return normalised.filter((item): item is RSSItem => item !== null);
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
                            content: `Parse this webpage content from ${targetUrl} and extract article data. Return only a valid json object matching the requested schema:\n\n${pageContent}`,
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

                parsed.items = normaliseItems(parsed.items);
                if (parsed.items.length === 0) {
                    console.log(`[RSS-Gen] No usable items from ${modelId}`);
                    lastError = new Error("LLM output contained no usable feed items");
                    continue;
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

async function extractFeedData(
    mode: ExtractionMode,
    targetUrl: string,
    pageContent: string,
    limit: number,
    fulltext: boolean
): Promise<ExtractionResult> {
    const deterministic = extractFeedDeterministically(targetUrl, pageContent, limit);

    console.log(
        `[Deterministic] confidence=${deterministic.confidence}, `
        + `family=${deterministic.selectedFamily || "none"}, `
        + deterministic.reasons.join(", ")
    );

    if (mode === "deterministic") {
        if (fulltext) {
            throw new Error("Deterministic extraction does not support fulltext mode yet");
        }
        if (deterministic.feedData.items.length === 0) {
            throw new Error("Deterministic extraction found no usable feed items");
        }
        return {
            feedData: deterministic.feedData,
            modelUsed: "none",
            strategy: "deterministic",
            deterministicConfidence: deterministic.confidence,
            adapter: "generic-deterministic",
        };
    }

    if (mode === "auto" && !fulltext) {
        const adapted = extractArticleCandidates(
            targetUrl,
            pageContent,
            Math.min(Math.max(limit * 2, 10), 30)
        );
        if (adapted.supported && adapted.candidates.length > 0) {
            const activeCandidates = adapted.candidates.slice(0, limit);
            const candidateUrls = activeCandidates.map((candidate) => candidate.url);
            const snapshotKey = `${targetUrl}|limit=${limit}|adapter=${adapted.adapter}`;

            try {
                const snapshot = await loadFeedSnapshot(snapshotKey);
                if (
                    snapshot
                    && candidateUrls.length === snapshot.candidateUrls.length
                    && candidateUrls.every((url, index) => url === snapshot.candidateUrls[index])
                ) {
                    console.log(`[Incremental] Snapshot HIT for ${targetUrl}; no LLM call`);
                    return {
                        feedData: snapshot.feedData,
                        modelUsed: "none",
                        strategy: "snapshot",
                        deterministicConfidence: 1,
                        adapter: adapted.adapter,
                    };
                }

                const previousUrls = new Set(snapshot?.candidateUrls || []);
                const newCandidates = activeCandidates.filter(
                    (candidate) => !previousUrls.has(candidate.url)
                );
                let newItems: RSSItem[] = [];
                let modelUsed = "none";
                let channel = snapshot?.feedData.channel;

                if (newCandidates.length > 0) {
                    const candidatePrompt = buildCandidatePrompt(targetUrl, newCandidates);
                    console.log(
                        `[Incremental] ${newCandidates.length}/${activeCandidates.length} new candidates; `
                        + `sending ${candidatePrompt.length} chars to LLM`
                    );
                    const generated = await generateFeedData(
                        targetUrl,
                        candidatePrompt,
                        newCandidates.length,
                        false
                    );
                    const allowedUrls = new Set(newCandidates.map((candidate) => canonicalUrl(candidate.url)));
                    newItems = generated.feedData.items.filter(
                        (item) => allowedUrls.has(canonicalUrl(item.link))
                    );
                    modelUsed = generated.modelUsed;
                    channel = channel || generated.feedData.channel;
                }

                const itemByUrl = new Map<string, RSSItem>();
                for (const item of snapshot?.feedData.items || []) {
                    itemByUrl.set(canonicalUrl(item.link), item);
                }
                for (const item of newItems) {
                    itemByUrl.set(canonicalUrl(item.link), item);
                }

                const mergedItems = activeCandidates
                    .map((candidate) => itemByUrl.get(canonicalUrl(candidate.url)))
                    .filter((item): item is RSSItem => Boolean(item))
                    .slice(0, limit);

                if (mergedItems.length > 0 && channel) {
                    const feedData: RSSFeedData = { channel, items: mergedItems };
                    const mergedUrls = new Set(mergedItems.map((item) => canonicalUrl(item.link)));
                    const processedCandidateUrls = candidateUrls.filter(
                        (url) => mergedUrls.has(canonicalUrl(url))
                    );
                    await saveFeedSnapshot(snapshotKey, {
                        candidateUrls: processedCandidateUrls,
                        feedData,
                        updatedAtISO: new Date().toISOString(),
                    });
                    return {
                        feedData,
                        modelUsed,
                        strategy: newCandidates.length > 0 ? "incremental-llm" : "snapshot",
                        deterministicConfidence: mergedItems.length / activeCandidates.length,
                        adapter: adapted.adapter,
                    };
                }
                console.warn(`[Incremental] Adapter ${adapted.adapter} produced no mergeable items`);
            } catch (error) {
                console.warn(`[Incremental] Adapter ${adapted.adapter} failed; using full LLM:`, error);
            }
        } else {
            console.log(`[Incremental] No supported adapter/candidates for ${targetUrl}; using full LLM`);
        }
    }

    const llmPageContent = trimPageContent(pageContent);
    if (llmPageContent.length !== pageContent.length) {
        console.log(`[RSS-Gen] Truncated page content from ${pageContent.length} to ${llmPageContent.length} chars`);
    }
    const llmResult = await generateFeedData(targetUrl, llmPageContent, limit, fulltext);

    if (mode === "shadow") {
        const deterministicLinks = new Set(deterministic.feedData.items.map((item) => item.link));
        const overlap = llmResult.feedData.items.filter((item) => deterministicLinks.has(item.link)).length;
        console.log(
            `[Shadow] deterministic=${deterministic.feedData.items.length}, `
            + `llm=${llmResult.feedData.items.length}, link-overlap=${overlap}, `
            + `confidence=${deterministic.confidence}`
        );
    }

    return {
        ...llmResult,
        strategy: "llm",
        deterministicConfidence: deterministic.confidence,
        adapter: "none",
    };
}

function canonicalUrl(value: string): string {
    try {
        const url = new URL(value);
        const pathname = url.pathname.replace(/\/+$/, "") || "/";
        return `${url.hostname.replace(/^www\./, "").toLowerCase()}${pathname}${url.search}`;
    } catch {
        return value.trim();
    }
}

// --- Date stabilisation ---
// After either extractor produces article data, we reconcile every item against the
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
                    source: "(optional) 'auto' (default), 'jina', or 'markdown'",
                    markdownMethod: "(optional) markdown.new method: 'auto' (default), 'ai', or 'browser'",
                    extract: "(optional) 'llm' (default), 'deterministic', 'auto', or 'shadow'",
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
    const source = parseMarkdownSource(searchParams.get("source"));
    const markdownMethod = parseMarkdownMethod(searchParams.get("markdownMethod"));
    const extractionMode = parseExtractionMode(
        searchParams.get("extract") || process.env.EXTRACTION_MODE || null
    );

    const apiSelectors = {
        targetSelector: searchParams.get("target") || undefined,
        removeSelector: searchParams.get("remove") || undefined,
        waitForSelector: searchParams.get("waitfor") || undefined,
    };
    const selectors = await resolveSelectors(targetUrl, apiSelectors);

    // --- Refresh only this URL; never invalidate every feed globally ---
    if (refresh) {
        console.log(`[API] Force refresh requested for: ${targetUrl}`);
    }

    // --- Step 1: Fetch webpage content as markdown (cached 24h) ---
    let pageContent: string;
    let contentFetchTime: number;
    let contentProvider: MarkdownProvider;
    try {
        console.log(`[API] Request for: ${targetUrl} (limit=${limit}, fulltext=${fulltext}, format=${format}, source=${source})`);
        const startTime = Date.now();
        const fetchResult = refresh
            ? await fetchPageContent(targetUrl, source, markdownMethod, selectors)
            : await fetchPageContentCache(
                targetUrl,
                source,
                markdownMethod,
                selectors.targetSelector,
                selectors.removeSelector,
                selectors.waitForSelector
            );
        pageContent = fetchResult.content;
        contentProvider = fetchResult.provider;
        contentFetchTime = Date.now() - startTime;
        console.log(`[Markdown] ${contentFetchTime < 100 ? "Cache HIT" : "Cache MISS"} (${contentFetchTime}ms, provider=${contentProvider}) — ${pageContent.length} chars`);
    } catch (error) {
        console.error("[Markdown] Fetch error:", error);
        return new Response(
            JSON.stringify({
                error: "Failed to fetch webpage content",
                message: error instanceof Error ? error.message : String(error),
                url: targetUrl,
            }, null, 2),
            { status: 502, headers: { "Content-Type": "application/json" } }
        );
    }

    // --- Step 2: Extract feed data deterministically and/or via LLM ---
    let cacheStatus = "MISS";
    try {
        const startTime = Date.now();
        const result = await extractFeedData(
            extractionMode,
            targetUrl,
            pageContent,
            limit,
            fulltext
        );
        const duration = Date.now() - startTime;
        cacheStatus = duration < 100 ? "HIT" : "MISS";
        console.log(
            `[RSS] ${cacheStatus} (${duration}ms) — ${result.feedData.items.length} articles `
            + `via ${result.strategy}`
        );

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
                "X-Extraction-Mode": extractionMode,
                "X-Extraction-Strategy": result.strategy,
                "X-Deterministic-Confidence": `${result.deterministicConfidence}`,
                "X-Extraction-Adapter": result.adapter || "none",
                "X-Content-Source": contentProvider === "jina" ? "jina-reader-filtered" : "markdown.new",
                "X-Markdown-Source": contentProvider,
                "X-Markdown-Method": contentProvider === "markdown" ? markdownMethod : "n/a",
                "X-RSS-Cache-Status": cacheStatus,
                "X-Markdown-Cache-Status": contentFetchTime < 100 ? "HIT" : "MISS",
                "X-Markdown-Fetch-Time": `${contentFetchTime}ms`,
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
