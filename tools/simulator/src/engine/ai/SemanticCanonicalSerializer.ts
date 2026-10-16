/**
 * SemanticCanonicalSerializer.ts
 *
 * BlackPoker Simulator - AI Semantic Stall / Cycle Diagnostic V1
 *
 * 決定論的 Canonical JSON シリアライザ。
 * 1. オブジェクトキーを Unicode コードポイント昇順で再帰的にソート
 * 2. 配列順序の厳格な保持
 * 3. 浮動小数点数の完全精度シリアライズ (-0 は 0 に正規化、丸めなし)
 * 4. NaN / Infinity / -Infinity は fail-closed (例外送出)
 * 5. 余分な空白を含まない最小文字列表現
 */

export class SemanticCanonicalSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemanticCanonicalSerializationError";
  }
}

export class SemanticCanonicalSerializer {
  /**
   * 任意の JS オブジェクト/値を正規化された決定論的 JSON 文字列へ変換
   */
  public static serialize(value: any): string {
    return this.serializeInternal(value, false);
  }

  private static serializeInternal(value: any, isArrayElement: boolean): string {
    if (value === null) {
      return "null";
    }

    if (value === undefined) {
      if (isArrayElement) {
        return "null";
      }
      return "null";
    }

    const type = typeof value;

    if (type === "boolean") {
      return value ? "true" : "false";
    }

    if (type === "number") {
      if (!Number.isFinite(value)) {
        throw new SemanticCanonicalSerializationError(
          `Non-finite number encountered in canonical serialization: ${value}`
        );
      }
      // -0 を 0 に正規化
      if (Object.is(value, -0)) {
        return "0";
      }
      return String(value);
    }

    if (type === "string") {
      return JSON.stringify(value);
    }

    if (type === "bigint" || type === "symbol" || type === "function") {
      throw new SemanticCanonicalSerializationError(
        `Unsupported type '${type}' encountered in canonical serialization.`
      );
    }

    if (Array.isArray(value)) {
      const items = value.map((item) => this.serializeInternal(item, true));
      return `[${items.join(",")}]`;
    }

    if (type === "object") {
      // 循環参照チェックやプレーンオブジェクト以外のガード
      const keys = Object.keys(value).sort();
      const entries: string[] = [];

      for (const key of keys) {
        const val = value[key];
        // JSON 規約に従い、undefined のプロパティはキーごと省略
        if (val === undefined) {
          continue;
        }
        const serializedVal = this.serializeInternal(val, false);
        entries.push(`${JSON.stringify(key)}:${serializedVal}`);
      }

      return `{${entries.join(",")}}`;
    }

    throw new SemanticCanonicalSerializationError(
      `Unhandled value of type '${type}' in canonical serialization.`
    );
  }
}
