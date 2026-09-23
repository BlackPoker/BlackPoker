import { describe, it, expect } from "vitest";
import {
  encodeScenarioDefinitionV1ToUrlParam,
  decodeScenarioDefinitionV1FromUrlParam,
  buildScenarioShareUrl,
  parseScenarioShareUrl,
  stringToUrlSafeBase64,
  urlSafeBase64ToString,
  MAX_SCENARIO_PAYLOAD_BYTES,
  SCENARIO_URL_PARAM_KEY,
} from "../../ui/scenario/ScenarioShareUrl";
import { ScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";

describe("ScenarioShareUrl Unit Tests (BP-SIM-SCENARIO-1.0-FOUNDATION)", () => {
  const sampleScenario: ScenarioDefinitionV1 = {
    version: 1,
    environmentId: "official:light-entry16",
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
            card: { suit: "H", rank: "Q" },
            state: "drive",
            face: "up",
          },
        ],
        grave: [{ suit: "C", rank: "6" }],
        life: { count: 3 },
        pack: { count: 10 },
      },
      p2: {
        hand: [{ suit: "S", rank: "3" }],
        field: [],
        grave: [],
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
      expect(result.error).toContain("未知または未対応のシナリオバージョン");
    }
  });

  it("9: ペイロードサイズ超過 (> 64KB) は fail-closed で拒絶されること", () => {
    const hugeString = "A".repeat(MAX_SCENARIO_PAYLOAD_BYTES + 10);
    const result = decodeScenarioDefinitionV1FromUrlParam(hugeString);

    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("許容サイズ");
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
});
