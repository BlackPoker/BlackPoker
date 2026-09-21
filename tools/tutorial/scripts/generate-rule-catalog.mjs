import fs from "node:fs";
import path from "node:path";
import { loadRuleCatalog, repositoryRoot } from "./rule-source.mjs";

const outputDirectory = path.join(repositoryRoot, "tools/tutorial/src/generated");
fs.mkdirSync(outputDirectory, { recursive: true });
const contents = `// tools/actionlist と Simulator の正規YAMLから生成。直接編集しないでください。\nexport const ruleCatalog = ${JSON.stringify(loadRuleCatalog(), null, 2)} as const;\n`;
fs.writeFileSync(path.join(outputDirectory, "ruleCatalog.ts"), contents);
console.log("Generated tools/tutorial/src/generated/ruleCatalog.ts");
