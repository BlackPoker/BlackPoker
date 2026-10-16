/**
 * SemanticDynamicIdCanonicalizer.ts
 *
 * BlackPoker Simulator - AI Semantic Stall / Cycle Diagnostic V1
 *
 * 決定論的 2-Pass ID 正規化ユーティリティ。
 * - Pass 1: 決定論的走査順序で全エンティティの動的ランタイム ID を検出し、出現順の canonical ID (例: "unit#1", "req#1") へマッピング
 * - Pass 2: オブジェクト構造および参照関係を保持したまま canonical ID へ置換
 * - トポロジー保存契約: 異なる実体は常に異なる canonical ID となり、グラフ構造を縮約しない
 */

export class SemanticDynamicIdCanonicalizer {
  /**
   * 与えられた文字列 ID がランタイム動的生成 ID かどうか判定
   */
  public static isDynamicId(id: any): boolean {
    if (!id || typeof id !== "string") return false;
    return (
      /\d{10,}/.test(id) ||
      id.includes("runtime-") ||
      (id.startsWith("dec-") && /\d+/.test(id)) ||
      (id.startsWith("req-") && /\d{5,}/.test(id)) ||
      (id.startsWith("unit-") && /\d{5,}/.test(id))
    );
  }

  /**
   * 動的 ID のプレフィックスを抽出 (例: "unit-cost-1788..." -> "unit-cost", "req-trg-1788..." -> "req-trg")
   */
  public static extractPrefix(id: string, defaultPrefix = "entity"): string {
    const match = id.match(/^([a-zA-Z_-]+?)(?:-\d{10,}|-\d{5,}|$)/);
    return match ? match[1] : defaultPrefix;
  }

  /**
   * 決定論的マッピングコンテキストを作成
   */
  public static createMappingContext(): {
    idMap: Map<string, string>;
    prefixCounters: Map<string, number>;
    registerId: (rawId: any, defaultPrefix?: string) => void;
    registerRecursively: (value: any, defaultPrefix?: string) => void;
    resolveId: (rawId: any) => string | undefined;
    canonicalizeValue: (value: any) => any;
  } {
    const idMap = new Map<string, string>();
    const prefixCounters = new Map<string, number>();

    const registerId = (rawId: any, defaultPrefix = "entity") => {
      if (!rawId || typeof rawId !== "string") return;
      if (SemanticDynamicIdCanonicalizer.isDynamicId(rawId) && !idMap.has(rawId)) {
        const prefix = SemanticDynamicIdCanonicalizer.extractPrefix(rawId, defaultPrefix);
        const count = (prefixCounters.get(prefix) || 0) + 1;
        prefixCounters.set(prefix, count);
        idMap.set(rawId, `${prefix}#${count}`);
      }
    };

    const registerRecursively = (value: any, defaultPrefix = "entity") => {
      if (value === null || value === undefined) return;
      if (typeof value === "string") {
        registerId(value, defaultPrefix);
      } else if (Array.isArray(value)) {
        value.forEach((item) => registerRecursively(item, defaultPrefix));
      } else if (typeof value === "object") {
        for (const key of Object.keys(value).sort()) {
          registerRecursively(value[key], defaultPrefix);
        }
      }
    };

    const resolveId = (rawId: any): string | undefined => {
      if (!rawId || typeof rawId !== "string") return undefined;
      return idMap.get(rawId) || rawId;
    };

    const canonicalizeValue = (value: any): any => {
      if (value === null || value === undefined) return value;
      if (typeof value === "string") {
        return resolveId(value) || value;
      }
      if (typeof value !== "object") return value;

      if (Array.isArray(value)) {
        return value.map((item) => canonicalizeValue(item));
      }

      const sorted: Record<string, any> = {};
      for (const key of Object.keys(value).sort()) {
        if (key === "timestamp" || key === "createdAt") continue;
        sorted[key] = canonicalizeValue(value[key]);
      }
      return sorted;
    };

    return {
      idMap,
      prefixCounters,
      registerId,
      registerRecursively,
      resolveId,
      canonicalizeValue,
    };
  }
}
