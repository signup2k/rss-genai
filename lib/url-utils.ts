const TRACKING_PARAM_NAMES = new Set([
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
]);

const DEUTSCHE_BANK_RESEARCH_HOME =
    "https://equityview.research.db.com/PROD/IE-PROD/Deutsche_Bank_Research_Institute/HOME.alias";

function normalizedHostname(value: string): string {
    return value.toLowerCase().replace(/^www\./, "");
}

function isTrackingParam(name: string): boolean {
    const normalized = name.toLowerCase();
    return normalized.startsWith("utm_") || TRACKING_PARAM_NAMES.has(normalized);
}

function cleanUrl(url: URL): URL {
    url.hash = "";
    url.username = "";
    url.password = "";

    if (
        (url.protocol === "https:" && url.port === "443")
        || (url.protocol === "http:" && url.port === "80")
    ) {
        url.port = "";
    }

    for (const name of [...url.searchParams.keys()]) {
        if (isTrackingParam(name)) {
            url.searchParams.delete(name);
        }
    }

    return url;
}

export function parseTargetUrl(value: string): URL {
    const url = new URL(value);
    if (
        (url.protocol !== "http:" && url.protocol !== "https:")
        || !url.hostname
        || url.username
        || url.password
    ) {
        throw new Error("Target URL must be a public http(s) URL without embedded credentials");
    }
    return cleanUrl(url);
}

export function rewriteLegacyTargetUrl(value: string): string {
    const url = parseTargetUrl(value);
    if (
        normalizedHostname(url.hostname) === "dbresearch.com"
        && url.pathname.toLowerCase() === "/prod/ie-prod/home.alias"
    ) {
        return DEUTSCHE_BANK_RESEARCH_HOME;
    }
    return url.href;
}

export function normalizeArticleUrl(
    rawValue: string,
    targetValue: string,
    allowedHosts?: Iterable<string>
): string | null {
    try {
        const targetUrl = parseTargetUrl(targetValue);
        const url = cleanUrl(new URL(rawValue, targetUrl));
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;

        const targetHost = normalizedHostname(targetUrl.hostname);
        const allowed = new Set(
            [...(allowedHosts || [targetHost])].map(normalizedHostname)
        );
        const articleHost = normalizedHostname(url.hostname);
        if (!allowed.has(articleHost)) return null;

        if (targetUrl.protocol === "https:" && url.protocol === "http:") {
            url.protocol = "https:";
        }

        return url.href;
    } catch {
        return null;
    }
}

export function canonicalArticleUrl(value: string, targetValue?: string): string {
    try {
        const url = targetValue
            ? new URL(normalizeArticleUrl(value, targetValue) || value)
            : cleanUrl(new URL(value));
        const pathname = url.pathname.replace(/\/+$/, "") || "/";
        return `${normalizedHostname(url.hostname)}${pathname}${url.search}`;
    } catch {
        return value.trim();
    }
}

export function collectSourceArticleUrls(
    content: string,
    targetValue: string,
    limit = 2_000
): string[] {
    const urls = new Map<string, string>();
    const patterns = [
        /\[!\[[^\]]*\]\([^)]+\)[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
        /(?<!!)\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    ];

    for (const pattern of patterns) {
        for (const match of content.matchAll(pattern)) {
            const normalized = normalizeArticleUrl(match[1], targetValue);
            if (
                !normalized
                || /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|\?)/i.test(normalized)
            ) {
                continue;
            }
            urls.set(canonicalArticleUrl(normalized), normalized);
            if (urls.size >= limit) return [...urls.values()];
        }
    }

    return [...urls.values()];
}
