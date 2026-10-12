import fs from "node:fs";
import path from "node:path";
import { loadRuleCatalog, repositoryRoot } from "./rule-source.mjs";
import { validateScenario } from "../src/lib/schema.mjs";
import { validateCurriculum } from "../src/lib/curriculum-schema.mjs";
import { makeBookFixtures } from "../src/data/book-fixtures.mjs";
import { validateBookLayout } from "../src/lib/book-schema.mjs";
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
const fixtures = makeBookFixtures(entry);
fixtures.forEach((fixture) => errors.push(...validateScenario(fixture, loadRuleCatalog()).map((error) => fixture.id + ": " + error)));
const curriculum = JSON.parse(fs.readFileSync(path.join(directory, "../learning-path.json"), "utf8"));
errors.push(...validateCurriculum(curriculum, loadRuleCatalog(), fixtures));
errors.push(...validateBookLayout(JSON.parse(fs.readFileSync(path.join(directory, "../book-layout.json"), "utf8")), curriculum.lessons));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Tutorial scenarios, book tracks, curriculum, Lite coverage, rule references and fixture continuity are valid.");
