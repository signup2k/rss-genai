import type { FeedRuleV1 } from "@/lib/rule-schema";
import { manInsightsRule } from "@/rules/man-insights";

// The harness publishes reviewed RuleV1 objects into this array. Production
// deliberately has no generic fallback: an unknown rule id cannot fetch a URL.
export const RULES: FeedRuleV1[] = [manInsightsRule];
