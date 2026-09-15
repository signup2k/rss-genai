# Publishing feed rules

Production only executes rules exported from `rules/index.ts`. The intended
workflow is:

1. Develop the rule in the external harness.
2. Test it against a saved HTML fixture and the live site.
3. Validate the `RuleV1` schema and runtime assertions.
4. Add the reviewed rule to the `RULES` array and deploy this project.

See `docs/RULE_FORMAT.md` for the complete contract.
