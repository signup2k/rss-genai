import type { FeedRuleV1 } from "@/lib/rule-schema";

export const dbResearchRule: FeedRuleV1 = {
    version: 1,
    id: "db-research",
    name: "Deutsche Bank Research",
    source: {
        url: "https://www.dbresearch.com/PROD/IE-PROD/Deutsche_Bank_Research_Institute/HOME.alias",
        transport: "direct",
        format: "html",
        // The home page has separate visual sections. Restrict the feed to
        // document rows so podcasts and audio players are not mixed in.
        itemSelector: 'article[data-reweb-type="docu"]',
        allowedArticleHosts: ["dbresearch.com"],
    },
    feed: {
        title: "Deutsche Bank Research",
        description: "Latest research publications from Deutsche Bank Research",
    },
    fields: {
        title: { selector: "h2 a" },
        link: { selector: "h2 a", attribute: "href" },
        description: { selector: '[class$="-teaser"]' },
        date: { selector: '[class$="-date"]' },
        categories: { selector: ".rfrwd-topic-value a" },
    },
    assertions: {
        minItems: 5,
        linkPattern: "^https://www\\.dbresearch\\.com/PROD/IE-PROD/PROD[0-9]+/[^?#]+$",
    },
};
