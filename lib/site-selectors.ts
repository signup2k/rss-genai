import { loadGlobalSiteConfigs } from "@/lib/storage";
import { DEFAULT_SITE_CONFIGS } from "@/lib/default-configs";

export interface SiteSelectors {
    targetSelector?: string;
    removeSelector?: string;
    waitForSelector?: string;
}

/**
 * Get selectors based on the URL's hostname, merging global configs from DB with default fallbacks.
 */
export async function getSiteSelectors(url: string): Promise<SiteSelectors> {
    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname;
        
        // Remove 'www.' prefix if exists to match our config
        if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
        }

        const globalConfigs = await loadGlobalSiteConfigs();
        
        // User configured settings take precedence over default configs
        const userConfig = globalConfigs[hostname];
        const defaultConfig = DEFAULT_SITE_CONFIGS[hostname];

        return userConfig || defaultConfig || {};
    } catch (e) {
        // If URL parsing fails, just return empty config
        return {};
    }
}

/**
 * Merge API provided selectors with predefined ones and defaults.
 * Priority: API Params > DB Config > Default Config > Default Fallback String
 */
export async function resolveSelectors(url: string, apiParams: Partial<SiteSelectors>): Promise<SiteSelectors> {
    const predefined = await getSiteSelectors(url);
    
    return {
        // Target Selector: API param or predefined config
        targetSelector: apiParams.targetSelector || predefined.targetSelector,
        
        // Remove Selector: API param, predefined config, or default fallback
        removeSelector: apiParams.removeSelector || predefined.removeSelector || "header, footer, nav, .navigation, .sidebar, .menu, .ads, .social-share, .comments, #comments, .related-posts",
        
        // Wait For Selector: API param or predefined config
        waitForSelector: apiParams.waitForSelector || predefined.waitForSelector,
    };
}
