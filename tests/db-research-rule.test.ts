import assert from "node:assert/strict";
import test from "node:test";

import { extractFeedFromHtml } from "../lib/rule-engine";
import { dbResearchRule } from "../rules/db-research";

const fixture = `
<main>
  <section class="ipl-section ipl-section-featured">
    <article data-reweb-type="docu">
      <div class="RWTAB-title"><h2><a href="/PROD/IE-PROD/PROD0000000000652105/AI_doom%3A_A_brief_history.pdf">AI doom: A brief history of bad tech predictions</a></h2></div>
      <div class="RWTAB-date">September 15, 2026</div>
      <div class="RWTAB-teaser">Pioneering technologist Bob Metcalfe was not the first visionary to eat his words.</div>
      <div class="rfrwd-topic-value"><a href="/PROD/IE-PROD/RI_TEC.alias">Technology</a></div>
      <div class="rfrwd-topic-value"><a href="/PROD/IE-PROD/RI_FEA.alias">Featured Research</a></div>
    </article>
    <article data-reweb-type="docu">
      <div class="RWTAB-title"><h2><a href="/PROD/IE-PROD/PROD0000000000647613/Infrastructure_investment.pdf">Infrastructure investment and private capital: A perfect match?</a></h2></div>
      <div class="RWTAB-date">September 8, 2026</div>
      <div class="RWTAB-teaser">Germany needs greater infrastructure investment.</div>
      <div class="rfrwd-topic-value"><a href="/PROD/IE-PROD/RI_MAC.alias">Macro</a></div>
      <div class="rfrwd-topic-value"><a href="/PROD/IE-PROD/RI_GER.alias">Germany</a></div>
    </article>
    <article data-reweb-type="docu">
      <div class="RWTAB-title"><h2><a href="/PROD/IE-PROD/PROD0000000000645597/The_Hausblick.pdf">The Hausblick</a></h2></div>
      <div class="RWTAB-date">September 3, 2026</div>
      <div class="RWTAB-teaser">The German economy has proven resilient.</div>
    </article>
    <article data-reweb-type="docu">
      <div class="RWTAB-title"><h2><a href="/PROD/IE-PROD/PROD0000000000639676/China.pdf">Turning more hawkish on China – rhetoric versus action</a></h2></div>
      <div class="RWTAB-date">August 18, 2026</div>
      <div class="RWTAB-teaser">Industry sentiment towards China is turning.</div>
    </article>
    <article data-reweb-type="docu">
      <div class="RWTAB-title"><h2><a href="/PROD/IE-PROD/PROD0000000000637113/Savings.pdf">Savings &amp; Investments Union: Shifting retail savings to capital markets</a></h2></div>
      <div class="RWTAB-date">August 12, 2026</div>
      <div class="RWTAB-teaser">Europe needs more long-term capital.</div>
    </article>
  </section>
  <article data-reweb-type="podcast">
    <div class="RWTAB-title"><h2><a href="/podcast.mp3">Do not include audio</a></h2></div>
  </article>
</main>`;

test("Deutsche Bank Research fixture satisfies its deterministic rule", () => {
    const feed = extractFeedFromHtml(dbResearchRule, fixture, 10);
    assert.equal(feed.items.length, 5);
    assert.equal(feed.items[0].title, "AI doom: A brief history of bad tech predictions");
    assert.equal(
        feed.items[0].link,
        "https://www.dbresearch.com/PROD/IE-PROD/PROD0000000000652105/AI_doom%3A_A_brief_history.pdf"
    );
    assert.equal(feed.items[0].pubDate, "Tue, 15 Sep 2026 00:00:00 GMT");
    assert.equal(feed.items[0].description, "Pioneering technologist Bob Metcalfe was not the first visionary to eat his words.");
    assert.deepEqual(feed.items[0].categories, ["Technology", "Featured Research"]);
    assert.equal(feed.items[2].description, "The German economy has proven resilient.");
});
