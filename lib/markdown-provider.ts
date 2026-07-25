import { unstable_cache } from "next/cache";

import { normalizeMarkdownPayload } from "@/lib/candidate-extractor";
import type { SiteSelectors } from "@/lib/site-selectors";

export type MarkdownSource = "auto" | "jina" | "markdown";
export type MarkdownProvider = "jina" | "markdown";
export type MarkdownMethod = "auto" | "ai" | "browser";

export interface PageFetchResult {
    content: string;
    provider: MarkdownProvider;
}

export const MARKDOWN_CACHE_SECONDS = 1_800;

const MAX_MARKDOWN_RESPONSE_CHARS = 2_000_000;
const FETCH_TIMEOUT_MS = 25_000;

export function parseMarkdownSource(value: string | null): MarkdownSource {
    if (value === "jina" || value === "markdown") return value;
    return "auto";
}

export function parseMarkdownMethod(value: string | null): MarkdownMethod {
    if (value === "ai" || value === "browser") return value;
    return "auto";
}

async function readMarkdownResponse(
    response: Response,
    providerName: string
): Promise<string> {
    const declaredLength = Number(response.headers.get("content-length") || "0");
    if (declaredLength > MAX_MARKDOWN_RESPONSE_CHARS) {
        throw new Error(`${providerName} response is too large`);
    }

    const content = await response.text();
    if (content.length > MAX_MARKDOWN_RESPONSE_CHARS) {
        throw new Error(`${providerName} response is too large`);
    }
    if (content.trim().length < 80) {
        throw new Error(`${providerName} returned too little usable content`);
    }
    return content;
}

async function fetchWithJina(
    url: string,
    selectors: SiteSelectors
): Promise<string> {
    const headers: Record<string, string> = { Accept: "text/markdown" };
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
        `https://r.jinaai.cn/${url}`,
    ];
    let lastError: unknown;
    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, {
                headers,
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (response.ok) {
                return readMarkdownResponse(response, "Jina Reader");
            }
            lastError = new Error(
                `Jina Reader failed: ${response.status} ${response.statusText}`
            );
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("All Jina Reader endpoints failed");
}

async function fetchWithMarkdownNew(
    url: string,
    method: MarkdownMethod
): Promise<string> {
    const response = await fetch("https://markdown.new/", {
        method: "POST",
        headers: {
            Accept: "text/markdown",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ url, method }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(
            `markdown.new failed: ${response.status} ${response.statusText}`
        );
    }
    return normalizeMarkdownPayload(
        await readMarkdownResponse(response, "markdown.new")
    );
}

export async function fetchPageContent(
    url: string,
    source: MarkdownSource,
    markdownMethod: MarkdownMethod,
    selectors: SiteSelectors
): Promise<PageFetchResult> {
    if (source === "markdown") {
        console.log(
            `[markdown.new] Fetching fresh content for: ${url} `
            + `(method=${markdownMethod})`
        );
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
        console.warn(
            `[Jina] Failed, falling back to markdown.new for ${url}:`,
            error
        );
        return {
            content: await fetchWithMarkdownNew(url, markdownMethod),
            provider: "markdown",
        };
    }
}

export const fetchPageContentCached = unstable_cache(
    async (
        url: string,
        source: MarkdownSource,
        markdownMethod: MarkdownMethod,
        targetSelector?: string,
        removeSelector?: string,
        waitForSelector?: string
    ) => {
        return fetchPageContent(url, source, markdownMethod, {
            targetSelector,
            removeSelector,
            waitForSelector,
        });
    },
    ["markdown-fetch-v3"],
    { revalidate: MARKDOWN_CACHE_SECONDS }
);
