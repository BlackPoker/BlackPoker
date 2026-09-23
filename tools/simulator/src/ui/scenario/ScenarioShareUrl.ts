import {
  ScenarioDefinitionV1,
  SCENARIO_SCHEMA_VERSION,
  parseScenarioDefinitionV1,
  normalizeScenarioDefinitionV1,
} from "../../domain/scenario/ScenarioTypes";

export const SCENARIO_URL_PARAM_KEY = "scenario";
export const MAX_SCENARIO_PAYLOAD_BYTES = 65536; // 64 KB (decoded JSON UTF-8 payload limit)
export const MAX_SCENARIO_ENCODED_CHARS = Math.ceil(MAX_SCENARIO_PAYLOAD_BYTES / 3) * 4; // 87384 chars (4/3 of 64KB aligned to 4)
export const MAX_SCENARIO_ENCODED_BYTES = MAX_SCENARIO_ENCODED_CHARS;

export type ScenarioDecodeResult =
  | {
      readonly success: true;
      readonly definition: ScenarioDefinitionV1;
    }
  | {
      readonly success: false;
      readonly error: string;
    };

const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * 文字列の UTF-8 バイト長を取得します。
 */
export function getUtf8ByteLength(str: string): number {
  if (typeof Buffer !== "undefined") {
    return Buffer.byteLength(str, "utf8");
  }
  return new TextEncoder().encode(str).length;
}

/**
 * UTF-8 文字列を URL-safe Base64 文字列へ変換（Browser / Node.js 双方で安全に動作）
 */
export function stringToUrlSafeBase64(str: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * URL-safe Base64 文字列を UTF-8 文字列へ復元（Browser / Node.js 双方で安全に動作）
 */
export function urlSafeBase64ToString(base64Url: string): string {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf8");
  }
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * ScenarioDefinitionV1 を URL パラメータ用文字列へエンコードします。
 * Raw GameState は含めず、高レベル Scenario 定義を正規化した上で直列化します。
 */
export function encodeScenarioDefinitionV1ToUrlParam(def: ScenarioDefinitionV1): string {
  const parseRes = parseScenarioDefinitionV1(def);
  if (!parseRes.success) {
    throw new Error(
      "無効なシナリオ定義です: " + parseRes.errors.map((e) => e.message).join(", ")
    );
  }
  const canonical = normalizeScenarioDefinitionV1(parseRes.definition);
  const jsonStr = JSON.stringify(canonical);
  const byteLen = getUtf8ByteLength(jsonStr);
  if (byteLen > MAX_SCENARIO_PAYLOAD_BYTES) {
    throw new Error(
      `シナリオ定義のJSONサイズ (${byteLen} bytes) が上限 (${MAX_SCENARIO_PAYLOAD_BYTES} bytes) を超過しています。`
    );
  }
  return stringToUrlSafeBase64(jsonStr);
}

/**
 * URL パラメータ文字列から ScenarioDefinitionV1 をデコード・厳格検証します。
 * 不正入力・未知バージョン・サイズ超過はすべて fail-closed でエラーを返します。
 */
export function decodeScenarioDefinitionV1FromUrlParam(param: string): ScenarioDecodeResult {
  if (!param || typeof param !== "string") {
    return { success: false, error: "シナリオパラメータが空または無効です。" };
  }

  // 空白文字 (スペース, 改行等) が含まれる場合は fail-closed で拒絶
  if (/\s/.test(param)) {
    return {
      success: false,
      error: "シナリオパラメータに空白文字が含まれています。",
    };
  }

  const trimmed = param.trim();

  // 文字数制約の検査
  if (trimmed.length > MAX_SCENARIO_ENCODED_CHARS) {
    return {
      success: false,
      error: `シナリオパラメータが許容エンコード文字数 (${MAX_SCENARIO_ENCODED_CHARS} chars) を超過しています。`,
    };
  }

  // Base64URL 厳格フォーマットチェック (padding '=' の禁止、文字種および長さ % 4 !== 1)
  if (!BASE64_URL_PATTERN.test(trimmed) || trimmed.length % 4 === 1) {
    return {
      success: false,
      error: "シナリオパラメータのBase64URL形式が不正です (Malformed Base64URL)。",
    };
  }

  let jsonStr: string;
  try {
    jsonStr = urlSafeBase64ToString(trimmed);
  } catch (err: any) {
    return {
      success: false,
      error: "シナリオパラメータのBase64デコードに失敗しました (Malformed payload)。",
    };
  }

  // Canonical Base64URL 再検証: 再エンコード結果が入力と厳密一致することを確認 (寛容デコードによるバイパス防止)
  const reEncoded = stringToUrlSafeBase64(jsonStr);
  if (reEncoded !== trimmed) {
    return {
      success: false,
      error: "シナリオパラメータのBase64URL形式が正準(Canonical)ではありません (Malformed Base64URL)。",
    };
  }

  const decodedBytes = getUtf8ByteLength(jsonStr);
  if (decodedBytes > MAX_SCENARIO_PAYLOAD_BYTES) {
    return {
      success: false,
      error: `デコード後のシナリオJSONサイズ (${decodedBytes} bytes) が上限 (${MAX_SCENARIO_PAYLOAD_BYTES} bytes) を超過しています。`,
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err: any) {
    return { success: false, error: "シナリオパラメータのJSONパースに失敗しました。" };
  }

  const parseRes = parseScenarioDefinitionV1(parsed);
  if (!parseRes.success) {
    return {
      success: false,
      error: parseRes.errors
        .map((e) => `[${e.code}] ${e.path ? `${e.path}: ` : ""}${e.message}`)
        .join("; "),
    };
  }

  return {
    success: true,
    definition: normalizeScenarioDefinitionV1(parseRes.definition),
  };
}

/**
 * ベース URL と ScenarioDefinitionV1 から完全な共有 URL を構築します。
 */
export function buildScenarioShareUrl(baseUrl: string, def: ScenarioDefinitionV1): string {
  const param = encodeScenarioDefinitionV1ToUrlParam(def);
  const url = new URL(baseUrl);
  url.searchParams.set(SCENARIO_URL_PARAM_KEY, param);
  return url.toString();
}

/**
 * URL 文字列または location.search から Scenario パラメータを抽出してデコードします。
 */
export function parseScenarioShareUrl(urlOrSearch: string): ScenarioDecodeResult {
  if (!urlOrSearch) {
    return { success: false, error: "URLが空です。" };
  }

  let search = urlOrSearch;
  if (search.includes("?")) {
    search = search.split("?")[1];
  }
  if (search.includes("#")) {
    search = search.split("#")[0];
  }

  const params = new URLSearchParams(search);
  const scenarioParam = params.get(SCENARIO_URL_PARAM_KEY);
  if (!scenarioParam) {
    return { success: false, error: `URLに '${SCENARIO_URL_PARAM_KEY}' クエリパラメータが存在しません。` };
  }

  return decodeScenarioDefinitionV1FromUrlParam(scenarioParam);
}
