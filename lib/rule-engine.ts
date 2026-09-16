import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import makeFetchCookie from "fetch-cookie";

import type { FeedRuleV1, RuleField } from "@/lib/rule-schema";
import { canonicalArticleUrl, normalizeArticleUrl } from "@/lib/url-utils";
import type { RSSFeedData, RSSItem } from "@/lib/xml-builder";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 5_000_000;

function cleanText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function selection($: CheerioAPI, item: Cheerio<AnyNode>, field: RuleField): Cheerio<AnyNode> {
    return field.selector ? item.find(field.selector).first() : item;
}

function fieldValue($: CheerioAPI, item: Cheerio<AnyNode>, field?: RuleField): string {
    if (!field) return "";
    const node = selection($, item, field);
    if (!node.length) return "";
    if (field.attribute) return cleanText(node.attr(field.attribute) || "");
    if (field.format === "html") return (node.html() || "").trim();
    return cleanText(node.text());
}

function parseDate(value: string): string {
    if (!value) return "NO_DATE_FOUND";
    // A page-local date such as "September 15, 2026" has no timezone. Treat
    // it as UTC midnight instead of letting the server's local timezone move
    // it to the previous calendar day.
    const dateOnly = /^\s*(?:[A-Za-z]+ \d{1,2}, \d{4}|\d{1,2} [A-Za-z]+ \d{4})\s*$/.test(value);
    const date = new Date(dateOnly ? `${value.trim()} UTC` : value);
    return Number.isNaN(date.getTime()) ? "NO_DATE_FOUND" : date.toUTCString();
}

function absolutizeHtml(fragment: string, baseUrl: string): string {
    if (!fragment) return "";
    const $ = load(fragment, null, false);
    $("a[href], img[src], source[src]").each((_, element) => {
        for (const attribute of ["href", "src"] as const) {
            const value = $(element).attr(attribute);
            if (!value) continue;
            try {
                $(element).attr(attribute, new URL(value, baseUrl).href);
            } catch {
                // Leave malformed non-navigation attributes unchanged.
            }
        }
    });
    return $.html();
}

export function unwrapTransportBody(rule: FeedRuleV1, body: string): string {
    if (rule.source.transport !== "jina") return body;
    const marker = "Markdown Content:";
    const markerIndex = body.indexOf(marker);
    if (markerIndex < 0) throw new Error("Jina response did not contain Markdown Content");
    const content = body.slice(markerIndex + marker.length).trim();
    if (!content) throw new Error("Jina response contained empty content");
    return content;
}

export function extractFeedFromHtml(
    rule: FeedRuleV1,
    html: string,
    limit = 10
): RSSFeedData {
    const $ = load(html, rule.source.format === "xml" ? { xmlMode: true } : undefined);
    const items: RSSItem[] = [];
    const seen = new Set<string>();
    const allowedHosts = rule.source.allowedArticleHosts || [new URL(rule.source.url).hostname];
    const allowAnyHost = allowedHosts.includes("*");
    const linkPattern = rule.assertions?.linkPattern
        ? new RegExp(rule.assertions.linkPattern)
        : null;

    $(rule.source.itemSelector).each((_, element) => {
        if (items.length >= limit) return false;
        const item = $(element);
        const title = fieldValue($, item, rule.fields.title);
        const rawLink = fieldValue(
            $,
            item,
            rule.fields.link.selector
                ? rule.fields.link
                : { attribute: "href", ...rule.fields.link }
        );
        let link: string | null = null;
        if (allowAnyHost) {
            try {
                const resolved = new URL(rawLink, rule.source.url);
                link = ["http:", "https:"].includes(resolved.protocol) ? resolved.href : null;
            } catch {
                link = null;
            }
        } else {
            link = normalizeArticleUrl(rawLink, rule.source.url, allowedHosts);
        }
        if (!title || !link || (linkPattern && !linkPattern.test(link))) return;
        const identity = canonicalArticleUrl(link);
        if (seen.has(identity)) return;

        const rawDescription = fieldValue($, item, rule.fields.description);
        const description = rule.fields.description?.format === "html"
            ? absolutizeHtml(rawDescription, rule.source.url)
            : rawDescription;
        const categories = rule.fields.categories
            ? item.find(rule.fields.categories.selector || "").map((__, category) => (
                cleanText(rule.fields.categories?.attribute
                    ? $(category).attr(rule.fields.categories.attribute) || ""
                    : $(category).text())
            )).get().filter(Boolean)
            : [];
        items.push({
            title,
            link,
            guid: link,
            description: description || title,
            pubDate: parseDate(fieldValue($, item, rule.fields.date)),
            categories,
        });
        seen.add(identity);
    });

    const minimum = Math.min(rule.assertions?.minItems || 1, limit);
    if (items.length < minimum) {
        throw new Error(`Rule ${rule.id} extracted ${items.length} items; expected at least ${minimum}`);
    }
    return {
        channel: {
            title: rule.feed.title,
            link: rule.source.url,
            description: rule.feed.description,
        },
        items,
    };
}

export interface RuleSession {
    html: string;
    fetcher: typeof fetch;
}

export async function openRuleSession(rule: FeedRuleV1): Promise<RuleSession> {
    const fetchWithCookies = makeFetchCookie(fetch);
    const requestUrl = rule.source.transport === "jina"
        ? `https://r.jina.ai/${rule.source.url}`
        : rule.source.url;
    let response = await fetchWithCookies(requestUrl, {
        headers: {
            Accept: rule.source.transport === "jina"
                ? "text/plain"
                : "text/html,application/xhtml+xml",
            "User-Agent": "rss-rules/1.0 (+personal feed generator)",
        },
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    if (rule.source.form) {
        const initialHtml = await response.text();
        const $ = load(initialHtml);
        const form = $(rule.source.form.selector).first();
        if (!form.length) throw new Error(`Session form not found: ${rule.source.form.selector}`);
        const body = new URLSearchParams();
        form.find("input[name], select[name], textarea[name]").each((_, element) => {
            const field = $(element);
            const name = field.attr("name");
            if (!name || name in rule.source.form!.fields) return;
            const type = (field.attr("type") || "").toLowerCase();
            if (["submit", "button", "file", "reset"].includes(type)) return;
            if ((type === "checkbox" || type === "radio") && !field.is(":checked")) return;
            if (element.tagName === "select") {
                const selected = field.find("option:selected").first();
                body.set(name, selected.attr("value") || selected.text());
            } else {
                body.set(name, field.attr("value") || field.text());
            }
        });
        for (const [name, value] of Object.entries(rule.source.form.fields)) body.set(name, value);
        const action = new URL(form.attr("action") || rule.source.url, rule.source.url).href;
        response = await fetchWithCookies(action, {
            method: (form.attr("method") || "post").toUpperCase(),
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "rss-rules/1.0 (+personal feed generator)",
            },
            body,
            redirect: "follow",
            cache: "no-store",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`Session form returned HTTP ${response.status}`);
    }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_HTML_BYTES) throw new Error("Source document is too large");
    const rawBody = await response.text();
    if (Buffer.byteLength(rawBody) > MAX_HTML_BYTES) throw new Error("Source document is too large");
    const html = unwrapTransportBody(rule, rawBody);
    if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error("Source document is too large");
    return { html, fetcher: fetchWithCookies };
}

export async function fetchRuleSource(rule: FeedRuleV1): Promise<string> {
    return (await openRuleSession(rule)).html;
}

export async function fetchArticleFulltext(
    rule: FeedRuleV1,
    item: RSSItem,
    fetcher: typeof fetch = fetch
): Promise<RSSItem> {
    if (!rule.fulltext) return item;
    try {
        const response = await fetcher(item.link, {
            headers: { "User-Agent": "rss-rules/1.0 (+personal feed generator)" },
            redirect: "follow",
            cache: "no-store",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) return item;
        const html = await response.text();
        if (Buffer.byteLength(html) > MAX_HTML_BYTES) return item;
        const $ = load(html);
        const content = $(rule.fulltext.selector).first();
        for (const selector of rule.fulltext.remove || []) content.find(selector).remove();
        const value = absolutizeHtml(content.html() || "", item.link);
        return value ? { ...item, content: value } : item;
    } catch {
        return item;
    }
}
