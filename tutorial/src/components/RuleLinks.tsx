import { ruleCatalog } from "../generated/ruleCatalog";
import type { RuleRef } from "../types";
const buckets = {
  action: "actions",
  character: "characters",
  fog: "fogs",
  frame: "frames",
  format: "formats",
} as const;
export function RuleLinks({ refs }: { refs: RuleRef[] }) {
  return (
    <div className="rule-links">
      <span>関連する公式ルール</span>
      <div>
        {refs.map((ref) => {
          const [namespace, id] = ref.split(".");
          const bucket = ruleCatalog[
            buckets[namespace as keyof typeof buckets]
          ] as Record<string, { name: string; href: string }>;
          const entry = bucket?.[id];
          return (
            entry && (
              <a key={ref} href={entry.href} target="_blank" rel="noreferrer">
                {entry.name} ↗
              </a>
            )
          );
        })}
      </div>
    </div>
  );
}
