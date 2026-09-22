import { ruleCatalog } from "../generated/ruleCatalog";

const formats = ["lite", "std", "pro", "mast"] as const;

export const formatDifferences = formats.slice(1).map((id, index) => {
  const actions = ruleCatalog.formats[id].actions as readonly string[];
  const previous = ruleCatalog.formats[formats[index]].actions as readonly string[];
  const added = actions.filter((key) => !previous.includes(key));
  return {
    id,
    title: ruleCatalog.formats[id].name,
    addedActions: added.map(
      (key) => ruleCatalog.actions[key as keyof typeof ruleCatalog.actions].name,
    ),
  };
});

export const learningCourses = [
  { id: "lite-entry16", title: "ライト＋エントリー16", status: "available" },
  { id: "lite-pack", title: "ライト＋パック", status: "locked" },
  { id: "std-pack", title: "スタンダード＋パック", status: "locked" },
  { id: "std-rare", title: "スタンダード＋レアパック", status: "locked" },
  { id: "pro-rare", title: "プロ＋レアパック", status: "locked" },
  { id: "pro-strategy", title: "プロ＋ストラテジー", status: "locked" },
  { id: "mast-strategy", title: "マスター＋ストラテジー", status: "locked" },
  { id: "mast-extra", title: "マスター＋エクストラ", status: "locked" },
] as const;
