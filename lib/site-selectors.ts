export interface SiteSelectors {
    targetSelector?: string;
    removeSelector?: string;
    waitForSelector?: string;
}

// Predefined configuration, matched by domain name
const SITE_CONFIGS: Record<string, SiteSelectors> = {
    "medium.com": {
        targetSelector: "article",
        removeSelector: "header, footer, nav, .metabar, .postActions",
    },
    "github.com": {
        targetSelector: "article.markdown-body",
        removeSelector: "header, footer, nav, .flash",
    },
    "x.com": {
        waitForSelector: "article",
        removeSelector: "nav, header",
    },
    "twitter.com": {
        waitForSelector: "article",
        removeSelector: "nav, header",
    }
};

/**
 * Get predefined selectors based on the URL's hostname
 */
export function getSiteSelectors(url: string): SiteSelectors {
    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname;
        
        // Remove 'www.' prefix if exists to match our config
        if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
        }

        // Return the matched config or an empty object if no match found
        return SITE_CONFIGS[hostname] || {};
    } catch (e) {
        // If URL parsing fails, just return empty config
        return {};
    }
}

/**
 * Merge API provided selectors with predefined ones and defaults.
 * Priority: API Params > Predefined (Site Config) > Default
 */
export function resolveSelectors(url: string, apiParams: Partial<SiteSelectors>): SiteSelectors {
    const predefined = getSiteSelectors(url);
    
    return {
        // Target Selector: API param or predefined config
        targetSelector: apiParams.targetSelector || predefined.targetSelector,
        
        // Remove Selector: API param, predefined config, or default fallback
        removeSelector: apiParams.removeSelector || predefined.removeSelector || "header, footer, nav, .navigation, .sidebar, .menu, .ads, .social-share, .comments, #comments, .related-posts",
        
        // Wait For Selector: API param or predefined config
        waitForSelector: apiParams.waitForSelector || predefined.waitForSelector,
    };
}
