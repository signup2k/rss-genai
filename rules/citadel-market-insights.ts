import type { FeedRuleV1 } from "@/lib/rule-schema";

export const citadelMarketInsightsRule: FeedRuleV1 = {
    version: 1,
    id: "citadel-market-insights",
    name: "Citadel Securities Market Insights",
    source: {
        // The site publishes a first-party WordPress RSS feed. XML is both
        // smaller and more stable than scraping the visual archive cards.
        url: "https://www.citadelsecurities.com/news-and-insights/category/market-insights/feed/",
        transport: "jina",
        format: "xml",
        itemSelector: "item",
        allowedArticleHosts: ["citadelsecurities.com"],
    },
    feed: {
        title: "Citadel Securities Market Insights",
        description: "Market insights from Citadel Securities",
    },
    fields: {
        title: { selector: "title" },
        link: { selector: "link" },
        date: { selector: "pubDate" },
        categories: { selector: "category" },
    },
    assertions: {
        minItems: 5,
        linkPattern: "^https://www\\.citadelsecurities\\.com/news-and-insights/[^?#]+/?$",
    },
};
