import { ruleCatalog } from "../generated/ruleCatalog";
const formats = ["lite", "std", "pro", "mast"] as const;
export const curriculum = formats.map((id, index) => {
  const actions = ruleCatalog.formats[id].actions as readonly string[];
  const previous: readonly string[] = index
    ? ruleCatalog.formats[formats[index - 1]].actions
    : [];
  const added = actions.filter((key) => !previous.includes(key));
  return {
    id,
    title: ruleCatalog.formats[id].name,
    subtitle: index
      ? added
          .map(
            (key) =>
              ruleCatalog.actions[key as keyof typeof ruleCatalog.actions].name,
          )
          .join("・")
      : "エントリー16",
    status: index ? "locked" : "available",
  };
});
