import { deflateSync, Inflate } from "fflate";
import {
  ScenarioDefinitionV1,
  SCENARIO_SCHEMA_VERSION,
  parseScenarioDefinitionV1,
  normalizeScenarioDefinitionV1,
} from "../../domain/scenario/ScenarioTypes";

export const SCENARIO_URL_PARAM_KEY = "scenario";

// 展開後 JSON UTF-8 バイト長の上限 (64 KB)
export const MAX_SCENARIO_PAYLOAD_BYTES = 65536;

// レガシー未圧縮ペイロードの文字数上限 (64KB を Base64 化した際の上限: 87384 chars)
export const LEGACY_SCENARIO_ENCODED_CHARS = Math.ceil(MAX_SCENARIO_PAYLOAD_BYTES / 3) * 4;
export const MAX_SCENARIO_ENCODED_CHARS = LEGACY_SCENARIO_ENCODED_CHARS;
export const MAX_SCENARIO_ENCODED_BYTES = MAX_SCENARIO_ENCODED_CHARS;

// 圧縮ペイロードの接頭辞
export const SCENARIO_COMPRESSION_PREFIX = "z1.";
const COMPRESSION_PREFIX_PATTERN = /^z([0-9]+)\./;

// 圧縮入力のサイズ上限: 64KB 元データが圧縮されて 64KB を超えることはないため、
// 圧縮バイナリ上限は 64KB (65536 bytes)、Base64URL 文字数上限は 87384 + prefix (3) = 87387 chars と保守的に設定
export const MAX_SCENARIO_COMPRESSED_BYTES = 65536;
export const MAX_SCENARIO_COMPRESSED_ENCODED_CHARS =
  Math.ceil(MAX_SCENARIO_COMPRESSED_BYTES / 3) * 4 + SCENARIO_COMPRESSION_PREFIX.length;

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
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_LOOKUP = new Int16Array(256).fill(-1);
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

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
 * バイナリ (Uint8Array) を URL-safe Base64 文字列へ変換（padding なし）
 * Node / Browser 双方で同一の動作を保証します。
 */
export function bytesToUrlSafeBase64(bytes: Uint8Array): string {
  let result = "";
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    result += B64_CHARS[b0 >> 2];
    result += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    result += B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)];
    result += B64_CHARS[b2 & 63];
  }
  if (i < len) {
    const b0 = bytes[i];
    result += B64_CHARS[b0 >> 2];
    if (i + 1 < len) {
      const b1 = bytes[i + 1];
      result += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
      result += B64_CHARS[(b1 & 15) << 2];
    } else {
      result += B64_CHARS[(b0 & 3) << 4];
    }
  }
  return result;
}

/**
 * URL-safe Base64 文字列をバイナリ (Uint8Array) へ復元
 * 不正文字、不正長 (len % 4 === 1)、padding ('=') がある場合は null を返します。
 */
export function urlSafeBase64ToBytes(str: string): Uint8Array | null {
  if (str.length === 0) return new Uint8Array(0);
  if (str.length % 4 === 1) return null;

  for (let j = 0; j < str.length; j++) {
    const code = str.charCodeAt(j);
    if (code > 255 || B64_LOOKUP[code] === -1) {
      return null;
    }
  }

  const len = str.length;
  const rem = len % 4;
  const byteLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(byteLen);
  let outIdx = 0;
  let i = 0;
  for (; i + 3 < len; i += 4) {
    const c0 = B64_LOOKUP[str.charCodeAt(i)];
    const c1 = B64_LOOKUP[str.charCodeAt(i + 1)];
    const c2 = B64_LOOKUP[str.charCodeAt(i + 2)];
    const c3 = B64_LOOKUP[str.charCodeAt(i + 3)];
    out[outIdx++] = (c0 << 2) | (c1 >> 4);
    out[outIdx++] = ((c1 & 15) << 4) | (c2 >> 2);
    out[outIdx++] = ((c2 & 3) << 6) | c3;
  }
  if (rem === 2) {
    const c0 = B64_LOOKUP[str.charCodeAt(i)];
    const c1 = B64_LOOKUP[str.charCodeAt(i + 1)];
    out[outIdx++] = (c0 << 2) | (c1 >> 4);
  } else if (rem === 3) {
    const c0 = B64_LOOKUP[str.charCodeAt(i)];
    const c1 = B64_LOOKUP[str.charCodeAt(i + 1)];
    const c2 = B64_LOOKUP[str.charCodeAt(i + 2)];
    out[outIdx++] = (c0 << 2) | (c1 >> 4);
    out[outIdx++] = ((c1 & 15) << 4) | (c2 >> 2);
  }
  return out;
}

/**
 * UTF-8 文字列を URL-safe Base64 文字列へ変換（Legacy 互換用）
 */
export function stringToUrlSafeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return bytesToUrlSafeBase64(bytes);
}

/**
 * URL-safe Base64 文字列を UTF-8 文字列へ復元（Legacy 互換用）
 * 厳格な UTF-8 検証 ({ fatal: true }) を実施します。
 */
export function urlSafeBase64ToString(base64Url: string): string {
  const bytes = urlSafeBase64ToBytes(base64Url);
  if (!bytes) {
    throw new Error("Malformed Base64URL string");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return decoder.decode(bytes);
}

/**
 * fflate の Inflate を用いて上限サイズ制約を強制しながら有界展開 (Bounded Decompression) します。
 * 展開中の合計バイト数が maxBytes を超えた時点で即座に例外を投げて中断します (Decompression Bomb 対策)。
 */
export function decompressWithLimit(compressed: Uint8Array, maxBytes: number): Uint8Array {
  let totalBytes = 0;
  const chunks: Uint8Array[] = [];
  let exceeded = false;

  const inf = new Inflate((chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      exceeded = true;
      throw new Error(`展開後データサイズが上限 (${maxBytes} bytes) を超過しました。`);
    }
    chunks.push(chunk);
  });

  const chunkSize = 512;
  for (let offset = 0; offset < compressed.length; offset += chunkSize) {
    if (exceeded) break;
    const end = Math.min(offset + chunkSize, compressed.length);
    const isFinal = end === compressed.length;
    inf.push(compressed.subarray(offset, end), isFinal);
  }

  if (exceeded || totalBytes > maxBytes) {
    throw new Error(`展開後データサイズが上限 (${maxBytes} bytes) を超過しました。`);
  }

  const result = new Uint8Array(totalBytes);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

/**
 * レガシー形式 (未圧縮 Base64URL JSON) でエンコードします (互換性検証用)。
 */
export function encodeScenarioDefinitionV1ToLegacyUrlParam(def: ScenarioDefinitionV1): string {
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
 * ScenarioDefinitionV1 を URL パラメータ用文字列へ圧縮エンコードします (z1 形式)。
 * Raw GameState は含めず、高レベル Scenario 定義を正規化した上で DEFLATE 圧縮直列化します。
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
  const utf8Bytes = new TextEncoder().encode(jsonStr);
  if (utf8Bytes.length > MAX_SCENARIO_PAYLOAD_BYTES) {
    throw new Error(
      `シナリオ定義のJSONサイズ (${utf8Bytes.length} bytes) が上限 (${MAX_SCENARIO_PAYLOAD_BYTES} bytes) を超過しています。`
    );
  }

  // 決定論的 DEFLATE 圧縮 (level: 9)
  const compressed = deflateSync(utf8Bytes, { level: 9 });
  const b64 = bytesToUrlSafeBase64(compressed);
  return `${SCENARIO_COMPRESSION_PREFIX}${b64}`;
}

/**
 * z1 圧縮シナリオパラメータをデコード・検証します。
 */
function decodeCompressedScenarioParam(param: string): ScenarioDecodeResult {
  // 文字数制約の検査
  if (param.length > MAX_SCENARIO_COMPRESSED_ENCODED_CHARS) {
    return {
      success: false,
      error: `圧縮シナリオパラメータが許容文字数 (${MAX_SCENARIO_COMPRESSED_ENCODED_CHARS} chars) を超過しています。`,
    };
  }

  const body = param.slice(SCENARIO_COMPRESSION_PREFIX.length);
  if (body.length === 0) {
    return {
      success: false,
      error: "圧縮シナリオパラメータのBase64URL形式が不正です (Malformed Base64URL)。",
    };
  }

  // Base64URL 厳格フォーマットチェック (padding '=' の禁止、文字種および長さ % 4 !== 1)
  if (!BASE64_URL_PATTERN.test(body) || body.length % 4 === 1) {
    return {
      success: false,
      error: "圧縮シナリオパラメータのBase64URL形式が不正です (Malformed Base64URL)。",
    };
  }

  const compressedBytes = urlSafeBase64ToBytes(body);
  if (!compressedBytes) {
    return {
      success: false,
      error: "圧縮シナリオパラメータのBase64URL形式が不正です (Malformed Base64URL)。",
    };
  }

  // Canonical Base64URL 再検証: 再エンコード結果が入力 body と厳密一致することを確認
  const reEncoded = bytesToUrlSafeBase64(compressedBytes);
  if (reEncoded !== body) {
    return {
      success: false,
      error: "圧縮シナリオパラメータのBase64URL形式が正準(Canonical)ではありません (Malformed Base64URL)。",
    };
  }

  if (compressedBytes.length > MAX_SCENARIO_COMPRESSED_BYTES) {
    return {
      success: false,
      error: `圧縮シナリオパラメータのサイズ (${compressedBytes.length} bytes) が上限 (${MAX_SCENARIO_COMPRESSED_BYTES} bytes) を超過しています。`,
    };
  }

  // Bounded Decompression
  let decompressedBytes: Uint8Array;
  try {
    decompressedBytes = decompressWithLimit(compressedBytes, MAX_SCENARIO_PAYLOAD_BYTES);
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes("超過")) {
      return {
        success: false,
        error: `展開後のシナリオJSONサイズが上限 (${MAX_SCENARIO_PAYLOAD_BYTES} bytes) を超過しています。`,
      };
    }
    return {
      success: false,
      error: `シナリオデータの展開に失敗しました (Decompression failed: ${msg})。`,
    };
  }

  if (decompressedBytes.length > MAX_SCENARIO_PAYLOAD_BYTES) {
    return {
      success: false,
      error: `展開後のシナリオJSONサイズ (${decompressedBytes.length} bytes) が上限 (${MAX_SCENARIO_PAYLOAD_BYTES} bytes) を超過しています。`,
    };
  }

  // Strict UTF-8 validation
  let jsonStr: string;
  try {
    const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
    jsonStr = utf8Decoder.decode(decompressedBytes);
  } catch (err: any) {
    return {
      success: false,
      error: "展開されたシナリオデータが有効なUTF-8ではありません (Invalid UTF-8)。",
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
 * レガシー未圧縮シナリオパラメータをデコード・検証します。
 */
function decodeLegacyScenarioParam(param: string): ScenarioDecodeResult {
  // 文字数制約の検査
  if (param.length > MAX_SCENARIO_ENCODED_CHARS) {
    return {
      success: false,
      error: `シナリオパラメータが許容エンコード文字数 (${MAX_SCENARIO_ENCODED_CHARS} chars) を超過しています。`,
    };
  }

  // Base64URL 厳格フォーマットチェック (padding '=' の禁止、文字種および長さ % 4 !== 1)
  if (!BASE64_URL_PATTERN.test(param) || param.length % 4 === 1) {
    return {
      success: false,
      error: "シナリオパラメータのBase64URL形式が不正です (Malformed Base64URL)。",
    };
  }

  let jsonStr: string;
  try {
    jsonStr = urlSafeBase64ToString(param);
  } catch (err: any) {
    return {
      success: false,
      error: "シナリオパラメータのBase64デコードに失敗しました (Malformed payload)。",
    };
  }

  // Canonical Base64URL 再検証: 再エンコード結果が入力と厳密一致することを確認 (寛容デコードによるバイパス防止)
  const reEncoded = stringToUrlSafeBase64(jsonStr);
  if (reEncoded !== param) {
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
 * URL パラメータ文字列から ScenarioDefinitionV1 をデコード・厳格検証します。
 * 新形式 (z1.<Base64URL>) およびレガシー形式 (<Base64URL>) の双方に対応します。
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

  // 1. 圧縮 Envelope 判定 (z1.)
  if (trimmed.startsWith(SCENARIO_COMPRESSION_PREFIX)) {
    return decodeCompressedScenarioParam(trimmed);
  }

  // 未知の z<number>. 形式の検知 (レガシーフォールバック禁止・fail-closed)
  const prefixMatch = trimmed.match(COMPRESSION_PREFIX_PATTERN);
  if (prefixMatch) {
    return {
      success: false,
      error: `未対応のシナリオ圧縮フォーマットです (Unsupported compression format: z${prefixMatch[1]})。`,
    };
  }

  // 2. レガシー形式デコーダー
  return decodeLegacyScenarioParam(trimmed);
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
