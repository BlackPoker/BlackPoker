import { parse } from "yaml";
import { RulePackage } from "../../domain/rules/RulePackage";
import { mergeRuleDefinitions } from "./RuleLoader";

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

/**
 * Core Battle Playtest 用に、Playtest でサポートされているアクションのみにフィルタリングした RulePackage を生成します。
 */
export function getPlaytestRulePackage(fullRulePackage: RulePackage): RulePackage {
  // Playtest でサポートされるアクションID一覧
  const supportedActionIds = new Set([
    "action.attack",
    "action.block",
    "action.damageJudge",
    "action.end",
    "action.charge",
    "action.draw",
    "action.twist",
    "action.counterattack",
    "action.nextGeneration",
    "action.revolutionDraw",
  ]);

  const filteredActions = fullRulePackage.actions.filter((a) => supportedActionIds.has(a.id));

  return {
    ...fullRulePackage,
    actions: filteredActions,
  };
}
