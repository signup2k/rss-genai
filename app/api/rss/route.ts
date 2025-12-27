// File: app/api/rss/route.ts (for Next.js App Router)
// Uses Jina Reader to fetch webpage content, then Gemini to generate RSS

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

// Fetch webpage content using Jina Reader API
async function fetchWithJina(url: string): Promise<string> {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const response = await fetch(jinaUrl, {
        headers: {
            'Accept': 'text/markdown',
            // Optional: Add Jina API key if you have one for higher rate limits
            // 'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
        },
    });

    if (!response.ok) {
        throw new Error(`Jina Reader failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl) {
        return new Response('Error: Missing "url" parameter. Usage: /api/rss?url=https://site.com', { status: 400 });
    }

    // Step 1: Fetch webpage content using Jina Reader
    let pageContent: string;
    try {
        console.log(`Fetching content from: ${targetUrl}`);
        pageContent = await fetchWithJina(targetUrl);
        console.log(`Fetched ${pageContent.length} characters`);
    } catch (error) {
        console.error('Jina Reader error:', error);
        return new Response(JSON.stringify({
            error: 'Failed to fetch webpage content',
            message: error instanceof Error ? error.message : String(error),
            url: targetUrl,
        }, null, 2), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Step 2: Use Gemini to parse content into RSS
    const models = ["gemini-2.5-flash", "gemini-3-flash-preview"];

    const systemPrompt = `
You are an RSS feed generator. Parse the provided webpage content and output VALID RSS 2.0 XML.

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

Output: ONLY raw XML. No markdown blocks, no explanations, no \`\`\` wrappers.
`;

    let lastError: unknown = null;

    for (const modelId of models) {
        try {
            console.log(`Trying model: ${modelId}`);
            const response = await ai.models.generateContent({
                model: modelId,
                contents: `Parse this webpage content from ${targetUrl} and generate an RSS feed:\n\n${pageContent}`,
                config: {
                    systemInstruction: systemPrompt,
                    thinkingConfig: { thinkingBudget: 1024 },
                },
            });

            let xml = response.text || "";
            // Cleanup markdown if present
            xml = xml.replace(/```xml/g, '').replace(/```/g, '').trim();

            // Validate basic RSS structure
            if (!xml.includes('<rss') || !xml.includes('<channel>')) {
                console.log('Invalid RSS structure, trying next model...');
                lastError = new Error('Generated content is not valid RSS');
                continue;
            }

            // Return proper XML response with Caching
            return new Response(xml, {
                headers: {
                    'Content-Type': 'application/xml; charset=utf-8',
                    'Cache-Control': 's-maxage=86400, stale-while-revalidate=86400',
                    'X-Model-Used': modelId,
                    'X-Content-Source': 'jina-reader',
                },
            });
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

    console.error(lastError);

    return new Response(JSON.stringify({
        error: 'Failed to generate feed',
        message: lastError instanceof Error ? lastError.message : String(lastError),
        status: (lastError as { status?: number })?.status || 'unknown',
        modelsAttempted: models,
    }, null, 2), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
    });
}