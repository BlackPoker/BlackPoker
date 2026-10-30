import { describe, it, expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import {
  EVOLUTION_G1_BEST_POLICY_ID,
  EVOLUTION_G1_BEST_GENOME_ID,
  EVOLUTION_G1_BEST_GENERATION,
  EVOLUTION_G1_BEST_FEATURE_SCHEMA_VERSION,
  EVOLUTION_G1_BEST_DNA_FORMAT_VERSION,
  EVOLUTION_G1_BEST_TOTAL_WEIGHTS,
  EVOLUTION_G1_BEST_PATTERN_WEIGHTS_COUNT,
  EVOLUTION_G1_BEST_CONTEXT_PATTERN_WEIGHTS_COUNT,
  EVOLUTION_G1_BEST_FULL_DIGEST,
  EVOLUTION_G1_BEST_PATTERN_DIGEST,
  EVOLUTION_G1_BEST_CONTEXT_PATTERN_DIGEST,
  EVOLUTION_G1_BEST_SUPPORTED_REGULATION_ID,
  computeFullDnaDigest,
  computePatternWeightsDigest,
  computeContextPatternWeightsDigest,
  loadAndValidateEvolutionG1BestDNA,
  createEvolutionG1BestPolicy,
} from "../../engine/ai/EvolutionDNALoader";

import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import {
  startMatchAttempt,
  OFFICIAL_ENV_PREFIX,
} from "../../engine/playtest/PlaytestEnvironmentController";
import {
  createSeatControllers,
  PLAYTEST_POLICY_OPTIONS,
} from "../../engine/playtest/PlaytestSeatController";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import { advanceAutomatedDecisions } from "../../engine/playtest/HumanVsPolicyController";
import {
  serializePlaytestShareUrl,
  parsePlaytestShareUrl,
} from "../../ui/playtest/PlaytestShareUrl";
import { buildPlaytestDiagnosticBundleV1 } from "../../ui/playtest/PlaytestDiagnosticBundle";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner";
import { FirstLegalPolicy } from "../../engine/simulation/DecisionPolicy";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { ScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";
import { prepareScenarioMatchAttempt } from "../../engine/playtest/ScenarioMatchCoordinator";
import { ScenarioBuilderModal } from "../../ui/scenario/ScenarioBuilderModal";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Evolution Playtest Integration Tests (BP-SIM-AI-EVOLUTION-PLAYTEST-V1)", () => {
  const fullRulePackage = loadRulePackageForBrowser();
  const catalog = loadRegulationCatalogForBrowser();
  const officialEnvId = `${OFFICIAL_ENV_PREFIX}light-entry16`;

  // =========================================================================
  // Section 8A: DNA Artifact 検証
  // =========================================================================
  describe("Section 8A: DNA Artifact & Manifest Verification", () => {
    const dnaPath = path.resolve(__dirname, "../../data/ai/evolution-g1-best-v6.json");
    const manifestPath = path.resolve(__dirname, "../../data/ai/evolution-g1-best-v6.manifest.json");

    it("DNA JSON および Manifest ファイルが所定パスに存在すること", () => {
      expect(fs.existsSync(dnaPath)).toBe(true);
      expect(fs.existsSync(manifestPath)).toBe(true);
    });

    it("DNA Artifact の形式・メタデータ・重み数が厳密に一致すること", () => {
      const dna = JSON.parse(fs.readFileSync(dnaPath, "utf8")) as DecisionDNA;

      expect(() => DecisionDNACodec.validate(dna)).not.toThrow();
      expect(dna.dnaFormatVersion).toBe(EVOLUTION_G1_BEST_DNA_FORMAT_VERSION);
      expect(dna.featureSchemaVersion).toBe(EVOLUTION_G1_BEST_FEATURE_SCHEMA_VERSION);
      expect(dna.patternWeights.length).toBe(EVOLUTION_G1_BEST_PATTERN_WEIGHTS_COUNT);
      expect(dna.contextPatternWeights.length).toBe(EVOLUTION_G1_BEST_CONTEXT_PATTERN_WEIGHTS_COUNT);
      expect(dna.patternWeights.length + dna.contextPatternWeights.length).toBe(EVOLUTION_G1_BEST_TOTAL_WEIGHTS);
      expect(dna.metadata?.id).toBe(EVOLUTION_G1_BEST_GENOME_ID);
      expect(dna.metadata?.generation).toBe(EVOLUTION_G1_BEST_GENERATION);
    });

    it("DNA の SHA-256 ダイジェストが R1 Evidence の値と完全一致すること", () => {
      const dna = JSON.parse(fs.readFileSync(dnaPath, "utf8")) as DecisionDNA;

      const fullDigest = computeFullDnaDigest(dna);
      const patternDigest = computePatternWeightsDigest(dna);
      const contextPatternDigest = computeContextPatternWeightsDigest(dna);

      expect(fullDigest).toBe(EVOLUTION_G1_BEST_FULL_DIGEST);
      expect(patternDigest).toBe(EVOLUTION_G1_BEST_PATTERN_DIGEST);
      expect(contextPatternDigest).toBe(EVOLUTION_G1_BEST_CONTEXT_PATTERN_DIGEST);
    });

    it("Manifest ファイルの記載内容が DNA Artifact および Baseline 実測値と完全一致すること", () => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

      expect(manifest.genomeId).toBe(EVOLUTION_G1_BEST_GENOME_ID);
      expect(manifest.generation).toBe(1);
      expect(manifest.featureSchemaVersion).toBe(6);
      expect(manifest.dnaFormatVersion).toBe(1);
      expect(manifest.fullDnaDigest).toBe(EVOLUTION_G1_BEST_FULL_DIGEST);
      expect(manifest.patternWeightsDigest).toBe(EVOLUTION_G1_BEST_PATTERN_DIGEST);
      expect(manifest.contextPatternWeightsDigest).toBe(EVOLUTION_G1_BEST_CONTEXT_PATTERN_DIGEST);
      expect(manifest.patternDimension).toBe(143);
      expect(manifest.contextDimension).toBe(165);
      expect(manifest.totalWeights).toBe(23738);
      expect(manifest.baselineRecord.wins).toBe(9);
      expect(manifest.baselineRecord.losses).toBe(1);
      expect(manifest.baselineRecord.fitnessScore).toBe(0.9);
      expect(manifest.generationParameters.campaignSeed).toBe(42);
      expect(manifest.generationParameters.regulation).toBe("light-entry16");
    });

    it("不正な重み配列・不正なスキーマ・改竄されたDNAは Fail-Closed で拒絶されること", () => {
      const validDna = JSON.parse(fs.readFileSync(dnaPath, "utf8")) as DecisionDNA;

      // 1. 重み要素の改竄 (1 float 変更で digest 不一致)
      const tamperedWeights = [...validDna.patternWeights];
      tamperedWeights[0] += 0.0001;
      const tamperedDna1 = { ...validDna, patternWeights: tamperedWeights };
      expect(() => loadAndValidateEvolutionG1BestDNA(tamperedDna1)).toThrow(/fullDnaDigest mismatch/);

      // 2. contextPatternWeights の改竄
      const tamperedCpWeights = [...validDna.contextPatternWeights];
      tamperedCpWeights[10] += 0.001;
      const tamperedDna2 = { ...validDna, contextPatternWeights: tamperedCpWeights };
      expect(() => loadAndValidateEvolutionG1BestDNA(tamperedDna2)).toThrow(/fullDnaDigest mismatch/);

      // 3. Genome ID の改竄
      const tamperedDna3 = { ...validDna, metadata: { ...validDna.metadata, id: "fake-genome-id" } };
      expect(() => loadAndValidateEvolutionG1BestDNA(tamperedDna3)).toThrow(/genomeId mismatch/);

      // 4. Feature Schema Version の不一致
      const tamperedDna4 = { ...validDna, featureSchemaVersion: 5 };
      expect(() => loadAndValidateEvolutionG1BestDNA(tamperedDna4)).toThrow();

      // 5. DNA Format Version の不一致
      const tamperedDna5 = { ...validDna, dnaFormatVersion: 2 };
      expect(() => loadAndValidateEvolutionG1BestDNA(tamperedDna5)).toThrow();

      // 6. 重み長の不足
      const tamperedDna6 = { ...validDna, patternWeights: validDna.patternWeights.slice(0, 100) };
      expect(() => loadAndValidateEvolutionG1BestDNA(tamperedDna6)).toThrow();
    });
  });

  // =========================================================================
  // Section 8B: AI の意思決定の決定論性と整合性
  // =========================================================================
  describe("Section 8B: AI Decision Determinism & Validity", () => {
    it("Evolution g1 Best Policy が GenomePolicy として生成され、同一リクエストに対し完全同一の判断を返すこと", () => {
      const policy1 = createEvolutionG1BestPolicy();
      const policy2 = createEvolutionG1BestPolicy();

      expect(policy1).toBeInstanceOf(GenomePolicy);
      expect(policy1.descriptor.kind).toBe("genome");
      expect(policy1.descriptor.metadata?.dnaId).toBe(EVOLUTION_G1_BEST_GENOME_ID);

      const outcome = startMatchAttempt({
        environmentId: officialEnvId,
        seedInput: "42",
        catalog,
        fullRulePackage,
      });
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      expect(outcome.initialStep.type).toBe("WAITING_FOR_DECISION");
      if (outcome.initialStep.type !== "WAITING_FOR_DECISION") return;

      const req = outcome.initialStep.request;
      expect(req).toBeDefined();

      const res1 = policy1.choose(req);
      const res2 = policy2.choose(req);

      expect(res1.selectedPatternRef).toBe(res2.selectedPatternRef);
      expect(res1.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(res1.selectedPatternRef).toBeLessThan(req.patterns.length);
    });

    it("PlaytestPolicyFactory 経由で生成され、未対応レギュレーションでは例外を投げること (Fail-Closed)", () => {
      // 1. regulationId 未指定 (undefined) の場合は拒絶
      expect(() =>
        PlaytestPolicyFactory.createPolicy("evolution-g1-best", undefined, "p2")
      ).toThrow(/Evolution g1 Best AI は公式レギュレーション light-entry16 専用です \(現在の環境: undefined\)/);

      // 2. light-entry16 では正常生成
      const policy = PlaytestPolicyFactory.createPolicy(
        "evolution-g1-best",
        undefined,
        "p2",
        "light-entry16"
      );
      expect(policy).toBeDefined();
      expect(policy.descriptor.kind).toBe("genome");

      // 3. Core Battle や Standard+Pack 等の未対応環境では拒絶
      expect(() =>
        PlaytestPolicyFactory.createPolicy("evolution-g1-best", undefined, "p2", "standard-pack")
      ).toThrow(/Evolution g1 Best AI は公式レギュレーション light-entry16 専用です \(現在の環境: standard-pack\)/);

      expect(() =>
        PlaytestPolicyFactory.createPolicy("evolution-g1-best", undefined, "p2", "core-battle")
      ).toThrow(/Evolution g1 Best AI は公式レギュレーション light-entry16 専用です \(現在の環境: core-battle\)/);
    });

    it("メイン設定画面とPC簡易選択欄で各ポリシーの選択可否判定が100%一致すること", () => {
      const environmentsToTest = [
        "core-battle",
        "official:light-entry16",
        "official:standard-pack",
        "official:pro-strategy",
      ];

      for (const envId of environmentsToTest) {
        const isOfficial = envId.startsWith(OFFICIAL_ENV_PREFIX);
        const regId = envId.startsWith(OFFICIAL_ENV_PREFIX)
          ? envId.slice(OFFICIAL_ENV_PREFIX.length)
          : null;

        for (const opt of PLAYTEST_POLICY_OPTIONS) {
          // メイン画面側の判定式
          const mainIsSupported =
            !opt.supportedRegulationIds ||
            (regId !== null && opt.supportedRegulationIds.includes(regId));
          const mainIsDisabled = (opt.requiresSeed && !isOfficial) || !mainIsSupported;

          // PC簡易選択欄側の判定式
          const pcIsSupported =
            !opt.supportedRegulationIds ||
            (regId !== null && opt.supportedRegulationIds.includes(regId));
          const pcIsDisabled =
            (opt.requiresSeed && !isOfficial) || !pcIsSupported;

          expect(pcIsDisabled).toBe(mainIsDisabled);

          // evolution-g1-best の環境別期待値の検証
          if (opt.id === "evolution-g1-best") {
            if (envId === "official:light-entry16") {
              expect(mainIsDisabled).toBe(false);
              expect(pcIsDisabled).toBe(false);
            } else {
              expect(mainIsDisabled).toBe(true);
              expect(pcIsDisabled).toBe(true);
            }
          }
        }
      }
    });

    it("非対応環境 (Core Battle / Standard+Pack) では Evolution AI で対戦開始できないこと (Fail-Closed)", () => {
      const seatControllers = createSeatControllers("humanVsAi", "p1", "evolution-g1-best");

      // Core Battle (regulationId === undefined)
      expect(() =>
        PlaytestPolicyFactory.createPoliciesForMatch(seatControllers, undefined, undefined)
      ).toThrow(/Evolution g1 Best AI は公式レギュレーション light-entry16 専用です/);

      // Standard+Pack (regulationId === "standard-pack")
      expect(() =>
        PlaytestPolicyFactory.createPoliciesForMatch(seatControllers, 42, "standard-pack")
      ).toThrow(/Evolution g1 Best AI は公式レギュレーション light-entry16 専用です/);
    });
  });

  // =========================================================================
  // Section 8C: UI 対戦フロー (Human vs Evolution AI)
  // =========================================================================
  describe("Section 8C: Human vs Evolution AI Playtest Flow", () => {
    it("Human p1 vs Evolution AI p2 の対戦が成立し、AI自動進行を経て手番が交代すること", async () => {
      const outcome = startMatchAttempt({
        environmentId: officialEnvId,
        seedInput: "20261031",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const seatControllers = createSeatControllers("humanVsAi", "p1", "evolution-g1-best");
      const policies = PlaytestPolicyFactory.createPoliciesForMatch(
        seatControllers,
        outcome.activeMatch.seed,
        outcome.activeMatch.regulationId
      );

      expect(seatControllers.p1.kind).toBe("HUMAN");
      expect(seatControllers.p2.kind).toBe("POLICY");
      expect(policies.p2).toBeDefined();
      expect(policies.p2.descriptor.name).toBe("Evolution g1 Best (Experimental)");

      let step = outcome.initialStep;
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") return;

      // p1 (Human) が最初の手番を実行 (action.end)
      const req1 = step.request;
      expect(req1.playerId).toBe("p1");

      const endActionRef = req1.patterns.findIndex((p) => {
        if (p.kind !== "ACTION" || p.actionSelectionRef === undefined) return false;
        return req1.catalog.actions[p.actionSelectionRef]?.actionId === "action.end";
      });
      expect(endActionRef).toBeGreaterThanOrEqual(0);

      step = outcome.session.submitDecision({
        decisionId: req1.decisionId,
        stateVersion: req1.stateVersion,
        selectedPatternRef: endActionRef,
      });
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") return;

      // PASS
      const passPatternRef = step.request.patterns.findIndex((p) => p.kind === "PASS");
      expect(passPatternRef).toBeGreaterThanOrEqual(0);

      step = outcome.session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passPatternRef,
      });

      // p2 (Evolution AI) の手番となり、自動進行が実行されること
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") return;
      expect(step.request.playerId).toBe("p2");

      const aiResult = await advanceAutomatedDecisions(
        outcome.session,
        step,
        seatControllers,
        policies,
        { viewerPlayerId: "p1" }
      );

      expect(aiResult.status).toBe("STOPPED");
      if (aiResult.status === "STOPPED") {
        expect(aiResult.records.length).toBeGreaterThanOrEqual(1);
        for (const rec of aiResult.records) {
          expect(rec.playerId).toBe("p2");
          expect(rec.response.stateVersion).toBe(rec.request.stateVersion);
          expect(rec.response.decisionId).toBe(rec.request.decisionId);
          expect(rec.request.patterns[rec.response.selectedPatternRef]).toBeDefined();
        }
        // Human 手番またはゲーム終了で停止すること
        expect(["HUMAN_TURN", "FINISHED"]).toContain(aiResult.reason);
      }
    });

    it("Evolution AI と FirstLegal の完全自己対戦が正常に完了または進行すること", () => {
      const outcome = startMatchAttempt({
        environmentId: officialEnvId,
        seedInput: "42",
        catalog,
        fullRulePackage,
      });
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const evolutionPolicy = createEvolutionG1BestPolicy();
      const firstLegalPolicy = new FirstLegalPolicy(false);

      const simRes = SimulationRunner.run(
        outcome.session,
        { p1: evolutionPolicy, p2: firstLegalPolicy },
        { maxDecisions: 200 }
      );

      expect(simRes.totalDecisions).toBeGreaterThan(0);
      expect(simRes.turnCount).toBeGreaterThan(0);
      expect(typeof simRes.finalStateHash).toBe("string");
    });
  });

  // =========================================================================
  // Section 8D: 既存機能の回帰と共有・診断機能
  // =========================================================================
  describe("Section 8D: Regression & Diagnostics / Share URL Verification", () => {
    it("PLAYTEST_POLICY_OPTIONS に Evolution g1 Best が追加され、既存 5 ポリシーが変更されていないこと", () => {
      const options = PLAYTEST_POLICY_OPTIONS;
      expect(options.length).toBe(6);

      const ids = options.map((o) => o.id);
      expect(ids).toEqual([
        "playtestConservative",
        "firstLegal",
        "seededRandom",
        "manualGenericGenome",
        "zeroGenome",
        "evolution-g1-best",
      ]);

      const evoOpt = options.find((o) => o.id === "evolution-g1-best");
      expect(evoOpt).toBeDefined();
      expect(evoOpt?.label).toBe("Evolution g1 Best (Experimental)");
      expect(evoOpt?.description).toContain("進化学習で生成されたGenome AI");
      expect(evoOpt?.supportedRegulationIds).toEqual(["light-entry16"]);
      expect(evoOpt?.evolutionDetails?.generation).toBe("g1");
      expect(evoOpt?.evolutionDetails?.baselineRecord).toBe("9勝1敗");
      expect(evoOpt?.evolutionDetails?.dnaSchema).toBe("v6");
      expect(evoOpt?.evolutionDetails?.humanPerformance).toBe("未評価");
    });

    it("共有URLのシリアライズ・デシリアライズで policy=evolution-g1-best が正確に往復すること (重み埋め込みなし)", () => {
      const query = serializePlaytestShareUrl({
        environmentId: officialEnvId,
        mode: "humanVsAi",
        humanSeat: "p1",
        policyId: "evolution-g1-best",
        seedInput: "42",
      });

      expect(query).toContain("policy=evolution-g1-best");
      expect(query).not.toContain("weights");
      expect(query).not.toContain("patternWeights");

      const parsed = parsePlaytestShareUrl(query, catalog);
      expect(parsed.kind).toBe("READY");
      if (parsed.kind === "READY") {
        expect(parsed.config.mode).toBe("humanVsAi");
        expect(parsed.config.policyId).toBe("evolution-g1-best");
        expect(parsed.config.environmentId).toBe(officialEnvId);
      }
    });

    it("未対応環境 (Core Battle) で policy=evolution-g1-best が指定された共有URLは警告を発し FirstLegal にフォールバックすること", () => {
      const query = "?bpv=1&env=core-battle&mode=humanVsAi&human=p1&policy=evolution-g1-best&seed=42";
      const parsed = parsePlaytestShareUrl(query, catalog);

      expect(parsed.kind).toBe("READY");
      if (parsed.kind === "READY") {
        expect(parsed.config.policyId).toBe("firstLegal");
        expect(parsed.warnings.length).toBeGreaterThan(0);
        expect(parsed.warnings[0]).toContain("使用できないため、FirstLegal に変更しました");
      }
    });

    it("Playtest Diagnostic Bundle に policyMetadata (genomeId, schemaVersion, fullDnaDigest) が記録されること", () => {
      const bundle = buildPlaytestDiagnosticBundleV1({
        build: { sha: "test-sha", ref: "test-ref" },
        generatedAt: "2026-10-31T00:00:00.000Z",
        activePlaytestSettings: {
          matchMode: "humanVsAi",
          humanSeat: "p1",
          policyId: "evolution-g1-best",
        },
      });

      expect(bundle.match.policyId).toBe("evolution-g1-best");
      expect(bundle.match.policyMetadata).toBeDefined();
      expect(bundle.match.policyMetadata?.genomeId).toBe(EVOLUTION_G1_BEST_GENOME_ID);
      expect(bundle.match.policyMetadata?.schemaVersion).toBe(6);
      expect(bundle.match.policyMetadata?.fullDnaDigest).toBe(EVOLUTION_G1_BEST_FULL_DIGEST);
    });
  });

  // =========================================================================
  // Section 9: Scenario Match & Scenario Builder Integration (BP-SIM-AI-EVOLUTION-PLAYTEST-V1-R2)
  // =========================================================================
  describe("Section 9: Scenario Match & Scenario Builder Integration (BP-SIM-AI-EVOLUTION-PLAYTEST-V1-R2)", () => {
    const validLightEntry16Scenario: ScenarioDefinitionV1 = {
      version: 1,
      environmentId: "official:light-entry16",
      seed: 42,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 1,
      players: {
        p1: {
          hand: [
            { suit: "S", rank: "A" },
            { suit: "S", rank: "2" },
          ],
          field: [
            {
              componentId: "character.hero",
              cards: [{ suit: "H", rank: "Q" }],
              state: "charge",
              face: "up",
            },
          ],
          grave: [{ suit: "C", rank: "6" }],
          life: { count: 12 }, // Total 16
        },
        p2: {
          hand: [{ suit: "S", rank: "3" }],
          field: [],
          grave: [],
          life: { count: 15 }, // Total 16
        },
      },
    };

    const validStandardPackScenario: ScenarioDefinitionV1 = {
      version: 1,
      environmentId: "official:standard-pack",
      seed: 100,
      turnPlayer: "p1",
      chancePlayer: "p2",
      turnCount: 2,
      players: {
        p1: {
          hand: [
            { suit: "S", rank: "A" },
            { suit: "J", rank: "Joker", occurrence: 0 },
          ],
          field: [
            {
              componentId: "character.soldier",
              cards: [{ suit: "H", rank: "10" }],
              state: "charge",
              face: "up",
            },
          ],
          grave: [
            { suit: "C", rank: "2" },
            { suit: "C", rank: "3" },
          ],
          life: { count: 5 },
          pack: { count: 44 }, // 2 + 1 + 2 + 5 + 44 = 54
        },
        p2: {
          hand: [{ suit: "S", rank: "K" }],
          field: [],
          grave: [],
          life: { count: 5 },
          pack: { count: 48 }, // 1 + 0 + 0 + 5 + 48 = 54
        },
      },
    };

    it("1. Light＋Entry16のScenarioからEvolution AIを生成できること", () => {
      const result = prepareScenarioMatchAttempt({
        definition: validLightEntry16Scenario,
        catalog,
        fullRulePackage,
        mode: "humanVsAi",
        humanSeat: "p1",
        policyId: "evolution-g1-best",
      });

      expect(result.status).toBe("READY");
      if (result.status === "READY") {
        expect(result.prepared.policies.p2).toBeDefined();
        expect(result.prepared.policies.p2.descriptor.name).toBe("Evolution g1 Best (Experimental)");
        expect(result.prepared.activeMatch.regulationId).toBe("light-entry16");
      }
    });

    it("2. Human p1 / Evolution AI p2でScenario対戦を開始し手番交代・自動決定が進行すること", async () => {
      const result = prepareScenarioMatchAttempt({
        definition: validLightEntry16Scenario,
        catalog,
        fullRulePackage,
        mode: "humanVsAi",
        humanSeat: "p1",
        policyId: "evolution-g1-best",
      });

      expect(result.status).toBe("READY");
      if (result.status !== "READY") return;

      const { session, initialStep, seatControllers, policies } = result.prepared;
      expect(initialStep.type).toBe("WAITING_FOR_DECISION");
      if (initialStep.type !== "WAITING_FOR_DECISION") return;

      // p1 (Human) が最初の手番を実行 (action.end)
      const req1 = initialStep.request;
      expect(req1.playerId).toBe("p1");

      const endActionRef = req1.patterns.findIndex((p) => {
        if (p.kind !== "ACTION" || p.actionSelectionRef === undefined) return false;
        return req1.catalog.actions[p.actionSelectionRef]?.actionId === "action.end";
      });
      expect(endActionRef).toBeGreaterThanOrEqual(0);

      let step = session.submitDecision({
        decisionId: req1.decisionId,
        stateVersion: req1.stateVersion,
        selectedPatternRef: endActionRef,
      });

      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") return;

      // PASS
      const passPatternRef = step.request.patterns.findIndex((p) => p.kind === "PASS");
      expect(passPatternRef).toBeGreaterThanOrEqual(0);

      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passPatternRef,
      });

      // p2 (Evolution AI) の手番となり、自動決定が実行されること
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") return;
      expect(step.request.playerId).toBe("p2");

      const aiResult = await advanceAutomatedDecisions(
        session,
        step,
        seatControllers,
        policies,
        { viewerPlayerId: "p1" }
      );

      expect(aiResult.status).toBe("STOPPED");
      if (aiResult.status === "STOPPED") {
        expect(aiResult.records.length).toBeGreaterThanOrEqual(1);
        expect(aiResult.records[0].playerId).toBe("p2");
        expect(["HUMAN_TURN", "FINISHED"]).toContain(aiResult.reason);
      }
    });

    it("3. Standard＋PackのScenarioでは生成を拒絶すること (Fail-Closed)", () => {
      const result = prepareScenarioMatchAttempt({
        definition: validStandardPackScenario,
        catalog,
        fullRulePackage,
        mode: "humanVsAi",
        humanSeat: "p1",
        policyId: "evolution-g1-best",
      });

      expect(result.status).toBe("PREPARE_ERROR");
      if (result.status === "PREPARE_ERROR") {
        expect(result.error).toContain("Evolution g1 Best");
        expect(result.error).toContain("standard-pack");
      }
    });

    it("4. regulationId未指定 (core-battle 等) では生成を拒絶すること (Fail-Closed)", () => {
      const coreBattleScenario: ScenarioDefinitionV1 = {
        ...validLightEntry16Scenario,
        environmentId: "core-battle",
      };

      const result = prepareScenarioMatchAttempt({
        definition: coreBattleScenario,
        catalog,
        fullRulePackage,
        mode: "humanVsAi",
        humanSeat: "p1",
        policyId: "evolution-g1-best",
      });

      expect(result.status).toBe("PREPARE_ERROR");
      if (result.status === "PREPARE_ERROR") {
        expect(result.error).toContain("Evolution g1 Best");
      }
    });

    it("5. Scenario BuilderのPolicy選択制約が通常のMatchSetupおよびPC簡易選択と100%一致すること", () => {
      const environmentsToTest = [
        "core-battle",
        "official:light-entry16",
        "official:standard-pack",
        "official:pro-strategy",
      ];

      for (const envId of environmentsToTest) {
        const isOfficial = envId.startsWith(OFFICIAL_ENV_PREFIX);
        const regId = envId.startsWith(OFFICIAL_ENV_PREFIX)
          ? envId.slice(OFFICIAL_ENV_PREFIX.length)
          : null;

        for (const opt of PLAYTEST_POLICY_OPTIONS) {
          // 通常のMatchSetup / PC簡易選択側の判定
          const mainIsSupported =
            !opt.supportedRegulationIds ||
            (regId !== null && opt.supportedRegulationIds.includes(regId));
          const mainIsDisabled = (opt.requiresSeed && !isOfficial) || !mainIsSupported;

          // Scenario Builder 側の判定
          const builderIsSupported =
            !opt.supportedRegulationIds ||
            (regId !== null && opt.supportedRegulationIds.includes(regId));
          const builderIsDisabled = (opt.requiresSeed && !isOfficial) || !builderIsSupported;

          expect(builderIsDisabled).toBe(mainIsDisabled);

          if (opt.id === "evolution-g1-best") {
            if (envId === "official:light-entry16") {
              expect(builderIsDisabled).toBe(false);
            } else {
              expect(builderIsDisabled).toBe(true);
            }
          }
        }
      }
    });

    it("6. ScenarioBuilderModal の UI レベルで非対応AIでの開始を遮断すること (Fail-Closed)", () => {
      let started = false;
      const onStart = () => {
        started = true;
      };

      // A: official:standard-pack (非対応環境) で evolution-g1-best を初期設定してマウント
      let renderer: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          React.createElement(ScenarioBuilderModal, {
            isOpen: true,
            onClose: () => {},
            catalog,
            fullRulePackage,
            onStartScenario: onStart,
            initialEnvironmentId: "official:standard-pack",
            initialMode: "humanVsAi",
            initialPolicyId: "evolution-g1-best",
            initialTab: "settings",
          })
        );
      });

      // 開始ボタンを探す
      const buttons = renderer!.root.findAllByType("button");
      const modalStartBtn = buttons.find((b) => {
        const span = b.children.find((c: any) => typeof c === "object" && c.props?.children === "初期盤面で対戦開始");
        return Boolean(span);
      });

      expect(modalStartBtn).toBeDefined();
      expect(modalStartBtn!.props.disabled).toBe(true);

      // 非対応警告が表示されていること
      const warnings = renderer!.root.findAllByProps({
        "data-testid": "scenario-builder-policy-incompatible-warning",
      });
      expect(warnings.length).toBeGreaterThan(0);

      // disabled状態でクリックしても onStart は発火しないこと
      act(() => {
        modalStartBtn!.props.onClick();
      });
      expect(started).toBe(false);

      // B: official:light-entry16 (対応環境) で evolution-g1-best の場合は開始可能
      let lightRenderer: TestRenderer.ReactTestRenderer;
      act(() => {
        lightRenderer = TestRenderer.create(
          React.createElement(ScenarioBuilderModal, {
            isOpen: true,
            onClose: () => {},
            catalog,
            fullRulePackage,
            onStartScenario: onStart,
            initialEnvironmentId: "official:light-entry16",
            initialMode: "humanVsAi",
            initialPolicyId: "evolution-g1-best",
            initialTab: "settings",
          })
        );
      });

      const lightButtons = lightRenderer!.root.findAllByType("button");
      const lightStartBtn = lightButtons.find((b) => {
        const span = b.children.find((c: any) => typeof c === "object" && c.props?.children === "初期盤面で対戦開始");
        return Boolean(span);
      });
      expect(lightStartBtn).toBeDefined();
      expect(lightStartBtn!.props.disabled).toBe(false);

      const lightWarnings = lightRenderer!.root.findAllByProps({
        "data-testid": "scenario-builder-policy-incompatible-warning",
      });
      expect(lightWarnings.length).toBe(0);

      act(() => {
        lightStartBtn!.props.onClick();
      });
      expect(started).toBe(true);
    });

    it("7. 既存Scenarioと既存AI (playtestConservative, firstLegal) の回帰がないこと", () => {
      const conservativeResult = prepareScenarioMatchAttempt({
        definition: validLightEntry16Scenario,
        catalog,
        fullRulePackage,
        mode: "humanVsAi",
        humanSeat: "p1",
        policyId: "playtestConservative",
      });
      expect(conservativeResult.status).toBe("READY");

      const firstLegalStandardResult = prepareScenarioMatchAttempt({
        definition: validStandardPackScenario,
        catalog,
        fullRulePackage,
        mode: "humanVsAi",
        humanSeat: "p1",
        policyId: "firstLegal",
      });
      expect(firstLegalStandardResult.status).toBe("READY");
    });
  });
});
