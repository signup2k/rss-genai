import assert from "node:assert/strict";
import test from "node:test";

import { extractFeedFromHtml } from "../lib/rule-engine";
import { validateRule, type FeedRuleV1 } from "../lib/rule-schema";

const rule: FeedRuleV1 = {
    version: 1,
    id: "fixture-blog",
    name: "Fixture Blog",
    source: {
        url: "https://example.com/blog/",
        itemSelector: "article",
    },
    feed: {
        title: "Fixture Blog",
        description: "Fixture updates",
    },
    fields: {
        title: { selector: "h2" },
        link: { selector: "h2 a", attribute: "href" },
        description: { selector: ".summary", format: "html" },
        date: { selector: "time", attribute: "datetime" },
        categories: { selector: ".tag" },
    },
    assertions: {
        minItems: 2,
        linkPattern: "^https://example\\.com/blog/",
    },
};

const html = `
<main>
  <article>
    <h2><a href="/blog/one"> First story </a></h2>
    <div class="summary"><img src="/one.jpg">Hello <b>world</b></div>
    <time datetime="2026-09-14"></time><span class="tag">Research</span>
  </article>
  <article>
    <h2><a href="two">Second story</a></h2>
    <div class="summary">Second summary</div>
    <time datetime="2026-09-13"></time><span class="tag">News</span>
  </article>
  <article><h2><a href="https://evil.example/post">Off-site</a></h2></article>
</main>`;

test("extracts deterministic feed items and normalizes fields", () => {
    const feed = extractFeedFromHtml(rule, html, 10);
    assert.equal(feed.items.length, 2);
    assert.equal(feed.items[0].title, "First story");
    assert.equal(feed.items[0].link, "https://example.com/blog/one");
    assert.match(feed.items[0].description, /https:\/\/example\.com\/one\.jpg/);
    assert.equal(feed.items[0].pubDate, "Mon, 14 Sep 2026 00:00:00 GMT");
    assert.deepEqual(feed.items[0].categories, ["Research"]);
    assert.equal(feed.items[1].link, "https://example.com/blog/two");
});

test("fails closed when runtime assertions are not met", () => {
    assert.throws(
        () => extractFeedFromHtml({ ...rule, assertions: { minItems: 3 } }, html, 10),
        /expected at least 3/
    );
});

test("rejects invalid rule ids and protocols", () => {
    assert.throws(() => validateRule({ ...rule, id: "Bad ID" }), /Rule id/);
    assert.throws(() => validateRule({
        ...rule,
        source: { ...rule.source, url: "file:///etc/passwd" },
    }), /http or https/);
});
