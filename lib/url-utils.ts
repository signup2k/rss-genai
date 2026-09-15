const TRACKING_PARAM_NAMES = new Set([
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
]);

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
