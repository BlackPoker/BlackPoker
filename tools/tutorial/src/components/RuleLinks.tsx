import { ruleCatalog } from "../generated/ruleCatalog";
import type { RuleRef } from "../types";

export function RuleLinks({ refs }: { refs: RuleRef[] }) {
  if (!refs.length) return null;
  return <div className="rule-links"><span>関連する公式ルール</span><div>{refs.map((ref) => {
    const [namespace, ...rest] = ref.split(".");
    const id = rest.join(".");
    const bucket = namespace === "action" ? ruleCatalog.actions : namespace === "frame" ? ruleCatalog.frames : namespace === "format" ? ruleCatalog.formats : ruleCatalog.components;
    const entry = bucket[id as keyof typeof bucket] as { name: string; href: string } | undefined;
    return entry ? <a key={ref} href={entry.href} target="_blank" rel="noreferrer">{entry.name}<span aria-hidden="true">↗</span></a> : null;
  })}</div></div>;
}
