import type { RSSFeedData, RSSItem } from "@/lib/xml-builder";

export type ExtractionMode = "llm" | "deterministic" | "auto" | "shadow";

export interface DeterministicExtractionResult {
    feedData: RSSFeedData;
    confidence: number;
    candidateCount: number;
    selectedFamily: string;
    reasons: string[];
}

interface LinkCandidate {
    position: number;
    rawTitle: string;
    title: string;
    url: URL;
    family: string;
    pubDate: string;
}

const MIN_TITLE_LENGTH = 12;
const MIN_CONFIDENT_ITEMS = 3;
const UI_LABEL_PATTERN = /^(?:home|news|blog|read more|view all|learn more|skip to content|watch live|live|business|technology|health|culture|sport|football|audio|video|contact us|log in|menu|docs|showcase|templates|enterprise|learn|subscribe)$/i;
const EXCLUDED_PATH_PATTERN = /(?:^|\/)(?:login|contact|privacy|terms|about|category|tag|author|search|subscribe)(?:\/|$)/i;
const ASSET_PATH_PATTERN = /\.(?:avif|gif|jpe?g|pdf|png|svg|webp)(?:$|\?)/i;
const ARTICLE_PATH_PATTERN = /\/(?:articles?|blog|capital-market-outlook|index|news|posts?|stories?)(?:\/|$)/i;
const DATE_PATTERN = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+20\d{2}|20\d{2}[-/]\d{1,2}[-/]\d{1,2}/i;
const DATE_GLOBAL_PATTERN = new RegExp(DATE_PATTERN.source, "gi");
const MARKDOWN_LINK_PATTERN = /(?<!!)\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function cleanMarkdownText(value: string): string {
    return value
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
        .replace(/[*_`#]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanTitle(rawTitle: string): string {
    let title = cleanMarkdownText(rawTitle)
        .replace(/^\d+\s+(?=[A-Z])/u, "")
        .split(/\s+In this issue:/i)[0]
        .trim();

    const dateMatch = title.match(DATE_PATTERN);
    if (dateMatch?.index !== undefined) {
        const beforeDate = title.slice(0, dateMatch.index)
            .trim()
            .replace(/(?:Company|Engineering|Product|Research|Safety)$/i, "")
            .trim();
        if (beforeDate.length >= MIN_TITLE_LENGTH) {
            title = beforeDate;
        }
    }

    return title.slice(0, 240).trim();
}

function normalizeFamily(pathname: string): string {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length < 2) return "";

    const directory = segments.slice(0, -1).filter((segment) => {
        return !/^(?:19|20)\d{2}$/.test(segment) && !/^\d{1,2}$/.test(segment);
    });
    return directory.length ? `/${directory.join("/")}` : "";
}

function parseDate(value: string): string {
    const normalized = value.replace(/(\d)(?:st|nd|rd|th)/i, "$1");
    const dateOnly = DATE_PATTERN.test(normalized);
    const parsed = new Date(dateOnly && !/^\d{4}[-/]/.test(normalized)
        ? `${normalized} 00:00:00 GMT`
        : normalized);
    return Number.isNaN(parsed.getTime()) ? "NO_DATE_FOUND" : parsed.toUTCString();
}

function dateFromUrl(url: URL): string {
    const namedDate = url.pathname.match(
        /(?:^|[-/])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/](\d{1,2})[-/](20\d{2})(?:[./-]|$)/i
    );
    if (namedDate) {
        return parseDate(`${namedDate[1]} ${namedDate[2]}, ${namedDate[3]}`);
    }

    const numericDate = url.pathname.match(/(?:^|\/)(20\d{2})[/-](\d{1,2})[/-](\d{1,2})(?:\/|$)/);
    if (numericDate) {
        return parseDate(`${numericDate[1]}-${numericDate[2]}-${numericDate[3]}`);
    }
    return "NO_DATE_FOUND";
}

function extractDate(markdown: string, position: number, rawTitle: string, url: URL): string {
    const titleDate = rawTitle.match(DATE_PATTERN)?.[0];
    if (titleDate) return parseDate(titleDate);

    const urlDate = dateFromUrl(url);
    if (urlDate !== "NO_DATE_FOUND") return urlDate;

    const precedingLines = markdown
        .slice(Math.max(0, position - 400), position)
        .split("\n")
        .map((line) => cleanMarkdownText(line))
        .filter(Boolean)
        .slice(-4)
        .reverse();

    for (const line of precedingLines) {
        const dates = line.match(DATE_GLOBAL_PATTERN);
        if (dates?.length === 1 && line.length <= 40) {
            return parseDate(dates[0]);
        }
    }
    return "NO_DATE_FOUND";
}

function isArticleCandidate(title: string, url: URL, targetUrl: URL): boolean {
    if (
        title.length < MIN_TITLE_LENGTH
        || UI_LABEL_PATTERN.test(title)
        || ASSET_PATH_PATTERN.test(url.pathname)
        || EXCLUDED_PATH_PATTERN.test(url.pathname)
    ) {
        return false;
    }

    const sameHost = url.hostname.replace(/^www\./, "") === targetUrl.hostname.replace(/^www\./, "");
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const permalinkLike = ARTICLE_PATH_PATTERN.test(url.pathname)
        || pathSegments.length >= 2
        || /[-/]\d{6,}/.test(url.pathname);
    return sameHost && permalinkLike;
}

function pageTitle(markdown: string, targetUrl: URL): string {
    const metadataTitle = markdown.match(/^Title:\s*(.+)$/m)?.[1];
    return cleanMarkdownText(metadataTitle || targetUrl.hostname);
}

export function parseExtractionMode(value: string | null): ExtractionMode {
    if (value === "deterministic" || value === "auto" || value === "shadow") {
        return value;
    }
    return "llm";
}

export function extractFeedDeterministically(
    target: string,
    markdown: string,
    limit: number
): DeterministicExtractionResult {
    const targetUrl = new URL(target);
    const candidates: LinkCandidate[] = [];
    const candidatesByUrl = new Map<string, LinkCandidate>();

    for (const match of markdown.matchAll(MARKDOWN_LINK_PATTERN)) {
        const rawTitle = cleanMarkdownText(match[1]);
        const title = cleanTitle(rawTitle);
        let url: URL;
        try {
            url = new URL(match[2], targetUrl);
            url.hash = "";
        } catch {
            continue;
        }

        if (!isArticleCandidate(title, url, targetUrl)) {
            continue;
        }

        const family = normalizeFamily(url.pathname);
        if (!family) continue;
        const existing = candidatesByUrl.get(url.href);
        if (existing) {
            if (
                existing.title.length > 120
                && title.length >= 20
                && title.length < existing.title.length
            ) {
                existing.rawTitle = rawTitle;
                existing.title = title;
            }
            continue;
        }

        const candidate = {
            position: match.index,
            rawTitle,
            title,
            url,
            family,
            pubDate: extractDate(markdown, match.index, rawTitle, url),
        };
        candidates.push(candidate);
        candidatesByUrl.set(url.href, candidate);
    }

    const familyCounts = new Map<string, number>();
    for (const candidate of candidates) {
        familyCounts.set(candidate.family, (familyCounts.get(candidate.family) || 0) + 1);
    }
    const [selectedFamily = "", familyCount = 0] = [...familyCounts.entries()]
        .sort((left, right) => right[1] - left[1])[0] || [];

    const selected = candidates
        .filter((candidate) => candidate.family === selectedFamily)
        .sort((left, right) => left.position - right.position)
        .slice(0, limit);

    const items: RSSItem[] = selected.map((candidate) => ({
        title: candidate.title,
        link: candidate.url.href,
        guid: candidate.url.href,
        description: candidate.title,
        pubDate: candidate.pubDate,
        categories: [],
    }));

    const requiredItems = Math.min(MIN_CONFIDENT_ITEMS, limit);
    const countScore = Math.min(items.length / Math.max(requiredItems, 1), 1);
    const dominanceScore = candidates.length ? familyCount / candidates.length : 0;
    const datedItems = items.filter((item) => item.pubDate !== "NO_DATE_FOUND").length;
    const dateScore = items.length ? datedItems / items.length : 0;
    const confidence = Number(
        (countScore * 0.55 + Math.min(dominanceScore, 1) * 0.35 + dateScore * 0.1).toFixed(3)
    );

    const reasons = [
        `${candidates.length} article-like links`,
        `${familyCount} links in dominant family ${selectedFamily || "(none)"}`,
        `${datedItems}/${items.length} selected items have dates`,
    ];

    return {
        feedData: {
            channel: {
                title: pageTitle(markdown, targetUrl),
                link: targetUrl.href,
                description: `Updates from ${targetUrl.hostname}`,
            },
            items,
        },
        confidence,
        candidateCount: candidates.length,
        selectedFamily,
        reasons,
    };
}
