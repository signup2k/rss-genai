import assert from "node:assert/strict";
import test from "node:test";

import { extractFeedFromHtml, unwrapTransportBody } from "../lib/rule-engine";
import { citadelMarketInsightsRule } from "../rules/citadel-market-insights";

const item = (slug: string, title: string, date: string) => `
  <item>
    <title>${title}</title>
    <link>https://www.citadelsecurities.com/news-and-insights/${slug}/</link>
    <pubDate>${date}</pubDate>
    <category><![CDATA[Market Insights]]></category>
    <description><![CDATA[<p>WordPress boilerplate is intentionally not used as the summary.</p>]]></description>
  </item>`;

const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Markets News &amp; Insights | Citadel Securities</title>
    ${item("macro-thoughts/one", "First Market Insight", "Sat, 12 Sep 2026 16:52:41 +0000")}
    ${item("macro-thoughts/two", "Second Market Insight", "Sat, 05 Sep 2026 16:20:07 +0000")}
    ${item("global-market-intelligence/three", "Third Market Insight", "Mon, 31 Aug 2026 19:15:54 +0000")}
    ${item("global-macro-strategy/four", "Fourth Market Insight", "Mon, 24 Aug 2026 15:28:36 +0000")}
    ${item("macro-thoughts/five", "Fifth Market Insight", "Tue, 18 Aug 2026 20:45:02 +0000")}
  </channel>
</rss>`;

test("Citadel's native XML feed satisfies its harness candidate", () => {
    const feed = extractFeedFromHtml(citadelMarketInsightsRule, fixture, 10);
    assert.equal(feed.items.length, 5);
    assert.equal(feed.items[0].title, "First Market Insight");
    assert.equal(feed.items[0].link, "https://www.citadelsecurities.com/news-and-insights/macro-thoughts/one/");
    assert.equal(feed.items[0].pubDate, "Sat, 12 Sep 2026 16:52:41 GMT");
    assert.deepEqual(feed.items[0].categories, ["Market Insights"]);
    // No description field is configured because WordPress emits boilerplate.
    assert.equal(feed.items[0].description, "First Market Insight");
});

test("Jina transport unwraps the native XML body without rewriting it", () => {
    const envelope = `Title: Markets News & Insights | Citadel Securities
URL Source: ${citadelMarketInsightsRule.source.url}
Published Time: Wed, 16 Sep 2026 00:22:34 GMT

Markdown Content:
${fixture}`;
    assert.equal(unwrapTransportBody(citadelMarketInsightsRule, envelope), fixture);
});
