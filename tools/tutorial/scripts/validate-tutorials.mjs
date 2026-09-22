import fs from "node:fs";
import path from "node:path";
import { loadRuleCatalog, repositoryRoot } from "./rule-source.mjs";
import { validateScenario } from "../src/lib/schema.mjs";
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
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Tutorial schema, rule references and board continuity are valid.");
