# RuleV1 contract

Rules are deterministic extraction instructions. A production request selects a
registered rule by `id`; callers cannot supply a URL or selectors.

```ts
{
  version: 1,
  id: "site-blog",
  name: "Site Blog",
  source: {
    url: "https://example.com/blog",
    transport: "direct", // use "jina" only when a tested proxy is required
    format: "html", // omit for HTML; use "xml" for a native XML/RSS source
    itemSelector: "article.post",
    allowedArticleHosts: ["example.com"]
  },
  feed: {
    title: "Site Blog",
    description: "Latest posts"
  },
  fields: {
    title: { selector: "h2" },
    link: { selector: "h2 a", attribute: "href" },
    description: { selector: ".summary", format: "html" },
    date: { selector: "time", attribute: "datetime" },
    categories: { selector: ".tag" }
  },
  fulltext: {
    selector: "article",
    remove: [".advertisement", ".related"]
  },
  assertions: {
    minItems: 3,
    linkPattern: "^https://example\\.com/blog/"
  }
}
```

Selectors are evaluated relative to each `itemSelector` match. A missing
`selector` reads the item itself. Fields default to normalized text; use
`format: "html"` for description HTML. Link defaults to the `href` attribute.

Article links are restricted to the source hostname unless
`allowedArticleHosts` is supplied. `"*"` permits outbound links and should only
be used for aggregator pages whose entries intentionally point off-site.

For sites with a deterministic disclosure or session form, `source.form` names
the form selector and tested field overrides. The fetcher copies hidden tokens
and default fields from the initial response, submits the form with a cookie
jar, follows redirects, and extracts from the resulting HTML. Do not use this
for login credentials or other secrets.

`source.transport: "jina"` fetches `https://r.jina.ai/<source.url>` and unwraps
the service's `Markdown Content` envelope before applying the normal extractor.
This is a transport proxy, not an LLM call in this application. Use it only
when a direct server fetch is blocked and the harness verifies the live response
shape and rate-limit behavior.

Full text is opt-in per rule and per request (`fulltext=true`). Production
fetches each selected article, keeps the first `fulltext.selector` match, and
removes the configured descendants.

The harness should reject a rule unless fixture and live tests verify item
count, unique URLs, allowed URL patterns, required fields, date parsing, and
valid RSS/Atom serialization.
