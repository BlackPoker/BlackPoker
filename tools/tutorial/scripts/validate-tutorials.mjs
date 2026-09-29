import fs from "node:fs";
import path from "node:path";
import { loadRuleCatalog, repositoryRoot } from "./rule-source.mjs";
import { validateScenario } from "../src/lib/schema.mjs";
import { validateCurriculum } from "../src/lib/curriculum-schema.mjs";
import { makeBulwarkFixture } from "../src/data/bulwark-fixture.mjs";
const directory = path.join(repositoryRoot, "tools/tutorial/src/data/tutorials");
const errors = fs
  .readdirSync(directory)
  .filter((f) => f.endsWith(".json"))
  .flatMap((f) =>
    validateScenario(
      JSON.parse(fs.readFileSync(path.join(directory, f), "utf8")),
      loadRuleCatalog(),
    ).map((e) => f + ": " + e),
  );
const entry = JSON.parse(fs.readFileSync(path.join(directory, "entry16.json"), "utf8"));
const wall = makeBulwarkFixture(entry);
errors.push(...validateScenario(wall, loadRuleCatalog()));
errors.push(...validateCurriculum(JSON.parse(fs.readFileSync(path.join(directory, "../learning-path.json"), "utf8")), loadRuleCatalog(), [entry, wall]));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Tutorial scenarios, curriculum, Lite coverage, rule references and fixture continuity are valid.");
