// File: app/api/rss/route.ts (for Next.js App Router)
// Ensure you have @google/genai installed and GOOGLE_API_KEY in .env

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl) {
        return new Response('Error: Missing "url" parameter. Usage: /api/rss?url=https://site.com', { status: 400 });
    }

    // Model priority: try 2.5-flash first (20 free/day), fallback to 3-flash-preview
    const models = ["gemini-2.5-flash", "gemini-3-flash-preview"];

    const systemPrompt = `
    You are an RSS feed generator. Analyze the website content and output VALID RSS 2.0 XML.
    - Root: <rss version="2.0"><channel>...
    - Items: Find 5-10 recent items with title, link, description, pubDate.
    - Output: ONLY raw XML. No markdown blocks.
  `;

    let lastError: unknown = null;

    for (const modelId of models) {
        try {
            console.log(`Trying model: ${modelId}`);
            const response = await ai.models.generateContent({
                model: modelId,
                contents: `Generate RSS feed for: ${targetUrl}`,
                config: {
                    systemInstruction: systemPrompt,
                    tools: [{ googleSearch: {} }],
                    thinkingConfig: { thinkingBudget: 1024 },
                },
            });

            let xml = response.text || "";
            // Cleanup markdown if present
            xml = xml.replace(/\`\`\`xml/g, '').replace(/\`\`\`/g, '').trim();

            // Return proper XML response with Caching
            // s-maxage=86400 = 24 hours cache on Vercel CDN
            // stale-while-revalidate=86400 = serve stale content for another 24h while refreshing
            return new Response(xml, {
                headers: {
                    'Content-Type': 'application/xml; charset=utf-8',
                    'Cache-Control': 's-maxage=86400, stale-while-revalidate=86400',
                    'X-Model-Used': modelId,
                },
            });
        } catch (error: unknown) {
            lastError = error;
            const statusCode = (error as { status?: number })?.status;
            // 429 = Rate limit / quota exceeded, try next model
            if (statusCode === 429 || statusCode === 503) {
                console.log(`Model ${modelId} quota exceeded, trying next...`);
                continue;
            }
            // For other errors, don't retry
            break;
        }
    }

    console.error(lastError);

    // Build detailed error info
    const errorDetails = {
        error: 'Failed to generate feed',
        message: lastError instanceof Error ? lastError.message : String(lastError),
        status: (lastError as { status?: number })?.status || 'unknown',
        modelsAttempted: models,
    };

    return new Response(JSON.stringify(errorDetails, null, 2), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
    });
}