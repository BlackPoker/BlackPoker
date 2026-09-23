import { describe, it, expect } from "vitest";
import {
  encodeScenarioDefinitionV1ToUrlParam,
  decodeScenarioDefinitionV1FromUrlParam,
  buildScenarioShareUrl,
  parseScenarioShareUrl,
  stringToUrlSafeBase64,
  urlSafeBase64ToString,
  MAX_SCENARIO_PAYLOAD_BYTES,
  MAX_SCENARIO_ENCODED_BYTES,
  getUtf8ByteLength,
  SCENARIO_URL_PARAM_KEY,
} from "../../ui/scenario/ScenarioShareUrl";
import { ScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";

describe("ScenarioShareUrl Unit Tests (BP-SIM-SCENARIO-1.0-FOUNDATION)", () => {
  const sampleScenario: ScenarioDefinitionV1 = {
    version: 1,
    environmentId: "official:standard-pack",
    seed: 12345,
    turnPlayer: "p1",
    chancePlayer: "p2",
    turnCount: 3,
    name: "Shareable Test Scenario",
    description: "Scenario for URL share testing",
    players: {
      p1: {
        hand: [{ suit: "S", rank: "A" }],
        field: [
          {
            componentId: "character.hero",
            cards: [{ suit: "H", rank: "Q" }],
            state: "drive",
            face: "up",
          },
        ],
        grave: [{ suit: "C", rank: "6" }],
        life: { cards: [{ suit: "D", rank: "5" }], count: 3 },
        pack: { cards: [{ suit: "D", rank: "8" }], count: 10 },
      },
      p2: {
        hand: [{ suit: "S", rank: "3" }],
        life: { count: 4 },
        pack: { count: 11 },
      },
    },
  };

  it("1: Base64 URL-safe 相互変換の完全性", () => {
    const raw = "Hello, BlackPoker! ♠♡♢♣ 日本語シナリオテスト 12345 +/=";
    const encoded = stringToUrlSafeBase64(raw);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");

    const decoded = urlSafeBase64ToString(encoded);
    expect(decoded).toBe(raw);
  });

  it("2: ScenarioDefinitionV1 の encode -> decode round-trip 同値性", () => {
    const param = encodeScenarioDefinitionV1ToUrlParam(sampleScenario);
    expect(typeof param).toBe("string");
    expect(param.length).toBeGreaterThan(0);

    const result = decodeScenarioDefinitionV1FromUrlParam(param);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.definition).toEqual(sampleScenario);
    }
  });

  it("3: buildScenarioShareUrl と parseScenarioShareUrl の完全 URL round-trip", () => {
    const baseUrl = "https://simulator.blackpoker.org/playtest";
    const fullUrl = buildScenarioShareUrl(baseUrl, sampleScenario);

    expect(fullUrl).toContain(`${baseUrl}?${SCENARIO_URL_PARAM_KEY}=`);

    const result = parseScenarioShareUrl(fullUrl);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.definition).toEqual(sampleScenario);
    }
  });

  it("4: query string のみ (?scenario=...) からの parse", () => {
    const param = encodeScenarioDefinitionV1ToUrlParam(sampleScenario);
    const queryString = `?scenario=${param}&extra=ignore`;

    const result = parseScenarioShareUrl(queryString);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.definition).toEqual(sampleScenario);
    }
  });

  it("5: 空入力または不正 URL は fail-closed で失敗すること", () => {
    expect(parseScenarioShareUrl("").success).toBe(false);
    expect(parseScenarioShareUrl("https://example.com/no-scenario").success).toBe(false);
    expect(decodeScenarioDefinitionV1FromUrlParam("").success).toBe(false);
    expect(decodeScenarioDefinitionV1FromUrlParam("   ").success).toBe(false);
  });

  it("6: 不正な Base64 文字列 (Malformed) は fail-closed で失敗すること", () => {
    const malformed = "%%%invalid_base64!!!";
    const result = decodeScenarioDefinitionV1FromUrlParam(malformed);
    expect(result.success).toBe(false);
  });

  it("7: 不正な JSON ペイロードは fail-closed で失敗すること", () => {
    const invalidJsonBase64 = stringToUrlSafeBase64("{not valid json}");
    const result = decodeScenarioDefinitionV1FromUrlParam(invalidJsonBase64);
    expect(result.success).toBe(false);
  });

  it("8: 未知のバージョン (version !== 1) は fail-closed で拒絶されること", () => {
    const unknownVersionDef = {
      ...sampleScenario,
      version: 99,
    };
    const encoded = stringToUrlSafeBase64(JSON.stringify(unknownVersionDef));
    const result = decodeScenarioDefinitionV1FromUrlParam(encoded);

    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("UNSUPPORTED_VERSION");
    }
  });

  it("9: ペイロードサイズ超過 (> 64KB) は fail-closed で拒絶されること", () => {
    const hugeString = "A".repeat(MAX_SCENARIO_ENCODED_BYTES + 10);
    const result = decodeScenarioDefinitionV1FromUrlParam(hugeString);

    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("超過");
    }
  });

  it("10: Phase 概念を含む不正ペイロードは fail-closed で拒絶されること", () => {
    const dirtyDefWithPhase = {
      ...sampleScenario,
      phase: "mainPhase",
    };
    const encoded = stringToUrlSafeBase64(JSON.stringify(dirtyDefWithPhase));
    const result = decodeScenarioDefinitionV1FromUrlParam(encoded);

    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("BlackPoker にゲーム進行上の Phase は存在しません");
    }
  });

  it("11: 必須プロパティ欠落 (seed, turnPlayer, players) は fail-closed で拒絶されること", () => {
    const missingSeed = { ...sampleScenario, seed: undefined };
    const r1 = decodeScenarioDefinitionV1FromUrlParam(stringToUrlSafeBase64(JSON.stringify(missingSeed)));
    expect(r1.success).toBe(false);

    const invalidTurnPlayer = { ...sampleScenario, turnPlayer: "p3" };
    const r2 = decodeScenarioDefinitionV1FromUrlParam(stringToUrlSafeBase64(JSON.stringify(invalidTurnPlayer)));
    expect(r2.success).toBe(false);

    const missingPlayers = { ...sampleScenario, players: undefined };
    const r3 = decodeScenarioDefinitionV1FromUrlParam(stringToUrlSafeBase64(JSON.stringify(missingPlayers)));
    expect(r3.success).toBe(false);
  });

  it("12: 非Canonical Base64URL (padding '=', '+', '/', 不正長, 空白文字) は fail-closed で拒絶されること", () => {
    // 1. Single / double padding '=' 単独の拒絶
    expect(decodeScenarioDefinitionV1FromUrlParam("YWJjZA==").success).toBe(false);
    expect(decodeScenarioDefinitionV1FromUrlParam("YWJjZA=").success).toBe(false);

    // 2. 標準Base64文字 ('+', '/') の拒絶
    expect(decodeScenarioDefinitionV1FromUrlParam("ab+cd").success).toBe(false);
    expect(decodeScenarioDefinitionV1FromUrlParam("ab/cd").success).toBe(false);

    // 3. 不正長 (length % 4 === 1 は Base64 で数学的にあり得ない)
    expect(decodeScenarioDefinitionV1FromUrlParam("abcde").success).toBe(false);

    // 4. 空白文字 (スペース, 改行等)
    expect(decodeScenarioDefinitionV1FromUrlParam(" abc ").success).toBe(false);
    expect(decodeScenarioDefinitionV1FromUrlParam("abc\n").success).toBe(false);
  });

  it("13: デコード後 UTF-8 バイト数超過 (> 64KB) は fail-closed で拒絶されること", () => {
    // 87384 chars in Base64 can decode up to 65538 bytes (> 65536).
    // Construct a payload whose Base64 encoded length is <= MAX_SCENARIO_ENCODED_BYTES (87384),
    // but decoded UTF-8 length is > MAX_SCENARIO_PAYLOAD_BYTES (65536).
    const baseObj = { ...sampleScenario, description: "" };
    const baseLen = getUtf8ByteLength(JSON.stringify(baseObj));
    const targetDescLen = 65537 - baseLen;
    const largeDef = { ...sampleScenario, description: "x".repeat(targetDescLen) };
    const jsonStr = JSON.stringify(largeDef);
    const encoded = stringToUrlSafeBase64(jsonStr);

    expect(encoded.length).toBeLessThanOrEqual(MAX_SCENARIO_ENCODED_BYTES);
    const result = decodeScenarioDefinitionV1FromUrlParam(encoded);
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("上限 (65536 bytes) を超過しています");
    }
  });
});
