import { parse } from "yaml";
import { RulePackage } from "../../domain/rules/RulePackage";
import { mergeRuleDefinitions } from "./RuleLoader";
export { getCoreBattlePlaytestRulePackage, getPlaytestRulePackage } from "./RulePackageSelector";

/**
 * Vite の import.meta.glob を使用して、rules-vnext 配下の全 YAML ファイルを
 * raw 文字列としてバンドル・パースし、1つの RulePackage に統合します（ブラウザ環境用）。
 */
export function loadRulePackageForBrowser(): RulePackage {
  const yamlModules = (import.meta as any).glob("../../data/rules-vnext/**/*.yaml", {
    eager: true,
    query: "?raw",
    import: "default",
  });

  const parsedDocs: any[] = [];
  for (const rawYaml of Object.values(yamlModules)) {
    if (typeof rawYaml === "string") {
      const parsed = parse(rawYaml);
      if (parsed) {
        parsedDocs.push(parsed);
      }
    }
  }

  return mergeRuleDefinitions(parsedDocs);
}
