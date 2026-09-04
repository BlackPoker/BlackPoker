import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { PATTERN_FEATURE_NAMES, CONTEXT_FEATURE_NAMES } from "../../domain/ai/DecisionFeatureTypes";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
import { BatchSimulationRunner } from "../../engine/simulation/BatchSimulationRunner";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Genome Policy v1 & Real / Batch Integration (Phase 3.1)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    rulePackage = getPlaytestRulePackage(fullPackage);
  });

  const createSyntheticDecisionRequest = (): DecisionRequest => {
    return {
      protocolVersion: "1.0.0",
      matchId: "match-test-001",
      decisionId: "dec-123456",
      stateVersion: 1,
      playerId: "p1",
      source: {
        type: "ACTION_REQUEST",
        playerId: "p1",
      },
      observation: {
        viewerPlayerId: "p1",
        turnPlayerId: "p1",
        chancePlayerId: "p1",
        players: [
          {
            playerId: "p1",
            name: "Alice",
            isViewer: true,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 5,
            handCards: [
              {
                visibility: "KNOWN",
                cardInstanceId: "card-p1-1",
                suit: "spade",
                rank: "A",
                value: 1,
                faceUp: true,
              },
            ],
            field: [
              {
                unitId: "unit-p1-1",
                kind: "soldier",
                componentId: "soldier_base",
                state: "drive",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 4,
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
          {
            playerId: "p2",
            name: "Bob",
            isViewer: false,
            lifeCount: undefined,
            lifeDisplay: "10以上",
            handCount: 4,
            handCards: [
              {
                visibility: "HIDDEN",
                opaqueCardId: "opaque-p2-1",
                faceUp: false,
              },
            ],
            field: [],
            fog: [],
            trumps: [],
            graveCount: 1,
            grave: [],
            canViewFullGrave: false,
          },
        ],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      },
      catalog: {
        actions: [
          {
            actionId: "action.attack",
            actionName: "アタック",
            timing: "main",
            speed: "normal",
          },
        ],
        cardSelections: [],
        unitSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        {
          patternId: "pat-pass",
          kind: "PASS",
        },
        {
          patternId: "pat-attack",
          kind: "ACTION",
          actionSelectionRef: 0,
        },
      ],
    };
  };

  describe("AC. GenomePolicy Core Mechanics", () => {
    it("1. DecisionPolicy インターフェースを実装し、軽量な PolicyDescriptor を提供すること (1482 重みは非内包)", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-001", name: "GenomeAgentA" });
      const policy = new GenomePolicy(dna);

      expect(policy.descriptor.kind).toBe("genome");
      expect(policy.descriptor.policyVersion).toBe(1);
      expect(policy.descriptor.name).toBe("GenomeAgentA");
      expect(policy.descriptor.metadata?.dnaId).toBe("dna-001");
      expect(policy.descriptor.metadata?.scoringModel).toBe("linear-bilinear-v1");

      // 1482 重みが descriptor に漏洩していないこと
      expect(policy.descriptor.metadata?.patternWeights).toBeUndefined();
      expect(policy.descriptor.metadata?.contextPatternWeights).toBeUndefined();
    });

    it("2. 決定論的 Argmax: 同じ DNA と同じ Request に対して完全同一の DecisionResponse を返すこと", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const policy = new GenomePolicy(dna);
      const req = createSyntheticDecisionRequest();

      const res1 = policy.choose(req);
      const res2 = policy.choose(req);

      expect(res1).toEqual(res2);
      expect(res1.decisionId).toBe(req.decisionId);
      expect(res1.stateVersion).toBe(req.stateVersion);
    });

    it("3. タイブレーク規則: スコア同点時は最小の patternRef (先に現れたパターン) を決定論的に選択すること", () => {
      // Zero DNA (全スコア 0)
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const policy = new GenomePolicy(dna);
      const req = createSyntheticDecisionRequest(); // patterns: [0: PASS, 1: ACTION]

      const res = policy.choose(req);
      expect(res.selectedPatternRef).toBe(0); // 最小 ref (PASS)
    });

    it("4. スコア差がある場合、最高スコアのパターンが正しく選択されること", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
      (dna.patternWeights as number[])[actIdx] = 10.0; // ACTION を圧倒的に優先

      const policy = new GenomePolicy(dna);
      const req = createSyntheticDecisionRequest();

      const res = policy.choose(req);
      expect(res.selectedPatternRef).toBe(1); // ACTION
    });

    it("5. 視点対称性 (Viewer Symmetry): 鏡像関係の盤面・カタログに対して同一の選択を行うこと", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
      (dna.patternWeights as number[])[actIdx] = 5.0;

      const policy = new GenomePolicy(dna);

      const reqP1 = createSyntheticDecisionRequest();
      const reqP2: DecisionRequest = {
        ...reqP1,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        observation: {
          ...reqP1.observation,
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            { ...reqP1.observation.players[0], playerId: "p2", name: "Bob", isViewer: true },
            { ...reqP1.observation.players[1], playerId: "p1", name: "Alice", isViewer: false },
          ],
        },
      };

      const resP1 = policy.choose(reqP1);
      const resP2 = policy.choose(reqP2);

      expect(resP1.selectedPatternRef).toBe(1);
      expect(resP2.selectedPatternRef).toBe(1);
    });

    it("6. Runtime メタデータ (decisionId, matchId, stateVersion) や表示用文字列の変更に対して選択が不変であること", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
      (dna.patternWeights as number[])[actIdx] = 5.0;
      const policy = new GenomePolicy(dna);

      const req1 = createSyntheticDecisionRequest();
      const req2: DecisionRequest = {
        ...req1,
        decisionId: "dec-different-999",
        matchId: "match-completely-new",
        stateVersion: 42,
        observation: {
          ...req1.observation,
          players: req1.observation.players.map((p) => ({ ...p, name: p.name + " [Renamed]" })),
        },
        catalog: {
          ...req1.catalog,
          actions: req1.catalog.actions.map((a) => ({ ...a, actionName: "攻撃改" })),
        },
      };

      const res1 = policy.choose(req1);
      const res2 = policy.choose(req2);

      expect(res1.selectedPatternRef).toBe(1);
      expect(res2.selectedPatternRef).toBe(1);
      expect(res2.decisionId).toBe("dec-different-999");
      expect(res2.stateVersion).toBe(42);
    });

    it("7. DNA 不変性 (Isolation): Policy 生成後に外部の DNA 配列を変更しても挙動が変化しないこと", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const policy = new GenomePolicy(dna);

      // 生成後に caller 側で PASS 重みを書き換える
      const passIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_pass");
      (dna.patternWeights as number[])[passIdx] = 999.0;

      const actDna = DecisionDNACodec.createZeroDecisionDNA();
      const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
      (actDna.patternWeights as number[])[actIdx] = 10.0;
      const actionPolicy = new GenomePolicy(actDna);

      // caller 側で actDna を PASS 重みに書き換えても actionPolicy は ACTION を選び続けること
      (actDna.patternWeights as number[])[passIdx] = 999.0;
      (actDna.patternWeights as number[])[actIdx] = 0.0;

      const req = createSyntheticDecisionRequest();
      const res = actionPolicy.choose(req);
      expect(res.selectedPatternRef).toBe(1); // ACTION のまま
    });

    it("8. 合法手が存在しない空のリクエストに対して明確に例外をスローすること", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const policy = new GenomePolicy(dna);
      const req = createSyntheticDecisionRequest();
      (req as any).patterns = [];

      expect(() => policy.choose(req)).toThrow("DecisionRequest に選択可能なパターンが存在しません");
    });

    it("9. Policy constructor 後の caller 側 nested metadata 変更から Policy 内部 DNA が完全に独立していること", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA({
        id: "meta-isolation",
        experiment: {
          tags: ["initial"],
          params: { rate: 0.1 },
        },
      } as any);

      const policy = new GenomePolicy(dna);

      // caller 側で変更
      (dna.metadata as any).experiment.tags.push("mutated");
      (dna.metadata as any).experiment.params.rate = 9.99;

      const policyDna = policy.getDNA();
      expect((policyDna.metadata as any).experiment.tags).toEqual(["initial"]);
      expect((policyDna.metadata as any).experiment.params.rate).toBe(0.1);
    });

    it("10. Policy.getDNA() の戻り値に対する nested metadata 変更から Policy 内部 DNA が完全に独立していること", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA({
        id: "getdna-isolation",
        experiment: {
          tags: ["v1"],
          params: { step: 1 },
        },
      } as any);

      const policy = new GenomePolicy(dna);

      const retrieved1 = policy.getDNA();
      (retrieved1.metadata as any).experiment.tags.push("leaked");
      (retrieved1.metadata as any).experiment.params.step = 999;

      const retrieved2 = policy.getDNA();
      expect((retrieved2.metadata as any).experiment.tags).toEqual(["v1"]);
      expect((retrieved2.metadata as any).experiment.params.step).toBe(1);
    });

    it("11. metadata の有無や変更によって GenomePolicy.choose の selectedPatternRef が 100% 不変であること", () => {
      const dna1 = DecisionDNACodec.createZeroDecisionDNA();
      const dna2 = DecisionDNACodec.createZeroDecisionDNA({
        id: "dna-with-rich-metadata",
        name: "Rich Metadata Genome",
        generation: 10,
        fitness: 0.88,
        nested: { tags: ["meta1", "meta2"], config: { active: true, count: 5 } },
      } as any);

      // 双方に同じ重みを設定
      const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
      (dna1.patternWeights as number[])[actIdx] = 3.0;
      (dna2.patternWeights as number[])[actIdx] = 3.0;

      const policy1 = new GenomePolicy(dna1);
      const policy2 = new GenomePolicy(dna2);

      const req = createSyntheticDecisionRequest();
      const res1 = policy1.choose(req);
      const res2 = policy2.choose(req);

      expect(res1.selectedPatternRef).toBe(res2.selectedPatternRef);
      expect(res1.selectedPatternRef).toBe(1);
    });
  });

  describe("AD. Real GameSession & Batch Integration", () => {
    it("1. 実 GameSession の ACTION_REQUEST を GenomePolicy が判定し、GameSession.submitDecision が正常受理すること", () => {
      const rawState = createCoreBattlePresetState();
      const setupResult = MatchSetupCoordinator.setupMatch(rawState);
      const session = new GameSession(setupResult.state, rulePackage);

      const dna = DecisionDNACodec.createZeroDecisionDNA();
      // アタックを好む DNA
      const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
      (dna.patternWeights as number[])[actIdx] = 5.0;
      const policy = new GenomePolicy(dna);

      const step = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") return;

      const response = policy.choose(step.request);
      expect(response.decisionId).toBe(step.request.decisionId);
      expect(response.stateVersion).toBe(step.request.stateVersion);
      expect(response.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(response.selectedPatternRef).toBeLessThan(step.request.patterns.length);

      // submitDecision に渡して正常に進むこと
      expect(() => session.submitDecision(response)).not.toThrow();
    });

    it("2. 実 GameSession の EFFECT_RESOLUTION 要求を GenomePolicy が判定し合法手を選択できること", () => {
      const soldier1 = {
        unitId: "soldier-1",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
        labels: ["攻撃", "防御"],
      };
      const soldier2 = {
        unitId: "soldier-2",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "c2", suit: "H", rank: "7", value: 7 }],
        labels: ["攻撃"],
      };
      const battleState = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            name: "Player A",
            life: [{ id: "l1-1", suit: "S", rank: "A", value: 1 }],
            hand: [{ id: "key-s8", suit: "S", rank: "8", value: 8 }],
            field: [soldier1, soldier2],
            fog: [],
            grave: [],
          },
          p2: {
            name: "Player B",
            life: [{ id: "l2-1", suit: "D", rank: "K", value: 13 }],
            hand: [],
            field: [],
            fog: [],
            grave: [],
          },
        },
        stage: { requests: [], history: [] },
        requestBuffer: { requests: [], history: [] },
      } as any;

      const session = new GameSession(battleState, rulePackage);

      // 1. Attack リクエスト
      const s1 = session.advance() as any;
      const attackRef = s1.request.patterns.findIndex((p: any) => {
        if (p.actionSelectionRef === undefined) return false;
        return s1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.attack";
      });
      session.submitDecision({ decisionId: s1.request.decisionId, stateVersion: s1.request.stateVersion, selectedPatternRef: attackRef });

      // 2. P1 PASS
      const s2 = session.advance() as any;
      const pRef1 = s2.request.patterns.findIndex((p: any) => p.kind === "PASS");
      session.submitDecision({ decisionId: s2.request.decisionId, stateVersion: s2.request.stateVersion, selectedPatternRef: pRef1 });

      // 3. P2 PASS -> EFFECT_RESOLUTION 発生
      const s3 = session.advance() as any;
      const pRef2 = s3.request.patterns.findIndex((p: any) => p.kind === "PASS");
      const s4 = session.submitDecision({ decisionId: s3.request.decisionId, stateVersion: s3.request.stateVersion, selectedPatternRef: pRef2 }) as any;

      expect(s4.type).toBe("WAITING_FOR_DECISION");
      expect(s4.request.source.type).toBe("EFFECT_RESOLUTION");

      // GenomePolicy に判定させる
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const effIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_effect_selection");
      (dna.patternWeights as number[])[effIdx] = 10.0;
      const policy = new GenomePolicy(dna);

      const response = policy.choose(s4.request);
      expect(response.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(response.selectedPatternRef).toBeLessThan(s4.request.patterns.length);
      expect(() => session.submitDecision(response)).not.toThrow();
    });

    it("3. BatchSimulationRunner に GenomePolicy を投入し、Runner 本体を変更することなく 10 試合完走・FAILED=0 であること", () => {
      const baseDna = DecisionDNACodec.createZeroDecisionDNA({ name: "BatchDNA" });
      // 適度に ACTION を選ぶ DNA
      const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
      (baseDna.patternWeights as number[])[actIdx] = 2.0;

      const rawState = createCoreBattlePresetState();
      const setupResult = MatchSetupCoordinator.setupMatch(rawState);

      const result = BatchSimulationRunner.run({
        matchCount: 10,
        baseSeed: 100,
        maxDecisionsPerMatch: 150,
        sessionFactory: () => {
          const rawState = createCoreBattlePresetState();
          const setupResult = MatchSetupCoordinator.setupMatch(rawState);
          return new GameSession(setupResult.state, rulePackage);
        },
        // 各 Match ごとに独立した fresh GenomePolicy を生成
        policyFactory: () => ({
          p1: new GenomePolicy(baseDna, "Genome-p1"),
          p2: new GenomePolicy(baseDna, "Genome-p2"),
        }),
      });

      expect(result.summary.totalMatches).toBe(10);
      expect(result.summary.failedCount).toBe(0);
      expect(result.summary.completedCount + result.summary.incompleteCount).toBe(10);
      expect(result.matches.length).toBe(10);

      for (const m of result.matches) {
        expect(m.status).not.toBe("FAILED");
      }
    });
  });
});
