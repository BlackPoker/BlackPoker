import { describe, it, expect } from "vitest";
import { ScenarioAuthoringResolver } from "../../engine/scenario/ScenarioAuthoringResolver";
import { ScenarioAuthoringDraftV1 } from "../../domain/scenario/ScenarioAuthoringTypes";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { ScenarioCompiler } from "../../engine/scenario/ScenarioCompiler";
import {
  encodeScenarioDefinitionV1ToUrlParam,
  decodeScenarioDefinitionV1FromUrlParam,
  MAX_SCENARIO_PAYLOAD_BYTES,
  MAX_SCENARIO_ENCODED_CHARS,
  getUtf8ByteLength,
} from "../../ui/scenario/ScenarioShareUrl";

describe("TSUME-2018-001 Acceptance Tests (BP-SIM-SCENARIO-1.2-POSITION-AUTHORING)", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();

  /**
   * 2018 詰めBlackPoker 第1問 (TSUME-2018-001)
   *
   * レギュレーション: official:standard-pack (全54枚, パック14枚)
   *
   * 先手 (Player A):
   * - ライフ: 2枚 (内容は任意・自動補完)
   * - 手札: 7枚固定 (♡7, ♡8, ♡9, ♡10, ♣3, ♣4, Joker)
   * - 場: ♠3 防壁 (裏向き・チャージ)
   * - パック: 規定14枚 (自動補完)
   * - 墓地: 残余30枚が自動補完 (54 - 2 - 7 - 1 - 14 = 30)
   *
   * 後手 (Player B):
   * - ライフ: 37枚 (内容は任意・自動補完)
   * - 手札: 0枚
   * - 場: ♢10 兵士 (表向き・ドライブ), ♣8 兵士 (表向き・ドライブ)
   * - パック: 規定14枚 (自動補完)
   * - 墓地: 残余1枚が自動補完 (54 - 37 - 2 - 14 = 1)
   */
  const tsume2018Draft: ScenarioAuthoringDraftV1 = {
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

  it("1: TSUME-2018-001 の部分指定ドラフトが ScenarioAuthoringResolver で正しく解決されること", () => {
    const resolveResult = ScenarioAuthoringResolver.resolve(tsume2018Draft, catalog);
    expect(resolveResult.success).toBe(true);
    if (!resolveResult.success) {
      console.error(resolveResult.errors);
      return;
    }

    const def = resolveResult.definition;
    expect(def.environmentId).toBe("official:standard-pack");
    expect(def.seed).toBe(2018);
    expect(def.turnPlayer).toBe("p1");
    expect(def.chancePlayer).toBe("p1");

    // Player A (P1) の検証
    const p1 = def.players.p1;
    expect(p1.field).toHaveLength(1);
    expect(p1.field![0]).toEqual({
      componentId: "character.bulwark",
      cards: [{ suit: "S", rank: "3" }],
      state: "charge",
      face: "down",
    });

    expect(p1.hand).toHaveLength(7);
    expect(p1.hand![0]).toEqual({ suit: "H", rank: "7" });
    expect(p1.hand![1]).toEqual({ suit: "H", rank: "8" });
    expect(p1.hand![2]).toEqual({ suit: "H", rank: "9" });
    expect(p1.hand![3]).toEqual({ suit: "H", rank: "10" });
    expect(p1.hand![4]).toEqual({ suit: "C", rank: "3" });
    expect(p1.hand![5]).toEqual({ suit: "C", rank: "4" });
    // Joker は occurrence: 0 として解決されていること
    expect(p1.hand![6]).toEqual({ suit: "J", rank: "Joker", occurrence: 0 });

    expect(p1.life?.count).toBe(2);
    expect(p1.life?.cards).toHaveLength(2);

    expect(p1.pack?.count).toBe(14);
    expect(p1.pack?.cards).toHaveLength(14);

    // 残余30枚が墓地へ自動割り当て
    expect(p1.grave).toHaveLength(30);

    // Player B (P2) の検証
    const p2 = def.players.p2;
    expect(p2.field).toHaveLength(2);
    expect(p2.field![0]).toEqual({
      componentId: "character.soldier",
      cards: [{ suit: "D", rank: "10" }],
      state: "drive",
      face: "up",
    });
    expect(p2.field![1]).toEqual({
      componentId: "character.soldier",
      cards: [{ suit: "C", rank: "8" }],
      state: "drive",
      face: "up",
    });

    expect(p2.hand).toBeUndefined();

    expect(p2.life?.count).toBe(37);
    expect(p2.life?.cards).toHaveLength(37);

    expect(p2.pack?.count).toBe(14);
    expect(p2.pack?.cards).toHaveLength(14);

    // 残余1枚が墓地へ自動割り当て
    expect(p2.grave).toHaveLength(1);
  });

  it("2: 解決された TSUME-2018-001 が ScenarioCompiler で READY となり GameSession を起動できること", () => {
    const resolveResult = ScenarioAuthoringResolver.resolve(tsume2018Draft, catalog);
    expect(resolveResult.success).toBe(true);
    if (!resolveResult.success) return;

    const compileOutcome = ScenarioCompiler.compile(resolveResult.definition, catalog, fullRulePackage);
    expect(compileOutcome.type).toBe("READY");
    if (compileOutcome.type !== "READY") {
      console.error(compileOutcome.errors);
      return;
    }

    expect(compileOutcome.session).toBeDefined();
    const session = compileOutcome.session;
    const state = session.state;

    // GameState の初期配置整合性検証
    expect(state.turnPlayer).toBe("p1");
    expect(state.chancePlayer).toBe("p1");

    // P1 領域
    expect(state.players.p1.field).toHaveLength(1);
    expect(state.players.p1.field[0].cards[0].rank).toBe("3");
    expect(state.players.p1.field[0].cards[0].suit).toBe("S");
    expect(state.players.p1.field[0].state).toBe("charge");
    expect(state.players.p1.field[0].face).toBe("down");

    expect(state.players.p1.hand).toHaveLength(7);
    expect(state.players.p1.life).toHaveLength(2);
    expect(state.players.p1.pack.cards).toHaveLength(14);
    expect(state.players.p1.pack.count).toBe(14);
    expect(state.players.p1.grave).toHaveLength(30);

    // P2 領域
    expect(state.players.p2.field).toHaveLength(2);
    expect(state.players.p2.hand).toHaveLength(0);
    expect(state.players.p2.life).toHaveLength(37);
    expect(state.players.p2.pack.cards).toHaveLength(14);
    expect(state.players.p2.pack.count).toBe(14);
    expect(state.players.p2.grave).toHaveLength(1);
  });

  it("3: TSUME-2018-001 の解決済み定義が Share URL として正しく直列化・復元され上限制約を満たすこと", () => {
    const resolveResult = ScenarioAuthoringResolver.resolve(tsume2018Draft, catalog);
    expect(resolveResult.success).toBe(true);
    if (!resolveResult.success) return;

    const def = resolveResult.definition;

    // URL エンコード
    const urlParam = encodeScenarioDefinitionV1ToUrlParam(def);
    expect(typeof urlParam).toBe("string");
    expect(urlParam.length).toBeGreaterThan(0);
    expect(urlParam.length).toBeLessThanOrEqual(MAX_SCENARIO_ENCODED_CHARS);

    const jsonStr = JSON.stringify(def);
    const byteLen = getUtf8ByteLength(jsonStr);
    expect(byteLen).toBeLessThanOrEqual(MAX_SCENARIO_PAYLOAD_BYTES);

    // URL デコード
    const decodeResult = decodeScenarioDefinitionV1FromUrlParam(urlParam);
    expect(decodeResult.success).toBe(true);
    if (!decodeResult.success) return;

    expect(decodeResult.definition).toEqual(def);

    // デコードした定義で ScenarioCompiler が正常動作すること
    const reCompile = ScenarioCompiler.compile(decodeResult.definition, catalog, fullRulePackage);
    expect(reCompile.type).toBe("READY");
  });
});
