import { type SiteSelectors } from "@/lib/site-selectors";

export const DEFAULT_SITE_CONFIGS: Record<string, SiteSelectors> = {
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
