import type { RuleRef, TutorialScenario } from "../types";

export interface RuleCatalogLike {
  actions: Record<string, unknown>;
  frames: Record<string, unknown>;
  formats: Record<string, unknown>;
  components: Record<string, unknown>;
}

const buckets = { action: "actions", frame: "frames", format: "formats", component: "components" } as const;

export function validateRuleRef(ref: string, catalog: RuleCatalogLike): string | null {
  const separator = ref.indexOf(".");
  if (separator < 1) return `Tutorial reference has invalid shape: ${ref}`;
  const namespace = ref.slice(0, separator) as keyof typeof buckets;
  const id = ref.slice(separator + 1);
  const bucket = buckets[namespace];
  if (!bucket || !id || !(id in catalog[bucket])) return `Tutorial references unknown rule: ${ref}`;
  return null;
}

export function validateScenario(value: unknown, catalog: RuleCatalogLike): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return ["Tutorial scenario must be an object"];
  const scenario = value as TutorialScenario;
  if (scenario.schemaVersion !== 1) errors.push("Unsupported tutorial schemaVersion");
  if (!scenario.id || !scenario.title) errors.push("Tutorial id and title are required");
  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) errors.push("Tutorial steps are required");
  const refs: string[] = [`format.${scenario.regulation?.format ?? ""}`, `frame.${scenario.regulation?.frame ?? ""}`, ...(scenario.learn ?? [])];
  const ids = new Set<string>();
  for (const [index, step] of (scenario.steps ?? []).entries()) {
    if (!step.id || ids.has(step.id)) errors.push(`Step ${index + 1} has a missing or duplicate id`);
    ids.add(step.id);
    if (!step.chapter || !step.instruction || !step.actionLabel) errors.push(`Step ${step.id || index + 1} is incomplete`);
    refs.push(...(step.ruleRefs ?? []));
  }
  for (const ref of refs as RuleRef[]) {
    const error = validateRuleRef(ref, catalog);
    if (error) errors.push(error);
  }
  return [...new Set(errors)];
}
