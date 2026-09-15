import { RULES } from "@/rules";
import { validateRule, type FeedRuleV1 } from "@/lib/rule-schema";

const rules = new Map<string, FeedRuleV1>();
for (const rawRule of RULES) {
    const rule = validateRule(rawRule);
    if (rules.has(rule.id)) throw new Error(`Duplicate rule id: ${rule.id}`);
    rules.set(rule.id, rule);
}

export function listRules(): FeedRuleV1[] {
    return [...rules.values()];
}

export function getRule(id: string): FeedRuleV1 | null {
    return rules.get(id) || null;
}
