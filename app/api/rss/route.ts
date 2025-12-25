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

    const modelId = "gemini-2.0-flash";
    // Optimize prompt to be concise for server-side execution
    const systemPrompt = `
    You are an RSS feed generator. Analyze the website content and output VALID RSS 2.0 XML.
    - Root: <rss version="2.0"><channel>...
    - Items: Find 5-10 recent items with title, link, description, pubDate.
    - Output: ONLY raw XML. No markdown blocks.
  `;

    try {
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
        // s-maxage=3600 means CDNs/RSS Readers should cache this for 1 hour (3600s)
        return new Response(xml, {
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Cache-Control': 's-maxage=3600, stale-while-revalidate',
            },
        });
    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: 'Failed to generate feed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}