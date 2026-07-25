import { createHash } from "crypto";

import { unstable_cache } from "next/cache";
import OpenAI from "openai";

import {
    buildCandidatePrompt,
    extractArticleCandidates,
    type ArticleCandidate,
} from "@/lib/candidate-extractor";
import {
    extractFeedDeterministically,
    type ExtractionMode,
} from "@/lib/deterministic-extractor";
import {
    loadFeedSnapshot,
    saveFeedSnapshot,
} from "@/lib/storage";
import {
    canonicalArticleUrl,
    collectSourceArticleUrls,
    normalizeArticleUrl,
} from "@/lib/url-utils";
import type { RSSFeedData, RSSItem } from "@/lib/xml-builder";

export interface ExtractionResult {
    feedData: RSSFeedData;
    modelUsed: string;
    strategy: "llm" | "deterministic" | "incremental-llm" | "snapshot";
    deterministicConfidence: number;
    adapter: string;
}

interface LLMResult {
    feedData: RSSFeedData;
    modelUsed: string;
}

const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com";
const DEFAULT_LLM_MODEL = "deepseek-v4-flash";
const MAX_PAGE_CONTENT_CHARS = 100_000;
const SNAPSHOT_VERSION = 2;

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
    if (!openai) {
        openai = new OpenAI({
            apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
            baseURL: process.env.DEEPSEEK_BASE_URL
                || process.env.OPENAI_BASE_URL
                || DEFAULT_LLM_BASE_URL,
        });
    }
    return openai;
}

function getModels(): string[] {
    return [
        process.env.DEEPSEEK_MODEL
        || process.env.OPENAI_MODEL
        || DEFAULT_LLM_MODEL,
    ];
}

function buildSystemPrompt(limit: number): string {
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
      "description": "Brief summary (1-2 sentences)",
      "pubDate": "Publication date in RFC 822 format",
      "categories": ["tag1", "tag2"]
    }
  ]
}

RULES:
1. Extract up to ${limit} recent articles/posts
2. Copy item URLs exactly from the supplied SOURCE URL ALLOWLIST. Never invent, repair, or rewrite a URL.
3. Only include actual articles/posts, not navigation, ads, or other page elements
4. Extract the actual publication date. If none is present, use "NO_DATE_FOUND"; never guess.
5. Use an empty categories array when no categories are visible.
6. Output ONLY the JSON object as valid json.`;
}

function stringField(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function normalisePubDate(value: unknown): string {
    const raw = stringField(value);
    if (!raw || raw === "NO_DATE_FOUND") return "NO_DATE_FOUND";
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime())
        ? "NO_DATE_FOUND"
        : parsed.toUTCString();
}

function normaliseItems(
    items: unknown[],
    targetUrl: string,
    allowedUrls: string[]
): RSSItem[] {
    const allowedIdentities = new Set(
        allowedUrls.map((url) => canonicalArticleUrl(url, targetUrl))
    );
    const normalised: RSSItem[] = [];

    for (const item of items) {
        const record = item && typeof item === "object"
            ? item as Record<string, unknown>
            : {};
        const title = stringField(record.title);
        const link = normalizeArticleUrl(stringField(record.link), targetUrl);
        if (!title || !link) continue;
        if (
            allowedIdentities.size > 0
            && !allowedIdentities.has(canonicalArticleUrl(link, targetUrl))
        ) {
            continue;
        }

        normalised.push({
            title,
            link,
            guid: link,
            description: stringField(record.description) || title,
            pubDate: normalisePubDate(record.pubDate),
            categories: Array.isArray(record.categories)
                ? record.categories.map(stringField).filter(Boolean)
                : [],
        });
    }
    return normalised;
}

function trimPageContent(pageContent: string): string {
    if (pageContent.length <= MAX_PAGE_CONTENT_CHARS) return pageContent;
    return `${pageContent.slice(0, MAX_PAGE_CONTENT_CHARS)}

[Content truncated to ${MAX_PAGE_CONTENT_CHARS} characters before LLM extraction.]`;
}

async function generateFeedDataUncached(
    targetUrl: string,
    pageContent: string,
    limit: number,
    allowedUrls: string[]
): Promise<LLMResult> {
    const systemPrompt = buildSystemPrompt(limit);
    const allowlist = allowedUrls
        .slice(0, 500)
        .map((url, index) => `${index + 1}. ${url}`)
        .join("\n");
    let lastError: unknown = null;

    for (const modelId of getModels()) {
        try {
            console.log(`[RSS-Gen] Trying model: ${modelId} for ${targetUrl}`);
            const response = await getOpenAI().chat.completions.create({
                model: modelId,
                messages: [
                    { role: "system", content: systemPrompt },
                    {
                        role: "user",
                        content: `Parse this webpage content from ${targetUrl} and extract article data. Return only a valid json object matching the requested schema.

SOURCE URL ALLOWLIST:
${allowlist || "(No explicit URL list was detected; only use same-site URLs present in the content.)"}

WEBPAGE CONTENT:
${pageContent}`,
                    },
                ],
                temperature: 0,
                max_tokens: 8192,
                seed: 42,
                response_format: { type: "json_object" },
            });

            const raw = response.choices[0]?.message?.content || "";
            const cleaned = raw
                .replace(/```(?:json)?\s*/g, "")
                .replace(/```/g, "")
                .trim();
            let parsed: RSSFeedData;
            try {
                parsed = JSON.parse(cleaned) as RSSFeedData;
            } catch {
                lastError = new Error("LLM output is not valid JSON");
                continue;
            }

            if (
                !parsed.channel?.title
                || !Array.isArray(parsed.items)
                || parsed.items.length === 0
            ) {
                lastError = new Error("LLM output missing required fields");
                continue;
            }

            const items = normaliseItems(parsed.items, targetUrl, allowedUrls)
                .slice(0, limit);
            if (items.length === 0) {
                lastError = new Error(
                    "LLM output contained no source-backed feed items"
                );
                continue;
            }

            return {
                feedData: {
                    channel: {
                        title: stringField(parsed.channel.title),
                        link: targetUrl,
                        description: stringField(parsed.channel.description)
                            || `Updates from ${new URL(targetUrl).hostname}`,
                    },
                    items,
                },
                modelUsed: modelId,
            };
        } catch (error: unknown) {
            lastError = error;
            const statusCode = (error as { status?: number })?.status;
            if (statusCode === 429 || statusCode === 503) continue;
            break;
        }
    }

    throw lastError || new Error("All models failed to generate feed data");
}

const generateFeedDataCached = unstable_cache(
    generateFeedDataUncached,
    ["rss-generation-v4"],
    { revalidate: 21_600 }
);

function generateFeedData(
    targetUrl: string,
    pageContent: string,
    limit: number,
    allowedUrls: string[],
    forceRefresh: boolean
): Promise<LLMResult> {
    return forceRefresh
        ? generateFeedDataUncached(targetUrl, pageContent, limit, allowedUrls)
        : generateFeedDataCached(targetUrl, pageContent, limit, allowedUrls);
}

function candidateFingerprint(candidate: ArticleCandidate): string {
    return createHash("sha256")
        .update(`${candidate.url}\n${candidate.titleHint}\n${candidate.sourceBlock}`)
        .digest("hex")
        .slice(0, 16);
}

async function extractIncrementally(
    targetUrl: string,
    pageContent: string,
    limit: number,
    forceRefresh: boolean,
    snapshotContext: string
): Promise<ExtractionResult | null> {
    const adapted = extractArticleCandidates(
        targetUrl,
        pageContent,
        Math.min(Math.max(limit * 2, 10), 30)
    );
    if (!adapted.supported || adapted.candidates.length === 0) return null;

    const activeCandidates = adapted.candidates.slice(0, limit);
    const candidateUrls = activeCandidates.map((candidate) => candidate.url);
    const fingerprints = activeCandidates.map(candidateFingerprint);
    const snapshotKey = [
        `v=${SNAPSHOT_VERSION}`,
        targetUrl,
        `limit=${limit}`,
        `adapter=${adapted.adapter}`,
        `context=${snapshotContext}`,
    ].join("|");

    try {
        const snapshot = forceRefresh ? null : await loadFeedSnapshot(snapshotKey);
        const unchanged = snapshot
            && snapshot.version === SNAPSHOT_VERSION
            && candidateUrls.length === snapshot.candidateUrls.length
            && candidateUrls.every((url, index) => (
                canonicalArticleUrl(url, targetUrl)
                    === canonicalArticleUrl(snapshot.candidateUrls[index], targetUrl)
                && fingerprints[index] === snapshot.candidateFingerprints[index]
            ));
        if (unchanged && snapshot) {
            console.log(`[Incremental] Snapshot HIT for ${targetUrl}`);
            return {
                feedData: snapshot.feedData,
                modelUsed: "none",
                strategy: "snapshot",
                deterministicConfidence: 1,
                adapter: adapted.adapter,
            };
        }

        const previousFingerprints = new Map(
            (snapshot?.candidateUrls || []).map((url, index) => [
                canonicalArticleUrl(url, targetUrl),
                snapshot?.candidateFingerprints[index],
            ])
        );
        const newCandidates = activeCandidates.filter((candidate, index) => {
            return previousFingerprints.get(
                canonicalArticleUrl(candidate.url, targetUrl)
            ) !== fingerprints[index];
        });
        const newItems: RSSItem[] = [];
        let modelUsed = "none";
        let channel = snapshot?.feedData.channel;

        if (newCandidates.length > 0) {
            const generated = await generateFeedData(
                targetUrl,
                buildCandidatePrompt(targetUrl, newCandidates),
                newCandidates.length,
                newCandidates.map((candidate) => candidate.url),
                forceRefresh
            );
            const generatedByUrl = new Map<string, RSSItem>(
                generated.feedData.items.map((item) => [
                    canonicalArticleUrl(item.link, targetUrl),
                    item,
                ])
            );
            for (const candidate of newCandidates) {
                const item = generatedByUrl.get(
                    canonicalArticleUrl(candidate.url, targetUrl)
                );
                if (item) {
                    newItems.push({
                        ...item,
                        link: candidate.url,
                        guid: candidate.url,
                    });
                }
            }
            modelUsed = generated.modelUsed;
            channel = channel || generated.feedData.channel;
        }

        const itemByUrl = new Map<string, RSSItem>();
        for (const item of snapshot?.feedData.items || []) {
            itemByUrl.set(canonicalArticleUrl(item.link, targetUrl), item);
        }
        for (const item of newItems) {
            itemByUrl.set(canonicalArticleUrl(item.link, targetUrl), item);
        }
        const mergedItems = activeCandidates
            .map((candidate) => itemByUrl.get(
                canonicalArticleUrl(candidate.url, targetUrl)
            ))
            .filter((item): item is RSSItem => Boolean(item))
            .slice(0, limit);
        if (mergedItems.length === 0 || !channel) return null;

        const mergedUrls = new Set(
            mergedItems.map((item) => canonicalArticleUrl(item.link, targetUrl))
        );
        const processed = activeCandidates
            .map((candidate, index) => ({
                url: candidate.url,
                fingerprint: fingerprints[index],
            }))
            .filter((candidate) => (
                mergedUrls.has(canonicalArticleUrl(candidate.url, targetUrl))
            ));
        const feedData: RSSFeedData = { channel, items: mergedItems };
        await saveFeedSnapshot(snapshotKey, {
            version: SNAPSHOT_VERSION,
            candidateUrls: processed.map((candidate) => candidate.url),
            candidateFingerprints: processed.map(
                (candidate) => candidate.fingerprint
            ),
            feedData,
            updatedAtISO: new Date().toISOString(),
        });
        return {
            feedData,
            modelUsed,
            strategy: newCandidates.length > 0
                ? "incremental-llm"
                : "snapshot",
            deterministicConfidence: mergedItems.length / activeCandidates.length,
            adapter: adapted.adapter,
        };
    } catch (error) {
        console.warn(
            `[Incremental] Adapter ${adapted.adapter} failed; using full LLM:`,
            error
        );
        return null;
    }
}

export async function extractFeedData(
    mode: ExtractionMode,
    targetUrl: string,
    pageContent: string,
    limit: number,
    forceRefresh: boolean,
    snapshotContext: string
): Promise<ExtractionResult> {
    const deterministic = mode === "deterministic" || mode === "shadow"
        ? extractFeedDeterministically(targetUrl, pageContent, limit)
        : null;

    if (mode === "deterministic") {
        if (!deterministic || deterministic.feedData.items.length === 0) {
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

    if (mode === "auto") {
        const incremental = await extractIncrementally(
            targetUrl,
            pageContent,
            limit,
            forceRefresh,
            snapshotContext
        );
        if (incremental) return incremental;
    }

    const llmPageContent = trimPageContent(pageContent);
    const allowedUrls = collectSourceArticleUrls(pageContent, targetUrl, 500);
    const llmResult = await generateFeedData(
        targetUrl,
        llmPageContent,
        limit,
        allowedUrls,
        forceRefresh
    );

    if (mode === "shadow" && deterministic) {
        const deterministicLinks = new Set(
            deterministic.feedData.items.map(
                (item) => canonicalArticleUrl(item.link, targetUrl)
            )
        );
        const overlap = llmResult.feedData.items.filter(
            (item) => deterministicLinks.has(
                canonicalArticleUrl(item.link, targetUrl)
            )
        ).length;
        console.log(
            `[Shadow] deterministic=${deterministic.feedData.items.length}, `
            + `llm=${llmResult.feedData.items.length}, overlap=${overlap}, `
            + `confidence=${deterministic.confidence}`
        );
    }

    return {
        ...llmResult,
        strategy: "llm",
        deterministicConfidence: deterministic?.confidence || 0,
        adapter: "none",
    };
}
