import { unstable_cache } from "next/cache";

import {
    fetchPageContent,
    fetchPageContentCached,
    type MarkdownMethod,
    type MarkdownSource,
} from "@/lib/markdown-provider";
import {
    loadRegistry,
    saveRegistry,
    type ArticleRecord,
    type UrlRegistry,
} from "@/lib/storage";
import {
    canonicalArticleUrl,
    normalizeArticleUrl,
} from "@/lib/url-utils";
import type { RSSItem } from "@/lib/xml-builder";

const ARTICLE_CHECK_TIMEOUT_MS = 6_000;
const MAX_FULLTEXT_CHARS = 80_000;

interface ArticleLinkCheck {
    unavailable: boolean;
}

async function checkArticleLinkUncached(url: string): Promise<ArticleLinkCheck> {
    try {
        let response = await fetch(url, {
            method: "HEAD",
            redirect: "follow",
            cache: "no-store",
            signal: AbortSignal.timeout(ARTICLE_CHECK_TIMEOUT_MS),
        });
        if ([404, 405, 410].includes(response.status)) {
            response = await fetch(url, {
                headers: { Range: "bytes=0-0" },
                redirect: "follow",
                cache: "no-store",
                signal: AbortSignal.timeout(ARTICLE_CHECK_TIMEOUT_MS),
            });
        }
        return {
            unavailable: response.status === 404 || response.status === 410,
        };
    } catch {
        // A timeout, bot challenge, or network restriction is inconclusive.
        return { unavailable: false };
    }
}

const checkArticleLinkCached = unstable_cache(
    checkArticleLinkUncached,
    ["article-link-health-v1"],
    { revalidate: 21_600 }
);

export async function filterUnavailableArticleLinks(
    items: RSSItem[],
    targetUrl: string,
    forceRefresh: boolean
): Promise<RSSItem[]> {
    const checked = await Promise.all(items.map(async (item) => {
        const result = forceRefresh
            ? await checkArticleLinkUncached(item.link)
            : await checkArticleLinkCached(item.link);
        if (result.unavailable) {
            console.warn(`[LinkCheck] Dropping unavailable article: ${item.link}`);
            return null;
        }
        const link = normalizeArticleUrl(item.link, targetUrl) || item.link;
        return { ...item, link, guid: link };
    }));

    const available: RSSItem[] = [];
    for (const item of checked) {
        if (item) available.push(item);
    }
    return available;
}

function markdownBody(content: string): string {
    const marker = "\nMarkdown Content:\n";
    const markerIndex = content.indexOf(marker);
    const body = markerIndex >= 0
        ? content.slice(markerIndex + marker.length)
        : content;
    return body.trim().slice(0, MAX_FULLTEXT_CHARS);
}

export async function enrichFullText(
    items: RSSItem[],
    source: MarkdownSource,
    markdownMethod: MarkdownMethod,
    removeSelector: string | undefined,
    forceRefresh: boolean
): Promise<RSSItem[]> {
    const enriched: RSSItem[] = [];
    const queue = [...items];
    const workers = Array.from(
        { length: Math.min(3, queue.length) },
        async () => {
            while (queue.length > 0) {
                const item = queue.shift();
                if (!item) return;
                try {
                    const result = forceRefresh
                        ? await fetchPageContent(
                            item.link,
                            source,
                            markdownMethod,
                            { removeSelector }
                        )
                        : await fetchPageContentCached(
                            item.link,
                            source,
                            markdownMethod,
                            undefined,
                            removeSelector,
                            undefined
                        );
                    const content = markdownBody(result.content);
                    enriched.push(content ? { ...item, content } : item);
                } catch (error) {
                    console.warn(`[Fulltext] Failed for ${item.link}:`, error);
                    enriched.push(item);
                }
            }
        }
    );
    await Promise.all(workers);

    const itemByUrl = new Map(
        enriched.map((item) => [canonicalArticleUrl(item.link), item])
    );
    return items.map(
        (item) => itemByUrl.get(canonicalArticleUrl(item.link)) || item
    );
}

function migrateRegistry(
    registry: UrlRegistry,
    articleBaseUrl: string
): UrlRegistry {
    const migrated: UrlRegistry = {};
    const articleBaseHost = new URL(articleBaseUrl).hostname;

    for (const record of Object.values(registry)) {
        const normalizedGuid = normalizeArticleUrl(record.guid, articleBaseUrl);
        if (
            !normalizedGuid
            && articleBaseHost === "equityview.research.db.com"
            && /^(?:https?:\/\/)?(?:www\.)?dbresearch\.com\//i.test(record.guid)
        ) {
            continue;
        }
        const guid = normalizedGuid || record.guid;
        const normalizedRecord: ArticleRecord = { ...record, guid };
        const existing = migrated[guid];
        if (
            !existing
            || new Date(normalizedRecord.firstSeenISO).getTime()
                < new Date(existing.firstSeenISO).getTime()
        ) {
            migrated[guid] = normalizedRecord;
        }
    }

    return migrated;
}

export async function stabiliseDates(
    registryUrl: string,
    articleBaseUrl: string,
    items: RSSItem[]
): Promise<RSSItem[]> {
    const registry = migrateRegistry(
        await loadRegistry(registryUrl),
        articleBaseUrl
    );
    const nowRFC822 = new Date().toUTCString();
    let newArticles = 0;
    let reusedDates = 0;

    const stabilised = items.map((item) => {
        const link = normalizeArticleUrl(item.link, articleBaseUrl);
        if (!link) return item;
        const existing = registry[link];
        if (existing) {
            reusedDates++;
            return {
                ...item,
                link,
                guid: link,
                pubDate: existing.pubDate,
            };
        }

        const pubDate = item.pubDate && item.pubDate !== "NO_DATE_FOUND"
            ? item.pubDate
            : nowRFC822;
        registry[link] = {
            guid: link,
            pubDate,
            firstSeenISO: new Date().toISOString(),
            title: item.title,
        };
        newArticles++;
        return { ...item, link, guid: link, pubDate };
    });

    await saveRegistry(registryUrl, registry);
    console.log(
        `[DateStab] ${registryUrl}: ${newArticles} new, `
        + `${reusedDates} reused, ${Object.keys(registry).length} tracked`
    );
    return stabilised;
}
