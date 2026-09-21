import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const readYaml = (relativePath) => parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

export function loadRuleCatalog() {
  const act = readYaml("tools/actionlist/original/act.yaml");
  const frame = readYaml("tools/actionlist/original/frame.yaml");
  const components = readYaml("tools/simulator/src/data/rules-vnext/official-base.yaml");
  const actions = {};
  const formats = {};
  const frames = {};
  const componentCatalog = {};

  for (const group of act.actList ?? []) {
    for (const action of group.acts ?? []) {
      if (!action.actId) continue;
      actions[action.actId] = {
        name: action.actName,
        href: `https://blackpoker.github.io/BlackPoker/9th/actionlist/html/all.html#act-${action.actId}`,
      };
      for (const format of String(action.format ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
        const names = { lite: "ライト", std: "スタンダード", pro: "プロ", mast: "マスター" };
        formats[format] = { name: names[format] ?? format, href: "https://blackpoker.github.io/BlackPoker/9th/format/format.html" };
      }
    }
  }
  for (const item of frame.frames ?? []) {
    if (!item.frameId) continue;
    frames[item.frameId] = { name: item.name, href: "https://blackpoker.github.io/BlackPoker/9th/frame/frame.html" };
  }
  for (const item of components.components ?? []) {
    if (!item.id) continue;
    componentCatalog[item.id] = { name: item.name, href: "https://blackpoker.github.io/BlackPoker/9th/common/common-component.html" };
  }
  return { actions, frames, formats, components: componentCatalog };
}

export const repositoryRoot = root;
