import { describe, it, expect, vi } from "vitest";
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
import {
  buildPlaytestShareUrl,
  parsePlaytestShareUrl,
  PlaytestShareConfigV1,
} from "../../ui/playtest/PlaytestShareUrl";
import { ChallengeEvaluator } from "../../engine/challenge/ChallengeEvaluator";
import { prepareScenarioMatchAttempt } from "../../engine/playtest/ScenarioMatchCoordinator";
import { isHumanSeat } from "../../engine/playtest/PlaytestSeatController";
import { GameSessionStep } from "../../engine/session/GameSession";
import { advanceAutomatedDecisions } from "../../engine/playtest/HumanVsPolicyController";

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

  it("4: TSUME-2018-001 の正統共有URL (Human vs AI, Conservative, Challenge) とターン終了時の FAILED 連鎖停止検証", async () => {
    const resolveResult = ScenarioAuthoringResolver.resolve(tsume2018Draft, catalog);
    expect(resolveResult.success).toBe(true);
    if (!resolveResult.success) return;

    const def = resolveResult.definition;

    // 1. Playtest Share URL の生成・検証 (モード, AIポリシー, チャレンジを完全包含)
    const shareConfig: PlaytestShareConfigV1 = {
      version: 1,
      environmentId: def.environmentId,
      mode: "humanVsAi",
      humanSeat: "p1",
      policyId: "playtestConservative",
      seedInput: String(def.seed),
      scenarioDefinition: def,
      challengeDefinition: { version: 1, kind: "WIN_CURRENT_TURN" },
    };

    const shareUrl = buildPlaytestShareUrl("https://simulator.blackpoker.org/playtest", shareConfig, catalog);
    expect(shareUrl).toContain("bpv=1");
    expect(shareUrl).toContain("mode=humanVsAi");
    expect(shareUrl).toContain("human=p1");
    expect(shareUrl).toContain("policy=playtestConservative");
    expect(shareUrl).toContain("challenge=c1.winCurrentTurn");
    expect(shareUrl).toContain("scenario=z1.");

    // URL 復元の検証
    const parsed = parsePlaytestShareUrl(shareUrl, catalog);
    expect(parsed.kind).toBe("READY");
    if (parsed.kind !== "READY") return;
    expect(parsed.config.mode).toBe("humanVsAi");
    expect(parsed.config.humanSeat).toBe("p1");
    expect(parsed.config.policyId).toBe("playtestConservative");
    expect(parsed.config.challengeDefinition).toEqual({ version: 1, kind: "WIN_CURRENT_TURN" });
    expect(parsed.config.scenarioDefinition).toEqual(def);

    // 2. 対戦準備と Challenge ライフサイクルの結合検証
    const attempt = prepareScenarioMatchAttempt({
      definition: def,
      catalog,
      fullRulePackage,
      mode: "humanVsAi",
      humanSeat: "p1",
      policyId: "playtestConservative",
    });
    expect(attempt.status).toBe("READY");
    if (attempt.status !== "READY") return;

    const { session, initialStep, seatControllers, policies } = attempt.prepared;
    const p2Policy = policies.p2;
    expect(p2Policy).toBeDefined();
    const chooseSpy = vi.spyOn(p2Policy, "choose");
    const decideSpy = p2Policy.decide ? vi.spyOn(p2Policy, "decide") : undefined;

    // Challenge 初期化
    let challenge = ChallengeEvaluator.initialize(
      { version: 1, kind: "WIN_CURRENT_TURN" },
      session.state
    );
    expect(challenge.status).toBe("ACTIVE");
    expect(challenge.challenger).toBe("p1");
    expect(challenge.initialTurnPlayer).toBe("p1");
    expect(challenge.initialTurnCount).toBe(1);

    challenge = ChallengeEvaluator.evaluate(challenge, initialStep, session.state);
    expect(challenge.status).toBe("ACTIVE");

    // P1 (Human) がターンエンド (action.end) を宣言 (Pattern index 固定値禁止: findIndex で動的探索)
    expect(initialStep.type).toBe("WAITING_FOR_DECISION");
    if (initialStep.type !== "WAITING_FOR_DECISION") return;

    let currentStep: GameSessionStep = initialStep;
    const endPatternIndex = initialStep.request.patterns.findIndex(
      (p: any) => p.patternId?.includes("action.end")
    );
    expect(endPatternIndex).toBeGreaterThanOrEqual(0);

    currentStep = session.submitDecision({
      decisionId: initialStep.request.decisionId,
      stateVersion: initialStep.request.stateVersion,
      selectedPatternRef: endPatternIndex,
    });

    // production 対戦ループ: P1 (Human) は action.end の解決まで PASS を選択し、
    // AI 側は advanceAutomatedDecisions (Generic stop hook 付き) で進行
    let aiResult: any;
    const allAiRecords: any[] = [];
    const stopHook = (step: any, state: any) => {
      if (challenge.status === "ACTIVE") {
        const updated = ChallengeEvaluator.evaluate(challenge, step, state);
        challenge = updated;
        if (updated.status !== "ACTIVE") {
          return true;
        }
      }
      return false;
    };

    while (challenge.status === "ACTIVE" && currentStep.type === "WAITING_FOR_DECISION") {
      if (currentStep.request.playerId === "p1") {
        // Human の手番: PASS を選択
        const passIndex = currentStep.request.patterns.findIndex((p: any) => p.kind === "PASS");
        expect(passIndex).toBeGreaterThanOrEqual(0);
        currentStep = session.submitDecision({
          decisionId: currentStep.request.decisionId,
          stateVersion: currentStep.request.stateVersion,
          selectedPatternRef: passIndex,
        });
        challenge = ChallengeEvaluator.evaluate(challenge, currentStep, session.state);
      } else {
        // AI の手番: advanceAutomatedDecisions を Generic stop hook 付きで実行
        aiResult = await advanceAutomatedDecisions(
          session,
          currentStep,
          seatControllers,
          policies,
          {
            viewerPlayerId: "p1",
            shouldStopAfterStep: stopHook,
          }
        );
        allAiRecords.push(...aiResult.records);
        currentStep = aiResult.step;
        if (aiResult.status === "STOPPED" && aiResult.reason === "EXTERNAL_STOP") {
          break;
        }
      }
    }

    // 1. advanceAutomatedDecisions の停止結果: deadline crossing 時に EXTERNAL_STOP で停止
    expect(aiResult).toBeDefined();
    expect(aiResult.status).toBe("STOPPED");
    expect(aiResult.reason).toBe("EXTERNAL_STOP");
    expect(allAiRecords.length).toBeGreaterThanOrEqual(1);

    // すべての AI Decision Record は Turn 1 内 (Turn 2 のメイン行動は 0 件)
    for (const rec of allAiRecords) {
      expect(rec.prevState.turnCount).toBe(1);
    }

    // Turn 2 かつ P2 の Decision Record が 1 件も存在しないこと
    const turn2AiRecords = allAiRecords.filter(
      (rec) => rec.prevState.turnCount === 2 && rec.playerId === "p2"
    );
    expect(turn2AiRecords.length).toBe(0);

    // 2. Policy spy 検証: policy 呼び出し回数が Turn 1 内の record 件数と完全一致し、Turn 2 で呼ばれていないこと
    expect(chooseSpy.mock.calls.length).toBe(allAiRecords.length);

    // 3. Challenge の状態検証: deadline crossing により FAILED
    expect(challenge.status).toBe("FAILED");
    expect(challenge.reason).toBe("TURN_ENDED_BEFORE_WIN");

    // 4. Deadline-crossing step の保持検証:
    // GameSession は Turn 2 / turnPlayer: p2 で待機状態にあり、壊されていないこと
    expect(session.state.turnCount).toBe(2);
    expect(session.state.turnPlayer).toBe("p2");

    // 5. GameSession 不変条件:
    // Life 偽造なし、fake match.finished なし
    expect(session.state.players.p1.life.length).toBe(2);
    expect(session.state.players.p2.life.length).toBe(37);
    const events = session.getMatchLog().events;
    expect(events.some((e: any) => e.type === "match.finished")).toBe(false);
  });
});
