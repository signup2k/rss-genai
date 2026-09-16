export interface RuleField {
    selector?: string;
    attribute?: string;
    format?: "text" | "html";
    required?: boolean;
}

export interface FeedRuleV1 {
    version: 1;
    id: string;
    name: string;
    source: {
        url: string;
        transport?: "direct" | "jina";
        format?: "html" | "xml";
        itemSelector: string;
        allowedArticleHosts?: string[];
        form?: {
            selector: string;
            fields: Record<string, string>;
        };
    };
    feed: {
        title: string;
        description: string;
    };
    fields: {
        title: RuleField;
        link: RuleField & { attribute?: string };
        description?: RuleField;
        date?: RuleField;
        categories?: RuleField;
    };
    fulltext?: {
        selector: string;
        remove?: string[];
    };
    assertions?: {
        minItems?: number;
        linkPattern?: string;
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertField(value: unknown, name: string, required = true): void {
    if (!isRecord(value)) {
        if (!required && value === undefined) return;
        throw new Error(`${name} must be an object`);
    }
    for (const key of ["selector", "attribute"] as const) {
        if (value[key] !== undefined && typeof value[key] !== "string") {
            throw new Error(`${name}.${key} must be a string`);
        }
    }
    if (value.format !== undefined && value.format !== "text" && value.format !== "html") {
        throw new Error(`${name}.format must be text or html`);
    }
}

export function validateRule(value: unknown): FeedRuleV1 {
    if (!isRecord(value)) throw new Error("Rule must be an object");
    if (value.version !== 1) throw new Error("Only rule version 1 is supported");
    if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(value.id)) {
        throw new Error("Rule id must contain 2-64 lowercase letters, digits, or hyphens");
    }
    if (typeof value.name !== "string" || !value.name.trim()) {
        throw new Error("Rule name is required");
    }
    if (!isRecord(value.source)) throw new Error("Rule source is required");
    if (typeof value.source.url !== "string") throw new Error("source.url is required");
    const sourceUrl = new URL(value.source.url);
    if (!["http:", "https:"].includes(sourceUrl.protocol)) {
        throw new Error("source.url must use http or https");
    }
    if (typeof value.source.itemSelector !== "string" || !value.source.itemSelector.trim()) {
        throw new Error("source.itemSelector is required");
    }
    if (value.source.format !== undefined && value.source.format !== "html" && value.source.format !== "xml") {
        throw new Error("source.format must be html or xml");
    }
    if (value.source.transport !== undefined && value.source.transport !== "direct" && value.source.transport !== "jina") {
        throw new Error("source.transport must be direct or jina");
    }
    if (value.source.form !== undefined) {
        if (!isRecord(value.source.form) || typeof value.source.form.selector !== "string") {
            throw new Error("source.form.selector is required");
        }
        if (!isRecord(value.source.form.fields) || !Object.values(value.source.form.fields).every((field) => typeof field === "string")) {
            throw new Error("source.form.fields must contain string values");
        }
    }
    if (!isRecord(value.feed) || typeof value.feed.title !== "string" || typeof value.feed.description !== "string") {
        throw new Error("feed.title and feed.description are required");
    }
    if (!isRecord(value.fields)) throw new Error("Rule fields are required");
    assertField(value.fields.title, "fields.title");
    assertField(value.fields.link, "fields.link");
    assertField(value.fields.description, "fields.description", false);
    assertField(value.fields.date, "fields.date", false);
    assertField(value.fields.categories, "fields.categories", false);
    if (isRecord(value.assertions) && typeof value.assertions.linkPattern === "string") {
        new RegExp(value.assertions.linkPattern);
    }
    return value as unknown as FeedRuleV1;
}
