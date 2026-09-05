import { parse } from "yaml";
import { RulePackage, ActionDefinition, ComponentDefinition } from "../../domain/rules/RulePackage";

/**
 * 複数のパース済みドキュメントオブジェクト（YAMLからパースされたオブジェクトの配列）を
 * 1つの RulePackage に統合・検証します。
 */
export function mergeRuleDefinitions(parsedDocs: any[]): RulePackage {
  const actions: ActionDefinition[] = [];
  const components: ComponentDefinition[] = [];

  let id = "vnext-rules";
  let version = "1.0.0";
  let description = "Rules Next Generation";

  for (const parsed of parsedDocs) {
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

  // 重複IDバリデーション
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

const rulePackageCache = new Map<string, RulePackage>();

/**
 * オブジェクトおよびその子要素を再帰的に凍結（Object.freeze）し、
 * ランタイムでのあらゆる mutation を確実に防御します。
 */
export function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as any)[key];
    if (val !== null && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

/**
 * ルールパッケージのインメモリキャッシュをクリアします（テスト用）。
 */
export function clearRulePackageCache(): void {
  rulePackageCache.clear();
}

/**
 * 指定されたディレクトリ配下のすべての YAML ファイルを再帰的に読み込み、
 * 1つの RulePackage に統合します（Node.js環境用）。
 * 同一ディレクトリに対する再帰読み込みとYAMLパース結果は deepFreeze された状態でインメモリキャッシュされます。
 */
export async function loadRulePackageFromDirectory(dirPath: string): Promise<RulePackage> {
  // Node.js 標準モジュールを動的インポートすることで、ブラウザビルド環境での静的エラーを防止する
  const fs = await import("fs");
  const path = await import("path");

  const normalizedPath = path.resolve(dirPath);
  if (rulePackageCache.has(normalizedPath)) {
    return rulePackageCache.get(normalizedPath)!;
  }

  const readDirRecursive = (dir: string): string[] => {
    let results: string[] = [];
    const list = fs.readdirSync(dir).sort();
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
  const parsedDocs: any[] = [];

  for (const filePath of yamlFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parse(content) as any;
    if (parsed) {
      parsedDocs.push(parsed);
    }
  }

  const merged = mergeRuleDefinitions(parsedDocs);
  const frozen = deepFreeze(merged) as RulePackage;
  rulePackageCache.set(normalizedPath, frozen);
  return frozen;
}





