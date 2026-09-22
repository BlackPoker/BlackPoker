import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (file) =>
  parse(fs.readFileSync(path.join(repositoryRoot, file), "utf8"));
const base = "https://blackpoker.github.io/BlackPoker/master";
export function loadRuleCatalog() {
  const act = read("tools/actionlist/original/act.yaml");
  const frame = read("tools/actionlist/original/frame.yaml");
  const actions = {},
    characters = {},
    fogs = {},
    frames = {},
    formats = {};
  for (const group of act.actList)
    for (const a of group.acts) {
      actions[a.actId] = {
        name: a.actName,
        href: `${base}/auto/actionlist.html#act-${a.actId.toLowerCase()}`,
        formats: a.format.split(","),
        group: group.type,
        key: a.actKey || "",
        cost: a.actCost || "",
        effect: a.actEffect || "",
        target: a.actTarget || "",
        condition: a.actActCond || "",
        trigger: a.actTrigger,
        triggerCondition: a.actTriggerCond || "",
        timing: a.actTime,
        speed: a.actSpeed,
      };
    }
  for (const group of act.charList)
    for (const c of group.chars)
      characters[c.charId] = {
        name: c.charName,
        href: `${base}/auto/actionlist.html#char-${c.charId.toLowerCase()}`,
        key: c.charKey,
        type: c.charType,
        labels: c.charLabel,
        formats: c.format.split(","),
        size: String(c.charSize || ""),
        ability: c.charAbility || "",
      };
  for (const group of act.fogList)
    for (const f of group.fogs)
      fogs[f.fogId] = {
        name: f.fogName,
        href: `${base}/auto/actionlist.html#fog-${f.fogId.toLowerCase()}`,
        key: f.fogKey,
        effect: f.fogAbility,
        formats: f.format.split(","),
      };
  for (const f of frame.frames)
    frames[f.frameId] = {
      name: f.name,
      href: `${base}/auto/framelist.html#frame-${f.frameId.toLowerCase()}`,
      deck: f.deck,
      start: f.start,
      formats: f.format.split(","),
    };
  for (const [id, name] of Object.entries({
    lite: "ライト",
    std: "スタンダード",
    pro: "プロ",
    mast: "マスター",
  })) {
    formats[id] = {
      name,
      href: `${base}/format/format.html`,
      actions: Object.keys(actions).filter((key) =>
        actions[key].formats.includes(id),
      ),
    };
  }
  return { actions, characters, fogs, frames, formats };
}
