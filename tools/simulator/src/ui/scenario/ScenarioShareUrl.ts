import {
  ScenarioDefinitionV1,
  SCENARIO_SCHEMA_VERSION,
} from "../../domain/scenario/ScenarioTypes";

export const SCENARIO_URL_PARAM_KEY = "scenario";
export const MAX_SCENARIO_PAYLOAD_BYTES = 65536; // 64 KB

export type ScenarioDecodeResult =
  | {
      readonly success: true;
      readonly definition: ScenarioDefinitionV1;
    }
  | {
      readonly success: false;
      readonly error: string;
    };

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
 * Raw GameState は含めず、高レベル Scenario 定義のみを直列化します。
 */
export function encodeScenarioDefinitionV1ToUrlParam(def: ScenarioDefinitionV1): string {
  if (def.version !== SCENARIO_SCHEMA_VERSION) {
    throw new Error(`サポートされていないScenarioバージョンです (${def.version})。`);
  }
  const jsonStr = JSON.stringify(def);
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

  const trimmed = param.trim();
  if (trimmed.length > MAX_SCENARIO_PAYLOAD_BYTES) {
    return {
      success: false,
      error: `シナリオパラメータが許容サイズ (${MAX_SCENARIO_PAYLOAD_BYTES} bytes) を超過しています。`,
    };
  }

  let jsonStr: string;
  try {
    jsonStr = urlSafeBase64ToString(trimmed);
  } catch (err: any) {
    return { success: false, error: "シナリオパラメータのBase64デコードに失敗しました (Malformed payload)。" };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err: any) {
    return { success: false, error: "シナリオパラメータのJSONパースに失敗しました。" };
  }

  if (!parsed || typeof parsed !== "object") {
    return { success: false, error: "シナリオ定義がオブジェクトではありません。" };
  }

  if (parsed.version !== SCENARIO_SCHEMA_VERSION) {
    return {
      success: false,
      error: `未知または未対応のシナリオバージョンです (${parsed.version})。現行バージョンは ${SCENARIO_SCHEMA_VERSION} です。`,
    };
  }

  if (!parsed.environmentId || typeof parsed.environmentId !== "string") {
    return { success: false, error: "environmentId が指定されていないか文字列ではありません。" };
  }

  if (typeof parsed.seed !== "number" || !Number.isSafeInteger(parsed.seed) || parsed.seed < 0) {
    return { success: false, error: "seed は非負の安全な整数でなければなりません。" };
  }

  if (parsed.turnPlayer !== "p1" && parsed.turnPlayer !== "p2") {
    return { success: false, error: "turnPlayer は 'p1' または 'p2' でなければなりません。" };
  }

  if (parsed.chancePlayer !== "p1" && parsed.chancePlayer !== "p2") {
    return { success: false, error: "chancePlayer は 'p1' または 'p2' でなければなりません。" };
  }

  if (!parsed.players || typeof parsed.players !== "object" || !parsed.players.p1 || !parsed.players.p2) {
    return { success: false, error: "players.p1 および players.p2 の定義が必要です。" };
  }

  // Phase や Stage などの不正フィールド検出
  if (parsed.stage?.requests && Array.isArray(parsed.stage.requests) && parsed.stage.requests.length > 0) {
    return { success: false, error: "Scenario Builder V1 では非空の stage.requests は許可されていません。" };
  }
  if (parsed.phase !== undefined || parsed.turnPhase !== undefined || parsed.currentPhase !== undefined) {
    return { success: false, error: "BlackPoker にゲーム進行上の Phase は存在しません。" };
  }

  return {
    success: true,
    definition: parsed as ScenarioDefinitionV1,
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
