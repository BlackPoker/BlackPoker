import { parse } from "yaml";
import { RulePackage, ActionDefinition, ComponentDefinition } from "../../domain/rules/RulePackage";

/**
 * 指定されたディレクトリ配下のすべての YAML ファイルを再帰的に読み込み、
 * 1つの RulePackage に統合します。
 */
export async function loadRulePackageFromDirectory(dirPath: string): Promise<RulePackage> {
  // Node.js 標準モジュールを動的インポートすることで、ブラウザビルド環境での静的エラーを防止する
  const fs = await import("fs");
  const path = await import("path");

  const actions: ActionDefinition[] = [];
  const components: ComponentDefinition[] = [];

  const readDirRecursive = (dir: string): string[] => {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    list.forEach((file) => {
      const fullPath = path.resolve(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(readDirRecursive(fullPath));
      } else {
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          results.push(fullPath);
        }
      }
    });
    return results;
  };

  const yamlFiles = readDirRecursive(dirPath);
  let id = "vnext-rules";
  let version = "1.0.0";
  let description = "Rules Next Generation";

  for (const filePath of yamlFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parse(content) as any;
    if (!parsed) continue;

    if (parsed.id && parsed.version) {
      id = parsed.id;
      version = parsed.version;
      if (parsed.description) description = parsed.description;
    }

    if (parsed.actions && Array.isArray(parsed.actions)) {
      actions.push(...parsed.actions);
    }
    if (parsed.components && Array.isArray(parsed.components)) {
      components.push(...parsed.components);
    }
  }

  // 簡易整合性バリデーション
  const actionIds = new Set<string>();
  for (const action of actions) {
    if (actionIds.has(action.id)) {
      throw new Error(`重複するアクションIDが検出されました: ${action.id}`);
    }
    actionIds.add(action.id);
  }

  const componentIds = new Set<string>();
  for (const component of components) {
    if (componentIds.has(component.id)) {
      throw new Error(`重複するコンポーネントIDが検出されました: ${component.id}`);
    }
    componentIds.add(component.id);
  }

  return {
    id,
    version,
    description,
    actions,
    components,
  };
}
