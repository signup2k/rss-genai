import type { FeedRuleV1 } from "@/lib/rule-schema";

export const manInsightsRule: FeedRuleV1 = {
    version: 1,
    id: "man-insights",
    name: "Man Insights",
    source: {
        url: "https://www.man.com/insights",
        itemSelector: ".views-content-content-blocks .card > a[href*='/insights/']",
        allowedArticleHosts: ["man.com"],
        form: {
            selector: "#mangroup-digital-attestation-form",
            fields: {
                regions: "AM",
                country_mobile_AM: "237",
                country_AM: "237",
                investor_type: "2",
                remember: "1",
                selected_country: "237",
                op: "Accept",
            },
        },
    },
    feed: {
        title: "Man Insights",
        description: "Latest investment research and market views from Man Group",
    },
    fields: {
        title: { selector: ".card-body h5" },
        link: { attribute: "href" },
        description: { selector: ".card-body > span" },
        categories: { selector: ".bg-primary > span:first-child" },
    },
    fulltext: {
        selector: "#article-body-text",
    },
    assertions: {
        minItems: 5,
        linkPattern: "^https://www\\.man\\.com/insights/[^/?#]+$",
    },
};
