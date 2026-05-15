// File: app/api/rss/route.ts (for Next.js App Router)
// Uses Jina Reader to fetch webpage content, then OpenAI to generate RSS
// Implements GUID-based deduplication and persistent date tracking to prevent
// old articles from appearing as new entries on each regeneration.

import OpenAI from "openai";
import { createHash } from "crypto";
import { unstable_cache } from "next/cache";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

// Initialize OpenAI client with custom base URL support
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
});

// --- Article Date Registry ---
// Persists first-seen dates for article GUIDs so that regeneration never
// assigns "today's date" to an article we've already seen before.

interface ArticleRecord {
    guid: string;
    pubDate: string;       // RFC 822 date string
    firstSeenISO: string;  // ISO 8601 timestamp when we first saw this article
    title?: string;
}

interface UrlRegistry {
    [guid: string]: ArticleRecord;
}

const REGISTRY_DIR = join(process.cwd(), '.rss-cache');

function registryPath(url: string): string {
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
    return join(REGISTRY_DIR, `${hash}.json`);
}

async function loadRegistry(url: string): Promise<UrlRegistry> {
    try {
        const data = await readFile(registryPath(url), 'utf-8');
        return JSON.parse(data) as UrlRegistry;
    } catch {
        return {};
    }
}

async function saveRegistry(url: string, registry: UrlRegistry): Promise<void> {
    await mkdir(REGISTRY_DIR, { recursive: true });
    await writeFile(registryPath(url), JSON.stringify(registry, null, 2), 'utf-8');
}

// --- Jina Reader ---

async function fetchWithJina(url: string): Promise<string> {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const response = await fetch(jinaUrl, {
        headers: {
            'Accept': 'text/markdown',
            'X-Remove-Selector': 'header, footer, nav, .navigation, .sidebar, .menu, .ads, .social-share, .comments, #comments, .related-posts',
        },
    });

    if (!response.ok) {
        throw new Error(`Jina Reader failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
}

const fetchWithJinaCache = unstable_cache(
    async (url: string) => {
        console.log(`[Jina] Fetching fresh content for: ${url}`);
        return fetchWithJina(url);
    },
    ['jina-fetch'],
    {
        revalidate: 86400, // 24 hours
        tags: ['jina-fetch'],
    }
);

// --- XML Helpers ---

function sanitizeXML(xml: string): string {
    try {
        let sanitized = xml;
        sanitized = sanitized.replace(/>([^<>]+)</g, (match, content) => {
            if (content.trim() === '' || content.includes('&amp;')) {
                return match;
            }
            const escaped = content.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, '&amp;');
            return `>${escaped}<`;
        });
        return sanitized;
    } catch (error) {
        console.error('XML sanitization error:', error);
        return xml;
    }
}

/** Extract all <item> blocks from RSS XML and parse their key fields */
function parseItems(xml: string): Array<{ guid: string; title: string; pubDate: string; fullMatch: string }> {
    const items: Array<{ guid: string; title: string; pubDate: string; fullMatch: string }> = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
        const block = match[1];
        const guid = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1]?.trim() ?? '';
        const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? '';
        const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? '';
        items.push({ guid, title, pubDate, fullMatch: match[0] });
    }
    return items;
}

/** Replace a <pubDate> value inside a specific <item> block string */
function replaceItemPubDate(itemXml: string, newDate: string): string {
    return itemXml.replace(/<pubDate>[\s\S]*?<\/pubDate>/, `<pubDate>${newDate}</pubDate>`);
}

// --- RSS Generation (no content-hash in cache key) ---
// We cache purely by URL so that minor page layout changes don't trigger
// regeneration. The cache revalidates every 24 hours (matching Jina).

const generateRSSFromContent = unstable_cache(
    async (targetUrl: string, pageContent: string) => {
        const models = ["gpt-5.4-mini"];

        const systemPrompt = `You are an RSS feed generator. Parse the provided webpage content and output VALID RSS 2.0 XML.

CRITICAL REQUIREMENTS:
- Root: <rss version="2.0"><channel>...
- Channel: Include <title>, <link>, <description> for the feed itself
- Items: Extract 5-10 recent article entries with these REQUIRED fields:
  * <title>: Article title (exact text from source)
  * <link>: Article permanent URL (must be absolute URL)
  * <guid isPermaLink="true">: MUST be the EXACT same URL as <link> - critical for deduplication
  * <description>: Brief summary (1-2 sentences)
  * <pubDate>: Publication date in RFC 822 format (e.g., "Fri, 27 Dec 2024 00:00:00 GMT")

IMPORTANT RULES:
1. The <guid> must use the article's permanent URL to prevent duplicate entries in RSS readers
2. All URLs must be absolute (include https://domain.com prefix)
3. Only include actual articles/posts, not navigation or other page elements
4. DATES: Extract the ACTUAL publication date from the page content. Look for date patterns near article titles, bylines, or metadata. If you absolutely cannot find any date, use the placeholder "NO_DATE_FOUND" as the pubDate value — do NOT invent or guess a date.
5. CRITICAL: Properly escape special XML characters in ALL text content:
   - Replace & with &amp; (except when already part of an entity like &amp; &lt; etc.)
   - Replace < with &lt;
   - Replace > with &gt;
   - Replace " with &quot; in attribute values
   - Replace ' with &apos; in attribute values

Output: ONLY raw XML. No markdown blocks, no explanations, no \`\`\` wrappers.`;

        let lastError: unknown = null;

        for (const modelId of models) {
            try {
                console.log(`[RSS-Gen] Trying model: ${modelId} for ${targetUrl}`);
                const response = await openai.chat.completions.create({
                    model: modelId,
                    messages: [
                        { role: "system", content: systemPrompt },
                        {
                            role: "user",
                            content: `Parse this webpage content from ${targetUrl} and generate an RSS feed:\n\n${pageContent}`,
                        },
                    ],
                    temperature: 0,
                    max_tokens: 4096,
                    seed: 42,
                });

                let xml = response.choices[0]?.message?.content || "";
                xml = xml.replace(/```xml/g, '').replace(/```/g, '').trim();
                xml = sanitizeXML(xml);

                if (!xml.includes('<rss') || !xml.includes('<channel>')) {
                    console.log('Invalid RSS structure, trying next model...');
                    lastError = new Error('Generated content is not valid RSS');
                    continue;
                }

                console.log(`[RSS-Gen] Successfully generated RSS with ${modelId}`);
                return { xml, modelUsed: modelId };
            } catch (error: unknown) {
                lastError = error;
                const statusCode = (error as { status?: number })?.status;
                if (statusCode === 429 || statusCode === 503) {
                    console.log(`Model ${modelId} quota exceeded, trying next...`);
                    continue;
                }
                break;
            }
        }

        throw lastError || new Error('All models failed');
    },
    ['rss-generation-v2'],
    {
        revalidate: 86400, // 24 hours — matches Jina cache
        tags: ['rss-generation'],
    }
);

// --- Date stabilisation post-processing ---
// After LLM generates (or cache returns) RSS XML, we reconcile every <item>
// against the persistent registry so that:
//   1. Articles seen before keep their original pubDate (no date drift).
//   2. Articles with "NO_DATE_FOUND" get the date they were first seen.
//   3. Truly new articles get their LLM-extracted date (or first-seen date).

async function stabiliseDates(targetUrl: string, xml: string): Promise<string> {
    const registry = await loadRegistry(targetUrl);
    const items = parseItems(xml);
    const nowRFC822 = new Date().toUTCString();
    let stabilised = xml;
    let newArticles = 0;
    let reusedDates = 0;

    for (const item of items) {
        if (!item.guid) continue;

        const existing = registry[item.guid];

        if (existing) {
            // Article already known — always use the ORIGINAL date we stored
            if (item.pubDate !== existing.pubDate) {
                stabilised = stabilised.replace(
                    item.fullMatch,
                    replaceItemPubDate(item.fullMatch, existing.pubDate),
                );
                reusedDates++;
            }
        } else {
            // New article — determine its date
            let dateToStore: string;
            if (item.pubDate && item.pubDate !== 'NO_DATE_FOUND') {
                dateToStore = item.pubDate; // LLM found a real date
            } else {
                dateToStore = nowRFC822;    // fallback: first-seen = now
                stabilised = stabilised.replace(
                    item.fullMatch,
                    replaceItemPubDate(item.fullMatch, dateToStore),
                );
            }

            registry[item.guid] = {
                guid: item.guid,
                pubDate: dateToStore,
                firstSeenISO: new Date().toISOString(),
                title: item.title,
            };
            newArticles++;
        }
    }

    await saveRegistry(targetUrl, registry);
    console.log(`[DateStab] ${targetUrl}: ${newArticles} new, ${reusedDates} dates stabilised, ${Object.keys(registry).length} total tracked`);
    return stabilised;
}

// --- Route Handler ---

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl) {
        return new Response('Error: Missing "url" parameter. Usage: /api/rss?url=https://site.com', { status: 400 });
    }

    // Step 1: Fetch webpage content via Jina Reader (cached 24h)
    let pageContent: string;
    let jinaFetchTime: number;
    try {
        console.log(`[API] Request for: ${targetUrl}`);
        const startTime = Date.now();
        pageContent = await fetchWithJinaCache(targetUrl);
        jinaFetchTime = Date.now() - startTime;

        if (jinaFetchTime < 100) {
            console.log(`[Jina] Cache HIT (${jinaFetchTime}ms) - ${pageContent.length} chars`);
        } else {
            console.log(`[Jina] Cache MISS (${jinaFetchTime}ms) - ${pageContent.length} chars`);
        }
    } catch (error) {
        console.error('[Jina] Fetch error:', error);
        return new Response(JSON.stringify({
            error: 'Failed to fetch webpage content',
            message: error instanceof Error ? error.message : String(error),
            url: targetUrl,
        }, null, 2), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Step 2: Generate RSS (cached 24h by URL, NOT by content hash)
    let rssGenerationStatus = 'MISS';
    try {
        const startTime = Date.now();
        const result = await generateRSSFromContent(targetUrl, pageContent);
        const duration = Date.now() - startTime;

        if (duration < 100) {
            rssGenerationStatus = 'HIT';
            console.log(`[RSS] Cache HIT (${duration}ms)`);
        } else {
            rssGenerationStatus = 'MISS';
            console.log(`[RSS] Cache MISS (${duration}ms)`);
        }

        // Step 3: Stabilise dates — prevent old articles from getting new dates
        const stabilisedXml = await stabiliseDates(targetUrl, result.xml);

        return new Response(stabilisedXml, {
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Cache-Control': 's-maxage=86400, stale-while-revalidate=86400',
                'X-Model-Used': result.modelUsed,
                'X-Content-Source': 'jina-reader-filtered',
                'X-RSS-Cache-Status': rssGenerationStatus,
                'X-Jina-Cache-Status': jinaFetchTime < 100 ? 'HIT' : 'MISS',
                'X-Jina-Fetch-Time': `${jinaFetchTime}ms`,
            },
        });
    } catch (error: unknown) {
        console.error('RSS generation error:', error);
        return new Response(JSON.stringify({
            error: 'Failed to generate feed',
            message: error instanceof Error ? error.message : String(error),
            status: (error as { status?: number })?.status || 'unknown',
        }, null, 2), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}