import { stabiliseDates } from "@/lib/feed-postprocessor";
import { extractFeedFromHtml, fetchArticleFulltext, openRuleSession } from "@/lib/rule-engine";
import type { FeedRuleV1 } from "@/lib/rule-schema";
import type { RSSFeedData } from "@/lib/xml-builder";

export async function generateFeed(
    rule: FeedRuleV1,
    limit: number,
    fulltext: boolean
): Promise<RSSFeedData> {
    const session = await openRuleSession(rule);
    const extracted = extractFeedFromHtml(rule, session.html, limit);
    const items = await stabiliseDates(`rule:${rule.id}`, rule.source.url, extracted.items);
    const outputItems = fulltext && rule.fulltext
        ? await Promise.all(items.map((item) => fetchArticleFulltext(rule, item, session.fetcher)))
        : items;
    return { ...extracted, items: outputItems };
}
