export interface ArticleCandidate {
    url: string;
    titleHint: string;
    sourceBlock: string;
}

export interface CandidateExtractionResult {
    adapter: string;
    supported: boolean;
    candidates: ArticleCandidate[];
}

interface LinkMatch {
    title: string;
    url: string;
    destinationTitle: string;
}

const DATE_PATTERN = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+20\d{2}|20\d{2}[-/]\d{1,2}[-/]\d{1,2}/i;

export function normalizeMarkdownPayload(payload: string): string {
    const trimmed = payload.trim();
    if (!trimmed.startsWith("{")) return payload;

    try {
        const parsed = JSON.parse(trimmed) as { content?: unknown };
        return typeof parsed.content === "string" ? parsed.content : payload;
    } catch {
        return payload;
    }
}

function cleanText(value: string): string {
    return value
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
        .replace(/[*_`#]/g, "")
        .replace(/\\([\\[\]])/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
}

function parseLinks(line: string): LinkMatch[] {
    const links: LinkMatch[] = [];
    const pattern = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
    for (const match of line.matchAll(pattern)) {
        links.push({
            title: cleanText(match[1]),
            url: match[2],
            destinationTitle: cleanText(match[3] || ""),
        });
    }
    return links;
}

function resolveUrl(rawUrl: string, targetUrl: URL): URL | null {
    try {
        const url = new URL(rawUrl, targetUrl);
        url.hash = "";
        return url;
    } catch {
        return null;
    }
}

function block(lines: string[], start: number, before = 1, after = 6): string {
    return lines
        .slice(Math.max(0, start - before), Math.min(lines.length, start + after + 1))
        .join("\n")
        .slice(0, 2_500);
}

function deduplicate(candidates: ArticleCandidate[], limit: number): ArticleCandidate[] {
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
        if (seen.has(candidate.url)) return false;
        seen.add(candidate.url);
        return true;
    }).slice(0, limit);
}

function bridgewaterCandidates(lines: string[], targetUrl: URL): ArticleCandidate[] {
    const candidates: ArticleCandidate[] = [];
    for (let index = 0; index < lines.length; index++) {
        for (const link of parseLinks(lines[index])) {
            const url = resolveUrl(link.url, targetUrl);
            if (!url || !url.pathname.startsWith("/research-and-insights/")) continue;
            const title = link.title || link.destinationTitle;
            if (title.length < 12) continue;

            const following = lines.slice(index + 1, index + 5).join("\n");
            if (!DATE_PATTERN.test(following)) continue;
            candidates.push({
                url: url.href,
                titleHint: title,
                sourceBlock: block(lines, index, 0, 6),
            });
        }
    }
    return candidates;
}

function csisCandidates(lines: string[], targetUrl: URL): ArticleCandidate[] {
    const candidates: ArticleCandidate[] = [];
    const contentStart = lines.findIndex((line) => /^#\s+China\s*$/i.test(line.trim()));
    for (let index = Math.max(contentStart, 0); index < lines.length; index++) {
        if (!/^###\s+\[/.test(lines[index].trim())) continue;
        for (const link of parseLinks(lines[index])) {
            const url = resolveUrl(link.url, targetUrl);
            if (
                !url
                || url.hostname.replace(/^www\./, "") !== "csis.org"
                || !/^\/(?:analysis|events|podcasts)\//.test(url.pathname)
            ) {
                continue;
            }
            candidates.push({
                url: url.href,
                titleHint: link.title || link.destinationTitle,
                sourceBlock: block(lines, index, 0, 5),
            });
        }
    }
    return candidates;
}

function dbResearchCandidates(lines: string[], targetUrl: URL): ArticleCandidate[] {
    const candidates: ArticleCandidate[] = [];
    for (let index = 0; index < lines.length; index++) {
        for (const link of parseLinks(lines[index])) {
            const url = resolveUrl(link.url, targetUrl);
            if (!url || !/\/PROD\/IE-PROD\/PROD\d+/i.test(decodeURIComponent(url.pathname))) {
                continue;
            }

            const nearbyHeading = lines
                .slice(index, index + 8)
                .map((line) => line.match(/^#{1,4}\s+\[?([^\]]+)/)?.[1])
                .find(Boolean);
            const title = link.title || link.destinationTitle || cleanText(nearbyHeading || "");
            candidates.push({
                url: url.href,
                titleHint: title,
                sourceBlock: block(lines, index, 3, 7),
            });
        }
    }
    return candidates.sort((left, right) => {
        const leftDate = left.sourceBlock.match(DATE_PATTERN)?.[0];
        const rightDate = right.sourceBlock.match(DATE_PATTERN)?.[0];
        const leftTime = leftDate ? new Date(leftDate).getTime() : 0;
        const rightTime = rightDate ? new Date(rightDate).getTime() : 0;
        return rightTime - leftTime;
    });
}

function morganStanleyCandidates(lines: string[], targetUrl: URL): ArticleCandidate[] {
    const candidates: ArticleCandidate[] = [];
    const nestedCard = /^\[!\[[^\]]*\]\([^)]+\)\s*(.*?)\]\((https?:\/\/[^)]+)\)\s*$/;
    for (let index = 0; index < lines.length; index++) {
        const match = lines[index].match(nestedCard);
        const links = match
            ? [{ title: cleanText(match[1]), url: match[2], destinationTitle: "" }]
            : parseLinks(lines[index]);
        for (const link of links) {
            const url = resolveUrl(link.url, targetUrl);
            if (
                !url
                || !url.pathname.includes("/individual-investor/insights/")
                || url.pathname.includes("/insights/series/")
                || url.pathname.endsWith("/all-insights.html")
            ) {
                continue;
            }
            const title = link.title || link.destinationTitle;
            if (title.length < 12) continue;
            candidates.push({
                url: url.href,
                titleHint: title.slice(0, 300),
                sourceBlock: block(lines, index, 0, 1),
            });
        }
    }
    return candidates;
}

function citadelCandidates(lines: string[], targetUrl: URL): ArticleCandidate[] {
    const candidates: ArticleCandidate[] = [];
    for (let index = 0; index < lines.length; index++) {
        const emptyLink = lines[index].match(/^\[\]\((https?:\/\/[^)]+)\)\s*$/);
        if (!emptyLink) continue;
        const url = resolveUrl(emptyLink[1], targetUrl);
        if (
            !url
            || !url.pathname.startsWith("/news-and-insights/")
            || url.pathname.includes("/category/")
        ) {
            continue;
        }

        const titleLine = lines.slice(index + 1, index + 6)
            .find((line) => /^##\s+\S/.test(line.trim()));
        const title = cleanText(titleLine || "");
        if (!title) continue;
        candidates.push({
            url: url.href,
            titleHint: title,
            sourceBlock: block(lines, index, 0, 6),
        });
    }
    return candidates;
}

export function extractArticleCandidates(
    target: string,
    markdownPayload: string,
    limit: number
): CandidateExtractionResult {
    const markdown = normalizeMarkdownPayload(markdownPayload);
    const targetUrl = new URL(target);
    const hostname = targetUrl.hostname.replace(/^www\./, "");
    const lines = markdown.split("\n");

    let adapter = "";
    let candidates: ArticleCandidate[] = [];
    if (hostname === "bridgewater.com") {
        adapter = "bridgewater";
        candidates = bridgewaterCandidates(lines, targetUrl);
    } else if (hostname === "csis.org") {
        adapter = "csis";
        candidates = csisCandidates(lines, targetUrl);
    } else if (hostname === "dbresearch.com") {
        adapter = "dbresearch";
        candidates = dbResearchCandidates(lines, targetUrl);
    } else if (hostname === "morganstanley.com") {
        adapter = "morganstanley";
        candidates = morganStanleyCandidates(lines, targetUrl);
    } else if (hostname === "citadelsecurities.com") {
        adapter = "citadelsecurities";
        candidates = citadelCandidates(lines, targetUrl);
    }

    return {
        adapter,
        supported: Boolean(adapter),
        candidates: deduplicate(candidates, limit),
    };
}

export function buildCandidatePrompt(
    targetUrl: string,
    candidates: ArticleCandidate[]
): string {
    const sections = candidates.map((candidate, index) => {
        return [
            `CANDIDATE ${index + 1}`,
            `URL: ${candidate.url}`,
            `TITLE HINT: ${candidate.titleHint}`,
            "SOURCE BLOCK:",
            candidate.sourceBlock,
        ].join("\n");
    });

    return [
        `Candidate article cards extracted from ${targetUrl}.`,
        "Extract items only from these candidates. Use each exact URL; do not add other URLs.",
        "",
        ...sections,
    ].join("\n\n");
}
