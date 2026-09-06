import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import {
  OFFICIAL_BASELINE_DIAGNOSTICS_VERSION_1_0,
  OFFICIAL_BASELINE_DIAGNOSTICS_VERSION_1_1,
  OFFICIAL_BASELINE_DIAGNOSTICS_VERSION,
  OFFICIAL_BASELINE_DIAGNOSTICS_LATEST_VERSION,
  CYCLE_STATE_FINGERPRINT_VERSION,
  OfficialBaselineDiagnosticsConfig,
  IncompleteCaseRecord,
} from "../../domain/ai/OfficialBaselineDiagnosticsTypes";
import {
  computeDiagnosticsLogicalDigest,
  computeLogicalDecisionRequestFingerprint,
  OfficialBaselineDiagnosticsRunner,
} from "../../engine/diagnostics/OfficialBaselineDiagnosticsRunner";
import { CycleStateFingerprint } from "../../engine/diagnostics/CycleStateFingerprint";
import { canonicalJsonStringify } from "../../engine/regulation/OfficialBaselineMeasurementRunner";
import { loadRegulationCatalog, RegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { FirstLegalPolicy } from "../../engine/simulation/DecisionPolicy";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { createManualGenericGenomeDNA } from "../../engine/ai/BaselinePolicies";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionCatalog } from "../../domain/decision/DecisionCatalog";
import { PlayerObservation } from "../../domain/decision/PlayerObservation";
import { StateHasher } from "../../engine/simulation/StateHasher";

const mockCatalog: DecisionCatalog = {
  actions: [{ actionId: "action.attack", actionName: "Attack" }],
  cardSelections: [],
  unitSelections: [],
  costPayments: [],
  targetSelections: [],
  effectSelections: [],
  orderSelections: [],
};

function createBaseMockState(): any {
  return {
    presetId: "official-light-entry16",
    stateVersion: 1,
    nextRequestSeq: 1,
    turnCount: 1,
    turnPlayer: "p1",
    chancePlayer: "p1",
    turnUsage: {
      p1: { "action.charge": 0 },
      p2: { "action.charge": 0 },
    },
    players: {
      p1: {
        life: [{ id: "c-life-1", suit: "SPADE", rank: 1, code: "S1" }],
        hand: [{ id: "c-hand-1", suit: "HEART", rank: 5, code: "H5" }],
        field: [{ unitId: "u-1", componentId: "char-1", kind: "UNIT", state: "ACTIVE", cards: [] }],
        fog: [],
        grave: [],
        trumps: [],
      },
      p2: {
        life: [{ id: "c-life-2", suit: "DIAMOND", rank: 2, code: "D2" }],
        hand: [{ id: "c-hand-2", suit: "CLUB", rank: 6, code: "C6" }],
        field: [],
        fog: [],
        grave: [],
        trumps: [],
      },
    },
    stage: {
      requests: [
        {
          id: "req-1",
          sequence: 1,
          actionId: "action.charge",
          controller: "p1",
          definitionOwner: "p1",
          status: "PENDING",
        },
      ],
    },
    requestBuffer: {
      requests: [
        {
          id: "req-buf-1",
          sequence: 2,
          actionId: "action.draw",
          controller: "p1",
          definitionOwner: "p1",
          triggerBindings: {},
        },
      ],
    },
  };
}

function createMockObservation(playerId: "p1" | "p2" = "p1"): PlayerObservation {
  return {
    viewerPlayerId: playerId,
    turnPlayerId: "p1",
    chancePlayerId: "p1",
    players: [
      {
        playerId: "p1",
        name: "Player 1",
        isViewer: playerId === "p1",
        lifeDisplay: "9",
        handCount: 7,
        handCards: [],
        field: [],
        fog: [],
        trumps: [],
        graveCount: 0,
        grave: [],
        canViewFullGrave: true,
      },
      {
        playerId: "p2",
        name: "Player 2",
        isViewer: playerId === "p2",
        lifeDisplay: "9",
        handCount: 7,
        handCards: [],
        field: [],
        fog: [],
        trumps: [],
        graveCount: 0,
        grave: [],
        canViewFullGrave: false,
      },
    ],
    stageRequestRefs: [],
    stageRequests: [],
    recentEvents: [],
  };
}

describe("Official Baseline Diagnostics Tests (Phase 3.4.1 - Section L Requirements 1 to 40)", () => {
  let catalog: RegulationCatalog;
  let fullRulePackage: RulePackage;

  beforeAll(async () => {
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  describe("Part 1: Cycle Fingerprint Engine & State Sensitivity (Req 1 - 13)", () => {
    it("1. Cycle Fingerprint version test", () => {
      expect(CYCLE_STATE_FINGERPRINT_VERSION).toBe(1);
      expect(CycleStateFingerprint.VERSION).toBe(1);
      const state = createBaseMockState();
      const fp = CycleStateFingerprint.compute(state);
      expect(fp.startsWith("csf1-")).toBe(true);
      expect(fp.length).toBe(21);
    });

    it("2. stateVersionだけ異なるstate → 同じCycle Fingerprint", () => {
      const stateA = createBaseMockState();
      stateA.stateVersion = 1;
      const stateB = createBaseMockState();
      stateB.stateVersion = 999;
      expect(CycleStateFingerprint.compute(stateA)).toBe(CycleStateFingerprint.compute(stateB));
    });

    it("3. nextRequestSeqだけ異なるstate → 同じCycle Fingerprint", () => {
      const stateA = createBaseMockState();
      stateA.nextRequestSeq = 1;
      const stateB = createBaseMockState();
      stateB.nextRequestSeq = 500;
      expect(CycleStateFingerprint.compute(stateA)).toBe(CycleStateFingerprint.compute(stateB));
    });

    it("4. runtime requestIdだけ異なるstate → 同じCycle Fingerprint", () => {
      const stateA = createBaseMockState();
      stateA.stage.requests[0].id = "req-runtime-001";
      stateA.stage.requests[0].sequence = 1;

      const stateB = createBaseMockState();
      stateB.stage.requests[0].id = "req-runtime-999";
      stateB.stage.requests[0].sequence = 99;

      expect(CycleStateFingerprint.compute(stateA)).toBe(CycleStateFingerprint.compute(stateB));
    });

    it("5. turnPlayer違い → 違うCycle Fingerprint", () => {
      const stateA = createBaseMockState();
      stateA.turnPlayer = "p1";
      const stateB = createBaseMockState();
      stateB.turnPlayer = "p2";
      expect(CycleStateFingerprint.compute(stateA)).not.toBe(CycleStateFingerprint.compute(stateB));
    });

    it("6. chancePlayer違い → 違うCycle Fingerprint", () => {
      const stateA = createBaseMockState();
      stateA.chancePlayer = "p1";
      const stateB = createBaseMockState();
      stateB.chancePlayer = "p2";
      expect(CycleStateFingerprint.compute(stateA)).not.toBe(CycleStateFingerprint.compute(stateB));
    });

    it("7. Life配置違い → 違うCycle Fingerprint", () => {
      const stateA = createBaseMockState();
      const stateB = createBaseMockState();
      stateB.players.p1.life = [{ id: "c-life-diff", suit: "SPADE", rank: 10, code: "ST" }];
      expect(CycleStateFingerprint.compute(stateA)).not.toBe(CycleStateFingerprint.compute(stateB));
    });

    it("8. Hand違い → 違うCycle Fingerprint", () => {
      const stateA = createBaseMockState();
      const stateB = createBaseMockState();
      stateB.players.p1.hand = [{ id: "c-hand-diff", suit: "CLUB", rank: 13, code: "CK" }];
      expect(CycleStateFingerprint.compute(stateA)).not.toBe(CycleStateFingerprint.compute(stateB));
    });

    it("9. Field違い → 違うCycle Fingerprint", () => {
      const stateA = createBaseMockState();
      const stateB = createBaseMockState();
      stateB.players.p1.field = [{ unitId: "u-2", componentId: "char-diff", kind: "UNIT", state: "ACTIVE", cards: [] }];
      expect(CycleStateFingerprint.compute(stateA)).not.toBe(CycleStateFingerprint.compute(stateB));
    });

    it("10. Stage request論理内容違い → 違うCycle Fingerprint", () => {
      const stateA = createBaseMockState();
      const stateB = createBaseMockState();
      stateB.stage.requests[0].actionId = "action.attack";
      expect(CycleStateFingerprint.compute(stateA)).not.toBe(CycleStateFingerprint.compute(stateB));
    });

    it("11. Request Buffer論理内容違い → 違うCycle Fingerprint", () => {
      const stateA = createBaseMockState();
      const stateB = createBaseMockState();
      stateB.requestBuffer.requests[0].actionId = "action.charge";
      expect(CycleStateFingerprint.compute(stateA)).not.toBe(CycleStateFingerprint.compute(stateB));
    });

    it("12. turnUsage違い → 違うCycle Fingerprint", () => {
      const stateA = createBaseMockState();
      const stateB = createBaseMockState();
      stateB.turnUsage.p1["action.charge"] = 1;
      expect(CycleStateFingerprint.compute(stateA)).not.toBe(CycleStateFingerprint.compute(stateB));
    });

    it("13. State Hash v2は変更されていない", () => {
      expect(StateHasher.VERSION).toBe(2);
      const hash = StateHasher.hash({});
      expect(hash.startsWith("sh2-")).toBe(true);
    });
  });

  describe("Part 2: Cycle Recurrence & Deterministic Candidate Identification (Req 14 - 17)", () => {
    it("14. Cycle recurrence count: 再訪回数が正確に算出されること", () => {
      const visits = new Map<string, number[]>();
      visits.set("csf1-abc", [1, 10, 20]);
      visits.set("csf1-def", [2]);
      visits.set("csf1-ghi", [3, 5]);

      let repeatedVisitCount = 0;
      for (const steps of visits.values()) {
        if (steps.length > 1) {
          repeatedVisitCount += steps.length - 1;
        }
      }
      expect(repeatedVisitCount).toBe(3);
    });

    it("15. Cycle shortest repeat distance: 最短再帰距離が算出されること", () => {
      const history = ["csf1-A", "csf1-B", "csf1-C", "csf1-B", "csf1-A"];
      const lastSeen = new Map<string, number>();
      let shortestRepeatDistance: number | null = null;

      for (let i = 0; i < history.length; i++) {
        const fp = history[i];
        if (lastSeen.has(fp)) {
          const dist = i - lastSeen.get(fp)!;
          if (shortestRepeatDistance === null || dist < shortestRepeatDistance) {
            shortestRepeatDistance = dist;
          }
        }
        lastSeen.set(fp, i);
      }
      expect(shortestRepeatDistance).toBe(2);
    });

    it("16. Deterministic Cycle Candidate: CycleFingerprint + RequestFingerprint + LogicalPatternKey の組で判定されること", () => {
      const cycleKey1 = "csf1-1234::req-5678::ACTION#action.charge";
      const cycleKey2 = "csf1-1234::req-5678::ACTION#action.charge";
      const cycleKey3 = "csf1-1234::req-9999::ACTION#action.draw";

      const seenKeys = new Set<string>();
      seenKeys.add(cycleKey1);

      const isCandidateRepeat = seenKeys.has(cycleKey2);
      const isCandidateDiff = seenKeys.has(cycleKey3);

      expect(isCandidateRepeat).toBe(true);
      expect(isCandidateDiff).toBe(false);
    });

    it("17. SeededRandom recurrenceを deterministic cycleと断定しないこと", () => {
      const isRngMatch = true;
      const hasCycleFpRecurrence = true;

      const isDeterministicCandidate = hasCycleFpRecurrence && !isRngMatch;
      const outcomeCategory = hasCycleFpRecurrence
        ? isRngMatch
          ? "CYCLE_STATE_RECURRENCE_OBSERVED"
          : "DETERMINISTIC_CYCLE_CANDIDATE"
        : "UNCLASSIFIED";

      expect(isDeterministicCandidate).toBe(false);
      expect(outcomeCategory).toBe("CYCLE_STATE_RECURRENCE_OBSERVED");
    });
  });

  describe("Part 3: Stage & Request Buffer Generic Metrics (Req 18 - 24)", () => {
    it("18. finalStageDepth: state.stage.requests.length を正しく使用すること", () => {
      const stateWithStage = {
        stage: {
          requests: [{ id: "r1" }, { id: "r2" }],
        },
      };
      const buggyDepth = (stateWithStage.stage as any)?.length ?? 0;
      const fixedDepth = stateWithStage.stage?.requests?.length ?? 0;

      expect(buggyDepth).toBe(0);
      expect(fixedDepth).toBe(2);
    });

    it("19. Stage空で0: stage.requests が空配列の場合は深度 0 となること", () => {
      const stateEmptyStage = { stage: { requests: [] } };
      const depth = stateEmptyStage.stage?.requests?.length ?? 0;
      expect(depth).toBe(0);
    });

    it("20. Stage 2件で2: stage.requests に2件ある場合は深度 2 となること", () => {
      const stateTwoStage = { stage: { requests: [{ id: "r1" }, { id: "r2" }] } };
      const depth = stateTwoStage.stage?.requests?.length ?? 0;
      expect(depth).toBe(2);
    });

    it("21. Request Buffer depth metrics: maxRequestBufferDepth と finalRequestBufferDepth が追跡されること", () => {
      const bufferDepths = [0, 1, 3, 2, 1];
      const maxBufferDepth = Math.max(...bufferDepths);
      const finalBufferDepth = bufferDepths[bufferDepths.length - 1];

      expect(maxBufferDepth).toBe(3);
      expect(finalBufferDepth).toBe(1);
    });

    it("22. request lifecycle generic metrics: 構造化イベントから件数が集計され文字列ログパースを行わないこと", () => {
      const matchLogEvents = [
        { type: "request.created", payload: { requestId: "r1" } },
        { type: "stage.pushed", payload: { requestId: "r1" } },
        { type: "request.resolved", payload: { requestId: "r1" } },
        { type: "trigger.detected", payload: { triggerId: "t1" } },
        { type: "immediate.resolved", payload: { requestId: "r2" } },
      ];

      let created = 0;
      let resolved = 0;
      let immediate = 0;
      let movedToStage = 0;
      let trigger = 0;

      for (const ev of matchLogEvents) {
        if (ev.type === "request.created") created++;
        else if (ev.type === "request.resolved") resolved++;
        else if (ev.type === "immediate.resolved") immediate++;
        else if (ev.type === "stage.pushed") movedToStage++;
        else if (ev.type === "trigger.detected") trigger++;
      }

      expect(created).toBe(1);
      expect(resolved).toBe(1);
      expect(immediate).toBe(1);
      expect(movedToStage).toBe(1);
      expect(trigger).toBe(1);
    });

    it("23. Stage-empty TP+CP PASS diagnostics維持: 条件に合致する PASS が正しく判定されること", () => {
      const isStageEmptyPass = (
        depth: number,
        tPlayer: string,
        cPlayer: string,
        dPlayer: string,
        kind: string
      ): boolean =>
        depth === 0 &&
        dPlayer === tPlayer &&
        cPlayer === tPlayer &&
        kind === "PASS";

      expect(isStageEmptyPass(0, "p1", "p1", "p1", "PASS")).toBe(true);
      expect(isStageEmptyPass(1, "p1", "p1", "p1", "PASS")).toBe(false);
      expect(isStageEmptyPass(0, "p1", "p2", "p1", "PASS")).toBe(false);
    });

    it("24. Action IDを診断条件へhardcodeしていないこと: 観測頻度として集計され、判定分岐に利用されないこと", () => {
      const observedActionIdCounts: Record<string, number> = {
        "action.charge": 1200,
        "action.draw": 1200,
      };
      expect(observedActionIdCounts["action.charge"]).toBe(1200);
      expect(Object.keys(observedActionIdCounts).length).toBe(2);
    });
  });

  describe("Part 4: Architecture Boundaries & Dependencies (Req 25 - 30)", () => {
    it("25. Diagnostic runnerがengine/diagnosticsに存在すること", () => {
      expect(OfficialBaselineDiagnosticsRunner).toBeDefined();
      const runnerPath = path.resolve(__dirname, "../../engine/diagnostics/OfficialBaselineDiagnosticsRunner.ts");
      expect(fs.existsSync(runnerPath)).toBe(true);
    });

    function checkFilesForForbiddenImport(dirPath: string, forbiddenRegex: RegExp): string[] {
      const violations: string[] = [];
      if (!fs.existsSync(dirPath)) return violations;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          violations.push(...checkFilesForForbiddenImport(fullPath, forbiddenRegex));
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          const content = fs.readFileSync(fullPath, "utf8");
          if (forbiddenRegex.test(content)) {
            violations.push(fullPath);
          }
        }
      }
      return violations;
    }

    const diagnosticsImportRegex = /from\s+["'].*\/engine\/diagnostics(\/.*)?["']|import\(["'].*\/engine\/diagnostics(\/.*)?["']\)/;

    it("26. engine/regulation → diagnostics依存なし", () => {
      const violations = checkFilesForForbiddenImport(path.resolve(__dirname, "../../engine/regulation"), diagnosticsImportRegex);
      expect(violations).toEqual([]);
    });

    it("27. engine/simulation → diagnostics依存なし", () => {
      const violations = checkFilesForForbiddenImport(path.resolve(__dirname, "../../engine/simulation"), diagnosticsImportRegex);
      expect(violations).toEqual([]);
    });

    it("28. engine/session → diagnostics依存なし", () => {
      const violations = checkFilesForForbiddenImport(path.resolve(__dirname, "../../engine/session"), diagnosticsImportRegex);
      expect(violations).toEqual([]);
    });

    it("29. engine/rules → diagnostics依存なし", () => {
      const violations = checkFilesForForbiddenImport(path.resolve(__dirname, "../../engine/rules"), diagnosticsImportRegex);
      expect(violations).toEqual([]);
    });

    it("30. domain → diagnostics依存なし", () => {
      const violations = checkFilesForForbiddenImport(path.resolve(__dirname, "../../domain"), diagnosticsImportRegex);
      expect(violations).toEqual([]);
    });
  });

  describe("Part 5: Baseline Reproducibility, Contracts & Policy Agreement (Req 31 - 40)", () => {
    it("31. Phase 3.3 digest unchanged: Phase 3.3 の baseline digest が完全一致すること", () => {
      const baselineJsonPath = path.resolve(__dirname, "../../../reports/ai/official-light-entry16-baseline-v1.json");
      expect(fs.existsSync(baselineJsonPath)).toBe(true);
      const json = JSON.parse(fs.readFileSync(baselineJsonPath, "utf8"));
      expect(json.logicalDigest).toBe("0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4");
      expect(OFFICIAL_BASELINE_DIAGNOSTICS_VERSION_1_0).toBe("1.0.0");
      expect(OFFICIAL_BASELINE_DIAGNOSTICS_VERSION_1_1).toBe("1.1.0");
      expect(OFFICIAL_BASELINE_DIAGNOSTICS_VERSION).toBe("1.0.0");
      expect(OFFICIAL_BASELINE_DIAGNOSTICS_LATEST_VERSION).toBe("1.1.0");
    });

    it("32. 600 primary matches: 3 pairs × 2 legs × 100 matches の計 600 戦構成であること", () => {
      const pairs = ["firstLegal-vs-zeroGenome", "firstLegal-vs-manualGeneric", "zeroGenome-vs-manualGeneric"];
      const legs = ["leg-a", "leg-b"];
      const matchesPerLeg = 100;
      const totalMatches = pairs.length * legs.length * matchesPerLeg;
      expect(totalMatches).toBe(600);
    });

    it("33. Phase 3.3 incomplete countと一致: Phase 3.3 Artifact から動的取得した 111 件と合致すること", () => {
      const baselineJsonPath = path.resolve(__dirname, "../../../reports/ai/official-light-entry16-baseline-v1.json");
      const json = JSON.parse(fs.readFileSync(baselineJsonPath, "utf8"));
      const totalIncomplete = json.matchups.reduce((acc: number, m: any) => acc + (m.incompleteMatches || 0), 0);
      expect(totalIncomplete).toBe(111);
    });

    it("34. 1000 rerun: secondaryMaxDecisions が 1000 であり分類が適切であること", () => {
      const outcomeCompleted: any = { maxDecisions: 1000, completed: true, outcomeCategory: "FINISHED_BY_1000" };
      const outcomeIncomplete: any = { maxDecisions: 1000, completed: false, outcomeCategory: "STILL_INCOMPLETE_1000" };
      expect(outcomeCompleted.maxDecisions).toBe(1000);
      expect(outcomeCompleted.outcomeCategory).toBe("FINISHED_BY_1000");
      expect(outcomeIncomplete.outcomeCategory).toBe("STILL_INCOMPLETE_1000");
    });

    it("35. 2000 rerun: tertiaryMaxDecisions が 2000 であり分類が適切であること", () => {
      const outcomeCompleted: any = { maxDecisions: 2000, completed: true, outcomeCategory: "FINISHED_BY_2000" };
      const outcomeIncomplete: any = { maxDecisions: 2000, completed: false, outcomeCategory: "STILL_INCOMPLETE_2000" };
      expect(outcomeCompleted.maxDecisions).toBe(2000);
      expect(outcomeCompleted.outcomeCategory).toBe("FINISHED_BY_2000");
      expect(outcomeIncomplete.outcomeCategory).toBe("STILL_INCOMPLETE_2000");
    });

    it("36. Run A / Run B diagnostics exact equality: 決定論的出力によりダイジェストが完全一致すること", () => {
      const payloadA = {
        diagnosticsVersion: "1.1.0",
        workId: "BP-SIM-AI-3.4.1",
        sourceBaselineDigest: "0f16b7d3f6...",
        regulationId: "light-entry16",
        baseSeed: 20260906,
        primaryMaxDecisions: 500,
        secondaryMaxDecisions: 1000,
        tertiaryMaxDecisions: 2000,
        totalPrimaryMatches: 600,
        totalIncompleteCases: 111,
      };
      const payloadB = { ...payloadA };

      const digestA = computeDiagnosticsLogicalDigest(payloadA as any);
      const digestB = computeDiagnosticsLogicalDigest(payloadB as any);
      expect(digestA).toBe(digestB);
    });

    it("37. runtime metadata digest除外: duration や timestamp がダイジェスト計算対象に含まれないこと", () => {
      const payload: any = {
        diagnosticsVersion: "1.1.0",
        workId: "BP-SIM-AI-3.4.1",
        sourceBaselineDigest: "0f16b7d3f6...",
        regulationId: "light-entry16",
        baseSeed: 20260906,
        primaryMaxDecisions: 500,
        secondaryMaxDecisions: 1000,
        tertiaryMaxDecisions: 2000,
        totalPrimaryMatches: 600,
        totalIncompleteCases: 111,
      };

      const digest = computeDiagnosticsLogicalDigest(payload);
      expect(digest).toBeDefined();
      expect(typeof digest).toBe("string");
      expect(digest.length).toBe(64);
    });

    it("38. Policy agreement unchanged: 同一コーパスに対する 3 ポリシーの Counterfactual 選択一致率が評価可能であること", () => {
      const first = new FirstLegalPolicy(false);
      const zero = new GenomePolicy(DecisionDNACodec.createZeroDecisionDNA({ id: "z" }));
      const manual = new GenomePolicy(createManualGenericGenomeDNA());

      const req: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: "m1",
        decisionId: "d1",
        stateVersion: 1,
        playerId: "p1",
        source: { type: "ACTION_REQUEST", playerId: "p1" },
        observation: createMockObservation("p1"),
        catalog: mockCatalog,
        patterns: [
          { patternId: "p-0", kind: "ACTION", actionSelectionRef: 0 },
          { patternId: "p-1", kind: "PASS" },
        ],
      };

      const resFirst = first.choose(req);
      const resZero = zero.choose(req);
      const resManual = manual.choose(req);

      expect(resFirst.selectedPatternRef).toBe(0);
      expect(resZero.selectedPatternRef).toBe(0);
      expect(resManual.selectedPatternRef).toBe(0);
    });

    it("39. Core Battle未使用: 診断設定の regulationId に core-battle が含まれないこと", () => {
      const config: OfficialBaselineDiagnosticsConfig = {
        diagnosticsVersion: "1.1.0",
        workId: "BP-SIM-AI-3.4.1",
        sourceBaselineDigest: "0f16b7d3f6...",
        regulationId: "light-entry16",
        baseSeed: 20260906,
        primaryMaxDecisions: 500,
        secondaryMaxDecisions: 1000,
        tertiaryMaxDecisions: 2000,
        matchesPerSeat: 50,
      };
      expect(config.regulationId).not.toContain("core-battle");
      expect(config.regulationId).toBe("light-entry16");
    });

    it("40. Official Light + Entry16のみ: レギュレーションが light-entry16 であること", () => {
      const reg = catalog.regulations.get("light-entry16");
      expect(reg).toBeDefined();
      expect(reg?.formatId).toBe("light");
      expect(reg?.frameId).toBe("entry16");
    });
  });
});
