import { listRules } from "@/lib/rule-registry";

export async function GET() {
    const rules = listRules().map((rule) => ({
        id: rule.id,
        name: rule.name,
        sourceUrl: rule.source.url,
        supportsFulltext: Boolean(rule.fulltext),
    }));
    return Response.json({ rules, count: rules.length });
}
