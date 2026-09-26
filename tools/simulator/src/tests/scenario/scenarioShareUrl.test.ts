import { describe, it, expect } from "vitest";
import { deflateSync } from "fflate";
import {
  encodeScenarioDefinitionV1ToUrlParam,
  encodeScenarioDefinitionV1ToLegacyUrlParam,
  decodeScenarioDefinitionV1FromUrlParam,
  buildScenarioShareUrl,
  parseScenarioShareUrl,
  stringToUrlSafeBase64,
  urlSafeBase64ToString,
  bytesToUrlSafeBase64,
  urlSafeBase64ToBytes,
  MAX_SCENARIO_PAYLOAD_BYTES,
  MAX_SCENARIO_ENCODED_BYTES,
  MAX_SCENARIO_COMPRESSED_BYTES,
  MAX_SCENARIO_COMPRESSED_ENCODED_CHARS,
  SCENARIO_COMPRESSION_PREFIX,
  getUtf8ByteLength,
  SCENARIO_URL_PARAM_KEY,
} from "../../ui/scenario/ScenarioShareUrl";
import { ScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";
import { ScenarioAuthoringDraftV1 } from "../../domain/scenario/ScenarioAuthoringTypes";
import { ScenarioAuthoringResolver } from "../../engine/scenario/ScenarioAuthoringResolver";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { ScenarioCompiler } from "../../engine/scenario/ScenarioCompiler";

describe("ScenarioShareUrl Unit Tests (BP-SIM-SCENARIO-1.0-FOUNDATION & BP-SIM-SHARE-1.1-SCENARIO-COMPRESSION)", () => {
  const catalog = loadRegulationCatalogForBrowser();

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

  it("2: ScenarioDefinitionV1 の encode -> decode round-trip 同値性 (z1 形式)", () => {
    const param = encodeScenarioDefinitionV1ToUrlParam(sampleScenario);
    expect(typeof param).toBe("string");
    expect(param.startsWith(SCENARIO_COMPRESSION_PREFIX)).toBe(true);

    const result = decodeScenarioDefinitionV1FromUrlParam(param);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.definition).toEqual(sampleScenario);
    }
  });

  it("3: buildScenarioShareUrl と parseScenarioShareUrl の完全 URL round-trip", () => {
    const baseUrl = "https://simulator.blackpoker.org/playtest";
    const fullUrl = buildScenarioShareUrl(baseUrl, sampleScenario);

    expect(fullUrl).toContain(`${baseUrl}?${SCENARIO_URL_PARAM_KEY}=${SCENARIO_COMPRESSION_PREFIX}`);

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

  // ========================================================================
  // Section 30: Backward Compatibility & Compression Hardening Tests (A〜O)
  // ========================================================================

  it("14 (Test A): legacy decode continues to work (既存未圧縮URLの完全な後方互換性)", () => {
    const legacyParam = encodeScenarioDefinitionV1ToLegacyUrlParam(sampleScenario);
    expect(legacyParam.startsWith("z1.")).toBe(false);

    const decoded = decodeScenarioDefinitionV1FromUrlParam(legacyParam);
    expect(decoded.success).toBe(true);
    if (decoded.success) {
      expect(decoded.definition).toEqual(sampleScenario);
    }
  });

  it("15 (Test B & C): new encoder emits z1. prefix and z1 decode works", () => {
    const z1Param = encodeScenarioDefinitionV1ToUrlParam(sampleScenario);
    expect(z1Param.startsWith("z1.")).toBe(true);

    const decoded = decodeScenarioDefinitionV1FromUrlParam(z1Param);
    expect(decoded.success).toBe(true);
    if (decoded.success) {
      expect(decoded.definition).toEqual(sampleScenario);
    }
  });

  it("16 (Test D): legacy and z1 decode equal (同一Scenarioに対する復元結果の完全一致)", () => {
    const legacyParam = encodeScenarioDefinitionV1ToLegacyUrlParam(sampleScenario);
    const z1Param = encodeScenarioDefinitionV1ToUrlParam(sampleScenario);

    const legacyResult = decodeScenarioDefinitionV1FromUrlParam(legacyParam);
    const z1Result = decodeScenarioDefinitionV1FromUrlParam(z1Param);

    expect(legacyResult.success).toBe(true);
    expect(z1Result.success).toBe(true);
    if (legacyResult.success && z1Result.success) {
      expect(legacyResult.definition).toEqual(z1Result.definition);
    }
  });

  it("17 (Test E): malformed z1 rejected (破損した z1 は fail-closed で失敗し legacy フォールバックしないこと)", () => {
    const r1 = decodeScenarioDefinitionV1FromUrlParam("z1.");
    expect(r1.success).toBe(false);

    const r2 = decodeScenarioDefinitionV1FromUrlParam("z1.%%invalid_base64!!");
    expect(r2.success).toBe(false);

    const r3 = decodeScenarioDefinitionV1FromUrlParam("z1.abcde"); // length % 4 === 1
    expect(r3.success).toBe(false);
  });

  it("18 (Test F): unknown z2 rejected (未知の z<number>. 形式は fail-closed で明示エラーとなること)", () => {
    const r1 = decodeScenarioDefinitionV1FromUrlParam("z2.YWJjZA");
    expect(r1.success).toBe(false);
    if (r1.success === false) {
      expect(r1.error).toContain("Unsupported compression format: z2");
    }

    const r2 = decodeScenarioDefinitionV1FromUrlParam("z99.YWJjZA");
    expect(r2.success).toBe(false);
    if (r2.success === false) {
      expect(r2.error).toContain("Unsupported compression format: z99");
    }
  });

  it("19 (Test G): z1 invalid Base64URL rejected (padding, +, / を拒絶)", () => {
    expect(decodeScenarioDefinitionV1FromUrlParam("z1.YWJjZA==").success).toBe(false);
    expect(decodeScenarioDefinitionV1FromUrlParam("z1.YWJjZA=").success).toBe(false);
    expect(decodeScenarioDefinitionV1FromUrlParam("z1.ab+cd").success).toBe(false);
    expect(decodeScenarioDefinitionV1FromUrlParam("z1.ab/cd").success).toBe(false);
  });

  it("20 (Test H): z1 whitespace rejected (空白文字を含む入力を fail-closed 拒絶)", () => {
    expect(decodeScenarioDefinitionV1FromUrlParam(" z1.YWJj").success).toBe(false);
    expect(decodeScenarioDefinitionV1FromUrlParam("z1. YWJj").success).toBe(false);
    expect(decodeScenarioDefinitionV1FromUrlParam("z1.YWJj ").success).toBe(false);
    expect(decodeScenarioDefinitionV1FromUrlParam("z1.YWJj\n").success).toBe(false);
  });

  it("21 (Test I): compressed input size over limit rejected (圧縮入力文字数上限超過を拒絶)", () => {
    const hugeZ1 = "z1." + "A".repeat(MAX_SCENARIO_COMPRESSED_ENCODED_CHARS + 1);
    const result = decodeScenarioDefinitionV1FromUrlParam(hugeZ1);
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("許容文字数");
    }
  });

  it("22 (Test J): decompressed result > 64KB rejected (Decompression Bomb 対策 / Bounded Decompression)", () => {
    // 巨大な空白JSON (100KB) を圧縮して z1 エンコード
    const hugeBomb = " ".repeat(100000);
    const compressed = deflateSync(new TextEncoder().encode(hugeBomb), { level: 9 });
    const bombParam = "z1." + bytesToUrlSafeBase64(compressed);

    const result = decodeScenarioDefinitionV1FromUrlParam(bombParam);
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("上限 (65536 bytes) を超過");
    }
  });

  it("23 (Test K): invalid UTF-8 rejected (展開データが不正な UTF-8 の場合は拒絶)", () => {
    // 不正な UTF-8 バイト列 [0xff, 0xff] を圧縮
    const invalidUtf8 = new Uint8Array([0xff, 0xff]);
    const compressed = deflateSync(invalidUtf8, { level: 9 });
    const param = "z1." + bytesToUrlSafeBase64(compressed);

    const result = decodeScenarioDefinitionV1FromUrlParam(param);
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("Invalid UTF-8");
    }
  });

  it("24 (Test L): invalid JSON rejected (展開データが不正な JSON の場合はパースエラー)", () => {
    const invalidJson = "{ not a valid json }";
    const compressed = deflateSync(new TextEncoder().encode(invalidJson), { level: 9 });
    const param = "z1." + bytesToUrlSafeBase64(compressed);

    const result = decodeScenarioDefinitionV1FromUrlParam(param);
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("JSONパースに失敗");
    }
  });

  it("25 (Test M): valid JSON but invalid ScenarioDefinitionV1 rejected", () => {
    const invalidScenario = { foo: "bar" };
    const compressed = deflateSync(new TextEncoder().encode(JSON.stringify(invalidScenario)), { level: 9 });
    const param = "z1." + bytesToUrlSafeBase64(compressed);

    const result = decodeScenarioDefinitionV1FromUrlParam(param);
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain("UNSUPPORTED_VERSION");
    }
  });

  it("26 (Test N): encode deterministic (同一定義に対するエンコード結果の決定論的一致)", () => {
    const enc1 = encodeScenarioDefinitionV1ToUrlParam(sampleScenario);
    for (let i = 0; i < 10; i++) {
      const encN = encodeScenarioDefinitionV1ToUrlParam(sampleScenario);
      expect(encN).toBe(enc1);
    }
  });

  it("27 (Test O & Section 26): 2018 詰めBlackPoker (TSUME-2018-001) の圧縮効果測定", () => {
    const tsumeDraft: ScenarioAuthoringDraftV1 = {
      environmentId: "official:standard-pack",
      seed: 2018,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 1,
      name: "2018 詰めBlackPoker 第1問 (TSUME-2018-001)",
      description: "先手7枚手札・防壁1枚・ライフ2枚 vs 後手兵士2体・ライフ37枚",
      players: {
        p1: {
          life: { count: 2 },
          hand: {
            count: 7,
            fixedCards: [
              { suit: "H", rank: "7" },
              { suit: "H", rank: "8" },
              { suit: "H", rank: "9" },
              { suit: "H", rank: "10" },
              { suit: "C", rank: "3" },
              { suit: "C", rank: "4" },
              { suit: "J", rank: "Joker" },
            ],
          },
          field: [
            {
              componentId: "character.bulwark",
              cards: [{ suit: "S", rank: "3" }],
              state: "charge",
              face: "down",
            },
          ],
        },
        p2: {
          life: { count: 37 },
          field: [
            {
              componentId: "character.soldier",
              cards: [{ suit: "D", rank: "10" }],
              state: "drive",
              face: "up",
            },
            {
              componentId: "character.soldier",
              cards: [{ suit: "C", rank: "8" }],
              state: "drive",
              face: "up",
            },
          ],
        },
      },
    };

    const resolveResult = ScenarioAuthoringResolver.resolve(tsumeDraft, catalog);
    expect(resolveResult.success).toBe(true);
    if (!resolveResult.success) return;

    const def = resolveResult.definition;
    const jsonStr = JSON.stringify(def);
    const jsonUtf8Bytes = getUtf8ByteLength(jsonStr);

    const legacyPayload = encodeScenarioDefinitionV1ToLegacyUrlParam(def);
    const z1Payload = encodeScenarioDefinitionV1ToUrlParam(def);

    const baseUrl = "https://simulator.blackpoker.org/playtest";
    const legacyFullUrl = `${baseUrl}?${SCENARIO_URL_PARAM_KEY}=${legacyPayload}`;
    const z1FullUrl = buildScenarioShareUrl(baseUrl, def);

    const reductionChars = legacyPayload.length - z1Payload.length;
    const reductionPercent = ((reductionChars / legacyPayload.length) * 100).toFixed(2);

    console.log("=== TSUME-2018-001 Share URL Compression Measurement ===");
    console.log(`JSON UTF-8: ${jsonUtf8Bytes} bytes`);
    console.log(`Legacy scenario payload: ${legacyPayload.length} chars`);
    console.log(`z1 scenario payload: ${z1Payload.length} chars`);
    console.log(`Legacy full share URL: ${legacyFullUrl.length} chars`);
    console.log(`z1 full share URL: ${z1FullUrl.length} chars`);
    console.log(`Reduction: ${reductionChars} chars (${reductionPercent}%)`);

    // 圧縮効果の検証
    expect(z1Payload.length).toBeLessThan(legacyPayload.length);
    expect(z1FullUrl.length).toBeLessThan(legacyFullUrl.length);
    expect(reductionChars).toBeGreaterThan(0);

    // 復元の同値性検証
    const decodedLegacy = decodeScenarioDefinitionV1FromUrlParam(legacyPayload);
    const decodedZ1 = decodeScenarioDefinitionV1FromUrlParam(z1Payload);
    expect(decodedLegacy.success).toBe(true);
    expect(decodedZ1.success).toBe(true);
    if (decodedLegacy.success && decodedZ1.success) {
      expect(decodedLegacy.definition).toEqual(decodedZ1.definition);
      expect(decodedZ1.definition).toEqual(def);
    }
  });

  it("21: (BP-SIM-SCENARIO-1.3-R1) pack.opened: true / absent の z1 URL 共有 round-trip とコンパイル健全性", () => {
    const fullRulePackage = loadRulePackageForBrowser();

    const scenarioWithPack: ScenarioDefinitionV1 = {
      version: 1,
      environmentId: "official:standard-pack",
      seed: 42,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 1,
      players: {
        p1: {
          hand: [{ suit: "S", rank: "A" }],
          pack: { count: 14, opened: true },
        },
        p2: {
          hand: [{ suit: "H", rank: "A" }],
          pack: { count: 14 }, // absent -> canonical: opened omitted
        },
      },
    };

    // 1. URL エンコード (z1形式)
    const param = encodeScenarioDefinitionV1ToUrlParam(scenarioWithPack);
    expect(param.startsWith(SCENARIO_COMPRESSION_PREFIX)).toBe(true);

    // 2. URL デコード
    const decodeResult = decodeScenarioDefinitionV1FromUrlParam(param);
    expect(decodeResult.success).toBe(true);
    if (!decodeResult.success) return;

    const decoded = decodeResult.definition;
    // Canonical 表現: p1 は opened: true, p2 は opened: undefined (省略)
    expect(decoded.players.p1.pack?.opened).toBe(true);
    expect(decoded.players.p2.pack?.opened).toBeUndefined();

    // 3. コンパイル後の GameState: p1 は true, p2 は false
    const compileResult = ScenarioCompiler.compile(decoded, catalog, fullRulePackage);
    expect(compileResult.kind).toBe("READY");
    if (compileResult.kind === "READY") {
      expect(compileResult.state.players.p1.pack.opened).toBe(true);
      expect(compileResult.state.players.p2.pack.opened).toBe(false);
    }
  });
});
