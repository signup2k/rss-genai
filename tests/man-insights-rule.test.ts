import assert from "node:assert/strict";
import test from "node:test";

import { extractFeedFromHtml } from "../lib/rule-engine";
import { manInsightsRule } from "../rules/man-insights";

const card = (slug: string, title: string) => `
<div class="card">
  <a href="https://www.man.com/insights/${slug}">
    <div class="bg-primary"><span>Views From the Floor</span><span>Sep 2026</span></div>
    <div class="card-body"><h5>${title}</h5><span>${title} summary.</span></div>
  </a>
</div>`;

const fixture = `<div class="views-content-content-blocks">
  ${card("one", "First Man insight")}
  ${card("two", "Second Man insight")}
  ${card("three", "Third Man insight")}
  ${card("four", "Fourth Man insight")}
  ${card("five", "Fifth Man insight")}
</div>`;

test("Man Insights fixture satisfies its production rule", () => {
    const feed = extractFeedFromHtml(manInsightsRule, fixture, 10);
    assert.equal(feed.items.length, 5);
    assert.equal(feed.items[0].title, "First Man insight");
    assert.equal(feed.items[0].description, "First Man insight summary.");
    assert.deepEqual(feed.items[0].categories, ["Views From the Floor"]);
    assert.equal(feed.items[0].pubDate, "NO_DATE_FOUND");
});
