import fs from "node:fs";
import path from "node:path";
import { loadRuleCatalog, repositoryRoot } from "./rule-source.mjs";
const directory = path.join(repositoryRoot, "tutorial/src/generated");
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(
  path.join(directory, "ruleCatalog.ts"),
  "// act.yaml / frame.yamlから生成。直接編集しないでください。\nexport const ruleCatalog = " +
    JSON.stringify(loadRuleCatalog(), null, 2) +
    " as const;\n",
);
console.log("Generated tutorial/src/generated/ruleCatalog.ts");
