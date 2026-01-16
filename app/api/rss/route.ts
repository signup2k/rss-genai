// File: app/api/rss/route.ts (for Next.js App Router)
// Uses Jina Reader to fetch webpage content, then OpenAI to generate RSS
// Implements content-based caching to prevent duplicate RSS entries

import OpenAI from "openai";
import { createHash } from "crypto";
import { unstable_cache } from "next/cache";

// Initialize OpenAI client with custom base URL support
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined, // Use custom base URL if provided
});

// Fetch webpage content using Jina Reader API with content filtering
async function fetchWithJina(url: string): Promise<string> {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const response = await fetch(jinaUrl, {
        headers: {
            'Accept': 'text/markdown',
            // Remove common page elements that aren't article content
            'X-Remove-Selector': 'header, footer, nav, .navigation, .sidebar, .menu, .ads, .social-share, .comments, #comments, .related-posts',
            // Optionally focus on main content areas (uncomment if needed)
            // 'X-Target-Selector': 'article, main, .content, .post, .entry-content, #main-content',
            // Optional: Add Jina API key if you have one for higher rate limits
            // 'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
        },
    });

    if (!response.ok) {
        throw new Error(`Jina Reader failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
}

// Cached version of fetchWithJina to prevent excessive API calls
// Cache duration: 1 hour - balances content freshness with API quota conservation
const fetchWithJinaCache = unstable_cache(
    async (url: string) => {
        console.log(`[Jina] Fetching fresh content for: ${url}`);
        return fetchWithJina(url);
    },
    ['jina-fetch'],
    {
        revalidate: 3600, // 1 hour in seconds
        tags: ['jina-fetch'],
    }
);

// Calculate SHA-256 hash of content for cache key
function getContentHash(url: string, content: string): string {
    return createHash('sha256')
        .update(`${url}:${content}`)
        .digest('hex');
}

// Sanitize XML content to escape special characters properly
function sanitizeXML(xml: string): string {
    // Function to escape special XML characters in text content
    const escapeXMLText = (text: string): string => {
        return text
            .replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, '&amp;')  // Escape unescaped ampersands
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    };

    // Function to escape special characters in attribute values
    const escapeXMLAttribute = (text: string): string => {
        return text
            .replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    };

    try {
        // Process common RSS/XML tags to properly escape their content
        // This is a simple approach - for production, consider using a proper XML parser
        let sanitized = xml;

        // Escape content between tags (text nodes)
        // Match pattern: >content< where content doesn't contain < or >
        sanitized = sanitized.replace(/>([^<>]+)</g, (match, content) => {
            // Don't escape if it's just whitespace or already contains entities
            if (content.trim() === '' || content.includes('&amp;')) {
                return match;
            }
            // Only escape the & that are not already part of an entity
            const escaped = content.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, '&amp;');
            return `>${escaped}<`;
        });

        return sanitized;
    } catch (error) {
        console.error('XML sanitization error:', error);
        return xml; // Return original if sanitization fails
    }
}

// Generate RSS feed from content using OpenAI (cached based on content hash)
const generateRSSFromContent = unstable_cache(
    async (targetUrl: string, pageContent: string, contentHash: string) => {
        const models = ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"];

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
4. If dates are not available, use today's date: ${new Date().toUTCString()}
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
                console.log(`[${contentHash.slice(0, 8)}] Trying model: ${modelId}`);
                const response = await openai.chat.completions.create({
                    model: modelId,
                    messages: [
                        {
                            role: "system",
                            content: systemPrompt,
                        },
                        {
                            role: "user",
                            content: `Parse this webpage content from ${targetUrl} and generate an RSS feed:\n\n${pageContent}`,
                        },
                    ],
                    temperature: 0, // Set to 0 for maximum consistency
                    max_tokens: 4096,
                    seed: 42, // Fixed seed for reproducible outputs
                });

                let xml = response.choices[0]?.message?.content || "";
                // Cleanup markdown if present
                xml = xml.replace(/```xml/g, '').replace(/```/g, '').trim();

                // Sanitize XML to escape special characters properly
                xml = sanitizeXML(xml);

                // Validate basic RSS structure
                if (!xml.includes('<rss') || !xml.includes('<channel>')) {
                    console.log('Invalid RSS structure, trying next model...');
                    lastError = new Error('Generated content is not valid RSS');
                    continue;
                }

                console.log(`[${contentHash.slice(0, 8)}] Successfully generated RSS with ${modelId}`);

                return {
                    xml,
                    modelUsed: modelId,
                };
            } catch (error: unknown) {
                lastError = error;
                const statusCode = (error as { status?: number })?.status;
                if (statusCode === 429 || statusCode === 503) {
                    console.log(`Model ${modelId} quota exceeded, trying next...`);
                    continue;
                }
                // For other errors, break the loop and return error
                break;
            }
        }

        throw lastError || new Error('All models failed');
    },
    // Cache configuration
    ['rss-generation'],
    {
        revalidate: 604800, // 7 days in seconds
        tags: [`rss-generation`],
    }
);

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl) {
        return new Response('Error: Missing "url" parameter. Usage: /api/rss?url=https://site.com', { status: 400 });
    }

    // Step 1: Fetch webpage content using Jina Reader with content filtering (cached)
    let pageContent: string;
    let jinaFetchTime: number;
    try {
        console.log(`[API] Request for: ${targetUrl}`);
        const startTime = Date.now();
        pageContent = await fetchWithJinaCache(targetUrl);
        jinaFetchTime = Date.now() - startTime;

        // Log cache status based on fetch time
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

    // Step 2: Calculate content hash for caching
    const contentHash = getContentHash(targetUrl, pageContent);
    console.log(`Content hash: ${contentHash.slice(0, 16)}...`);

    // Step 3: Generate RSS (will use cache if content hash matches)
    let rssGenerationStatus = 'MISS';
    try {
        const startTime = Date.now();
        const result = await generateRSSFromContent(targetUrl, pageContent, contentHash);
        const duration = Date.now() - startTime;

        // If very fast (<100ms), likely a cache hit
        if (duration < 100) {
            rssGenerationStatus = 'HIT';
            console.log(`[RSS] Cache HIT for ${contentHash.slice(0, 8)} (${duration}ms)`);
        } else {
            rssGenerationStatus = 'MISS';
            console.log(`[RSS] Cache MISS for ${contentHash.slice(0, 8)} (${duration}ms)`);
        }

        // Return proper XML response with caching headers
        return new Response(result.xml, {
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Cache-Control': 's-maxage=86400, stale-while-revalidate=86400',
                'X-Model-Used': result.modelUsed,
                'X-Content-Source': 'jina-reader-filtered',
                'X-RSS-Cache-Status': rssGenerationStatus,
                'X-Jina-Cache-Status': jinaFetchTime < 100 ? 'HIT' : 'MISS',
                'X-Jina-Fetch-Time': `${jinaFetchTime}ms`,
                'X-Content-Hash': contentHash.slice(0, 16),
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