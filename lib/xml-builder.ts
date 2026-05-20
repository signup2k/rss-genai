// lib/xml-builder.ts
// Programmatic RSS 2.0 / Atom XML builder.
//
// Instead of letting the LLM generate raw XML (which is fragile and requires
// post-hoc sanitization), we now have the LLM output structured JSON and
// build well-formed XML here. This eliminates all XML escaping issues.

// --- Types ---

export interface RSSItem {
    title: string;
    link: string;
    guid?: string;        // defaults to link
    description: string;  // summary or full-text content
    pubDate: string;      // RFC 822 date string, or "NO_DATE_FOUND"
    categories?: string[];
    content?: string;     // full article content (when fulltext mode)
}

export interface RSSChannel {
    title: string;
    link: string;
    description: string;
}

export interface RSSFeedData {
    channel: RSSChannel;
    items: RSSItem[];
}

// --- XML Escaping ---

/** Escape text for safe inclusion in XML text nodes */
export function escapeXml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/** Wrap content in CDATA section (for HTML-heavy content like full articles) */
function wrapCDATA(str: string): string {
    // CDATA cannot contain "]]>", so split if found
    return `<![CDATA[${str.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
}

// --- Builders ---

/** Build a complete RSS 2.0 XML document from structured data */
export function buildRSS(feed: RSSFeedData): string {
    const lines: string[] = [];

    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    lines.push(`<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">`);
    lines.push(`<channel>`);
    lines.push(`  <title>${escapeXml(feed.channel.title)}</title>`);
    lines.push(`  <link>${escapeXml(feed.channel.link)}</link>`);
    lines.push(`  <description>${escapeXml(feed.channel.description)}</description>`);
    lines.push(`  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`);
    lines.push(`  <generator>RSS-GenAI</generator>`);

    for (const item of feed.items) {
        const guid = item.guid || item.link;

        lines.push(`  <item>`);
        lines.push(`    <title>${escapeXml(item.title)}</title>`);
        lines.push(`    <link>${escapeXml(item.link)}</link>`);
        lines.push(`    <guid isPermaLink="true">${escapeXml(guid)}</guid>`);

        // Description: use CDATA for full-text content, escaped text for summaries
        if (item.content) {
            // Summary in description, full text in content:encoded
            lines.push(`    <description>${escapeXml(item.description)}</description>`);
            lines.push(`    <content:encoded>${wrapCDATA(item.content)}</content:encoded>`);
        } else {
            lines.push(`    <description>${escapeXml(item.description)}</description>`);
        }

        if (item.pubDate && item.pubDate !== "NO_DATE_FOUND") {
            lines.push(`    <pubDate>${escapeXml(item.pubDate)}</pubDate>`);
        }

        if (item.categories?.length) {
            for (const cat of item.categories) {
                lines.push(`    <category>${escapeXml(cat)}</category>`);
            }
        }

        lines.push(`  </item>`);
    }

    lines.push(`</channel>`);
    lines.push(`</rss>`);

    return lines.join("\n");
}

/** Build an Atom feed XML document from the same structured data */
export function buildAtom(feed: RSSFeedData): string {
    const lines: string[] = [];

    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    lines.push(`<feed xmlns="http://www.w3.org/2005/Atom">`);
    lines.push(`  <title>${escapeXml(feed.channel.title)}</title>`);
    lines.push(`  <link href="${escapeXml(feed.channel.link)}" rel="alternate"/>`);
    lines.push(`  <id>${escapeXml(feed.channel.link)}</id>`);
    lines.push(`  <subtitle>${escapeXml(feed.channel.description)}</subtitle>`);
    lines.push(`  <updated>${new Date().toISOString()}</updated>`);
    lines.push(`  <generator>RSS-GenAI</generator>`);

    for (const item of feed.items) {
        const guid = item.guid || item.link;

        lines.push(`  <entry>`);
        lines.push(`    <title>${escapeXml(item.title)}</title>`);
        lines.push(`    <link href="${escapeXml(item.link)}" rel="alternate"/>`);
        lines.push(`    <id>${escapeXml(guid)}</id>`);

        if (item.content) {
            lines.push(`    <summary>${escapeXml(item.description)}</summary>`);
            lines.push(`    <content type="html">${wrapCDATA(item.content)}</content>`);
        } else {
            lines.push(`    <content type="text">${escapeXml(item.description)}</content>`);
        }

        if (item.pubDate && item.pubDate !== "NO_DATE_FOUND") {
            // Atom uses ISO 8601, try to convert from RFC 822
            try {
                const isoDate = new Date(item.pubDate).toISOString();
                lines.push(`    <published>${isoDate}</published>`);
                lines.push(`    <updated>${isoDate}</updated>`);
            } catch {
                lines.push(`    <published>${escapeXml(item.pubDate)}</published>`);
            }
        }

        if (item.categories?.length) {
            for (const cat of item.categories) {
                lines.push(`    <category term="${escapeXml(cat)}"/>`);
            }
        }

        lines.push(`  </entry>`);
    }

    lines.push(`</feed>`);

    return lines.join("\n");
}
