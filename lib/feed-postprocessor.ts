import { loadRegistry, saveRegistry, type ArticleRecord, type UrlRegistry } from "@/lib/storage";
import { normalizeArticleUrl } from "@/lib/url-utils";
import type { RSSItem } from "@/lib/xml-builder";

function migrateRegistry(registry: UrlRegistry, articleBaseUrl: string): UrlRegistry {
    const migrated: UrlRegistry = {};
    for (const record of Object.values(registry)) {
        const guid = normalizeArticleUrl(record.guid, articleBaseUrl) || record.guid;
        const normalized: ArticleRecord = { ...record, guid };
        const existing = migrated[guid];
        if (!existing || new Date(normalized.firstSeenISO) < new Date(existing.firstSeenISO)) {
            migrated[guid] = normalized;
        }
    }
    return migrated;
}

export async function stabiliseDates(
    registryKey: string,
    articleBaseUrl: string,
    items: RSSItem[]
): Promise<RSSItem[]> {
    const registry = migrateRegistry(await loadRegistry(registryKey), articleBaseUrl);
    const now = new Date();
    const nowRFC822 = now.toUTCString();

    const stabilised = items.map((item) => {
        const link = normalizeArticleUrl(item.link, articleBaseUrl) || item.link;
        const existing = registry[link];
        if (existing) return { ...item, link, guid: link, pubDate: existing.pubDate };

        const pubDate = item.pubDate && item.pubDate !== "NO_DATE_FOUND"
            ? item.pubDate
            : nowRFC822;
        registry[link] = {
            guid: link,
            pubDate,
            firstSeenISO: now.toISOString(),
            title: item.title,
        };
        return { ...item, link, guid: link, pubDate };
    });
    await saveRegistry(registryKey, registry);
    return stabilised;
}
