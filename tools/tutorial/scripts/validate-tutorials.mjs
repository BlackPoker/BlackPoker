import fs from "node:fs";
import path from "node:path";
import { loadRuleCatalog, repositoryRoot } from "./rule-source.mjs";

const catalog = loadRuleCatalog();
const scenarioDirectory = path.join(repositoryRoot, "tools/tutorial/src/data/tutorials");
const bucketNames = { action: "actions", frame: "frames", format: "formats", component: "components" };
const errors = [];

for (const filename of fs.readdirSync(scenarioDirectory).filter((name) => name.endsWith(".json"))) {
  const scenario = JSON.parse(fs.readFileSync(path.join(scenarioDirectory, filename), "utf8"));
  const refs = [`format.${scenario.regulation?.format ?? ""}`, `frame.${scenario.regulation?.frame ?? ""}`, ...(scenario.learn ?? [])];
  const ids = new Set();
  const closedChapters = new Set();
  let activeChapter = null;
  for (const [index, step] of (scenario.steps ?? []).entries()) {
    if (!step.id || ids.has(step.id)) errors.push(`${filename}: step ${index + 1} has a missing or duplicate id`);
    ids.add(step.id);
    if (!step.instruction || !step.actionLabel || !Array.isArray(step.ruleRefs)) errors.push(`${filename}: step ${step.id} is incomplete`);
    if (step.chapter !== activeChapter) {
      if (activeChapter) closedChapters.add(activeChapter);
      if (closedChapters.has(step.chapter)) errors.push(`${filename}: chapter ${step.chapter} is not contiguous`);
      activeChapter = step.chapter;
    }
    refs.push(...(step.ruleRefs ?? []));
  }
  for (const ref of refs) {
    const separator = ref.indexOf(".");
    const namespace = ref.slice(0, separator);
    const id = ref.slice(separator + 1);
    const bucket = bucketNames[namespace];
    if (!bucket || !id || !(id in catalog[bucket])) errors.push(`${filename}: Tutorial references unknown rule: ${ref}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Tutorial scenarios are valid against the official rule sources.");
