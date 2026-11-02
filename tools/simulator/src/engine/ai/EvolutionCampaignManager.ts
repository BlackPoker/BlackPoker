/**
 * Evolution Campaign Manager (BP-SIM-AI-V92-WORK3-CAMPAIGN-ORCHESTRATOR)
 *
 * Standard＋Pack における多世代進化学習（Evolution Campaign）を
 * ステップ駆動で統括・追跡・管理するオーケストレーターエンジン。
 *
 * 設計原則と責務:
 * 1. 世代遷移の一元委譲: EvolutionLoop.run を generationCount: 1 でステップ駆動呼び出し
 * 2. 厳格な母集団境界: P_g からの Champion 候補特定、P_(g+1) は未対戦オフスプリングとして次世代へ引き継ぐ
 * 3. 独立 Validation 評価: 世代内 Fitness 上位候補を固定 Baseline 群と対戦させ客観的実力を測定
 * 4. 決定論的 Champion 選定: 同点時の確定 Tie-Break、未対戦 DNA や評価失敗個体の排除、Holdout 未認定の明記
 * 5. Checkpoint / Resume: SHA-256 チェックサム完全性保証、一時ファイルからのアトミック置換、二重実行防止
 * 6. Seed Registry 履歴管理: Training / Validation / Holdout の厳格分離と非重複保証
 * 7. Early Stopping: 未改善 (正常早期終了) と無効 Evidence (異常停止) の明確な区別
 */

import {
  CAMPAIGN_VERSION,
  CampaignChampionInfo,
  CampaignCheckpointState,
  CampaignCheckpointStorage,
  CampaignEarlyStoppingState,
  CampaignExecutionResult,
  CampaignGenerationRecord,
  CampaignLogicalResult,
  CampaignRuntimeMetrics,
  CampaignSeedRegistry,
  CampaignStatus,
  EvolutionCampaignConfig,
  EvolutionCampaignConfigurationError,
  EvolutionCampaignExecutionError,
  EvolutionCampaignIntegrityError,
  InMemoryCampaignCheckpointStorage,
} from "../../domain/ai/EvolutionCampaignTypes";
import {
  EvolutionLoop,
} from "./EvolutionLoop";
import {
  canonicalGenerationStreamKey,
  canonicalLoopSeedScheduleIdentity,
} from "../../domain/ai/EvolutionLoopTypes";
import {
  EvolutionIndependentEvaluator,
} from "./EvolutionIndependentEvaluator";
import {
  EvaluationSeedSet,
  IndependentEvaluationLogicalResult,
} from "../../domain/ai/EvolutionEvaluationTypes";
import {
  DecisionDNA,
} from "../../domain/ai/DecisionDNATypes";
import {
  DecisionDNACodec,
} from "./DecisionDNACodec";
import {
  PopulationSnapshot,
  FitnessEvaluationSnapshot,
} from "../../domain/ai/PopulationSelectionTypes";
import {
  GenerationRunnerEnvironmentContext,
} from "../../domain/ai/GenerationRunnerTypes";
import { SemanticSHA256 } from "./SemanticSHA256";

/**
 * 簡易パス結合ヘルパー (Node path 非依存)
 */
function joinPath(dir: string, file: string): string {
  const cleanDir = dir.replace(/[/\\]+$/, "");
  return `${cleanDir}/${file}`;
}

function sha256(data: string): string {
  return SemanticSHA256.hash(data);
}

export class EvolutionCampaignManager {
  /**
   * キャンペーン設定の Fail-Fast 入力検証
   */
  public static validateConfig(config: EvolutionCampaignConfig): void {
    if (!config || typeof config !== "object") {
      throw new EvolutionCampaignConfigurationError("EvolutionCampaignConfig must be a valid non-null object");
    }

    const {
      campaignId,
      campaignSeed,
      totalGenerations,
      initialPopulation,
      validationOpponents,
      validationSeeds,
      sessionFactory,
      significanceLevelAlpha = 0.05,
      minimumCompletedPairs = 5,
      maxDecisionsPerMatch = 500,
      earlyStopping,
      checkpointIntervalGenerations = 1,
    } = config;

    // campaignId 検証
    if (typeof campaignId !== "string" || campaignId.trim() === "") {
      throw new EvolutionCampaignConfigurationError("campaignId must be a non-empty string");
    }

    // campaignSeed 検証
    if (typeof campaignSeed !== "number" || !Number.isFinite(campaignSeed) || !Number.isInteger(campaignSeed)) {
      throw new EvolutionCampaignConfigurationError(`campaignSeed must be a finite integer, received ${campaignSeed}`);
    }

    // totalGenerations 検証 (有限整数 >= 1)
    if (
      typeof totalGenerations !== "number" ||
      !Number.isFinite(totalGenerations) ||
      !Number.isInteger(totalGenerations) ||
      totalGenerations < 1
    ) {
      throw new EvolutionCampaignConfigurationError(
        `totalGenerations must be an integer >= 1, received ${totalGenerations}`
      );
    }

    // initialPopulation 検証
    if (!initialPopulation || typeof initialPopulation !== "object") {
      throw new EvolutionCampaignConfigurationError("initialPopulation must be a valid object");
    }
    if (initialPopulation.generation !== 0) {
      throw new EvolutionCampaignConfigurationError(
        `initialPopulation.generation must be 0 for a new campaign, received ${initialPopulation.generation}`
      );
    }
    if (!Array.isArray(initialPopulation.entries) || initialPopulation.entries.length < 2) {
      throw new EvolutionCampaignConfigurationError("initialPopulation.entries must contain at least 2 entries");
    }
    for (const ind of initialPopulation.entries) {
      if (!ind || !ind.genomeId || !ind.dna) {
        throw new EvolutionCampaignConfigurationError("Each entry in initialPopulation must have genomeId and dna");
      }
      DecisionDNACodec.validate(ind.dna);
    }

    // validationOpponents 検証
    if (!Array.isArray(validationOpponents) || validationOpponents.length === 0) {
      throw new EvolutionCampaignConfigurationError("validationOpponents must be a non-empty array");
    }

    // validationSeeds 検証
    if (!Array.isArray(validationSeeds) || validationSeeds.length === 0) {
      throw new EvolutionCampaignConfigurationError("validationSeeds must be a non-empty array of numbers");
    }
    const uniqueValSeeds = new Set<number>();
    for (const s of validationSeeds) {
      if (typeof s !== "number" || !Number.isFinite(s) || !Number.isInteger(s)) {
        throw new EvolutionCampaignConfigurationError(`Invalid validation seed: ${s}`);
      }
      if (uniqueValSeeds.has(s)) {
        throw new EvolutionCampaignConfigurationError(`Duplicate validation seed detected: ${s}`);
      }
      uniqueValSeeds.add(s);
    }

    // sessionFactory 検証
    if (typeof sessionFactory !== "function") {
      throw new EvolutionCampaignConfigurationError("sessionFactory must be a function");
    }

    // significanceLevelAlpha 検証 (0 < alpha < 0.5)
    if (
      typeof significanceLevelAlpha !== "number" ||
      !Number.isFinite(significanceLevelAlpha) ||
      significanceLevelAlpha <= 0 ||
      significanceLevelAlpha >= 0.5
    ) {
      throw new EvolutionCampaignConfigurationError(
        `significanceLevelAlpha must be between 0 and 0.5 (exclusive), received ${significanceLevelAlpha}`
      );
    }

    // minimumCompletedPairs 検証
    if (
      typeof minimumCompletedPairs !== "number" ||
      !Number.isFinite(minimumCompletedPairs) ||
      !Number.isInteger(minimumCompletedPairs) ||
      minimumCompletedPairs < 1
    ) {
      throw new EvolutionCampaignConfigurationError(
        `minimumCompletedPairs must be an integer >= 1, received ${minimumCompletedPairs}`
      );
    }

    // maxDecisionsPerMatch 検証
    if (
      typeof maxDecisionsPerMatch !== "number" ||
      !Number.isFinite(maxDecisionsPerMatch) ||
      !Number.isInteger(maxDecisionsPerMatch) ||
      maxDecisionsPerMatch < 1
    ) {
      throw new EvolutionCampaignConfigurationError(
        `maxDecisionsPerMatch must be an integer >= 1, received ${maxDecisionsPerMatch}`
      );
    }

    // earlyStopping 設定検証
    if (earlyStopping !== undefined) {
      if (
        typeof earlyStopping.patience !== "number" ||
        !Number.isFinite(earlyStopping.patience) ||
        !Number.isInteger(earlyStopping.patience) ||
        earlyStopping.patience < 1
      ) {
        throw new EvolutionCampaignConfigurationError(
          `earlyStopping.patience must be an integer >= 1, received ${earlyStopping.patience}`
        );
      }
      if (
        earlyStopping.minGenerations !== undefined &&
        (typeof earlyStopping.minGenerations !== "number" ||
          !Number.isFinite(earlyStopping.minGenerations) ||
          !Number.isInteger(earlyStopping.minGenerations) ||
          earlyStopping.minGenerations < 0)
      ) {
        throw new EvolutionCampaignConfigurationError(
          `earlyStopping.minGenerations must be an integer >= 0, received ${earlyStopping.minGenerations}`
        );
      }
    }

    // checkpointIntervalGenerations 検証
    if (
      typeof checkpointIntervalGenerations !== "number" ||
      !Number.isFinite(checkpointIntervalGenerations) ||
      !Number.isInteger(checkpointIntervalGenerations) ||
      checkpointIntervalGenerations < 1
    ) {
      throw new EvolutionCampaignConfigurationError(
        `checkpointIntervalGenerations must be an integer >= 1, received ${checkpointIntervalGenerations}`
      );
    }
  }

  /**
   * チェックポイント状態のチェックサム (SHA-256) を計算
   */
  public static computeCheckpointChecksum(state: Omit<CampaignCheckpointState, "checksum">): string {
    const serialized = JSON.stringify({
      checkpointVersion: state.checkpointVersion,
      campaignId: state.campaignId,
      campaignSeed: state.campaignSeed,
      regulationId: state.regulationId,
      frameId: state.frameId,
      rulePackageVersion: state.rulePackageVersion,
      featureSchemaVersion: state.featureSchemaVersion,
      totalTargetGenerations: state.totalTargetGenerations,
      completedGenerations: state.completedGenerations,
      nextGenerationToProcess: state.nextGenerationToProcess,
      nextPopulation: {
        generation: state.nextPopulation.generation,
        entries: state.nextPopulation.entries.map((entry) => ({
          genomeId: entry.genomeId,
          dnaDigest: EvolutionIndependentEvaluator.computeDnaDigest(entry.dna),
        })),
      },
      provisionalBestChampion: state.provisionalBestChampion
        ? {
            generation: state.provisionalBestChampion.generation,
            genomeId: state.provisionalBestChampion.genomeId,
            dnaDigest: state.provisionalBestChampion.dnaDigest,
            validationMeanWinRate: state.provisionalBestChampion.validationMeanWinRate,
          }
        : null,
      historyLength: state.history.length,
      historySummary: state.history.map((h) => ({
        generation: h.generation,
        candidateGenomeId: h.candidateGenomeId,
        candidateDnaDigest: h.candidateDnaDigest,
        isBestChampionUpdated: h.isBestChampionUpdated,
      })),
      seedRegistry: {
        trainingSeedsCount: Object.keys(state.seedRegistry.trainingSeedsByGeneration).length,
        validationSeeds: state.seedRegistry.validationSeeds,
      },
      earlyStoppingState: state.earlyStoppingState,
    });
    return sha256(serialized);
  }

  /**
   * チェックポイントをストレージアダプタ経由で安全に保存
   */
  public static saveCheckpoint(
    checkpointDir: string,
    stateWithoutChecksum: Omit<CampaignCheckpointState, "checksum">,
    storage: CampaignCheckpointStorage = new InMemoryCampaignCheckpointStorage()
  ): string {
    const checksum = this.computeCheckpointChecksum(stateWithoutChecksum);
    const fullState: CampaignCheckpointState = {
      ...stateWithoutChecksum,
      checksum,
    };

    const targetFilePath = joinPath(checkpointDir, `${fullState.campaignId}-checkpoint.json`);
    const serialized = JSON.stringify(fullState, null, 2);
    storage.save(targetFilePath, serialized);

    return targetFilePath;
  }

  /**
   * チェックポイントをストレージアダプタ経由で読み込み、完全性を検証して復元 (Fail-Closed)
   */
  public static loadCheckpoint(
    filePath: string,
    expectedConfig: Pick<
      EvolutionCampaignConfig,
      "campaignId" | "campaignSeed" | "regulationId" | "frameId" | "rulePackageVersion" | "featureSchemaVersion"
    >,
    storage: CampaignCheckpointStorage = new InMemoryCampaignCheckpointStorage()
  ): CampaignCheckpointState {
    if (!storage.exists(filePath)) {
      throw new EvolutionCampaignIntegrityError(`Checkpoint file does not exist: "${filePath}"`);
    }

    let parsed: any;
    try {
      const content = storage.load(filePath);
      if (content === null) {
        throw new EvolutionCampaignIntegrityError(`Checkpoint file content is null: "${filePath}"`);
      }
      parsed = JSON.parse(content);
    } catch (err: any) {
      if (err instanceof EvolutionCampaignIntegrityError) {
        throw err;
      }
      throw new EvolutionCampaignIntegrityError(
        `Failed to parse checkpoint JSON from "${filePath}": ${err?.message ?? String(err)}`
      );
    }

    if (!parsed || typeof parsed !== "object" || typeof parsed.checksum !== "string") {
      throw new EvolutionCampaignIntegrityError(`Invalid checkpoint format in "${filePath}": missing checksum`);
    }

    const { checksum, ...stateWithoutChecksum } = parsed;
    const computedChecksum = this.computeCheckpointChecksum(stateWithoutChecksum);

    if (computedChecksum !== checksum) {
      throw new EvolutionCampaignIntegrityError(
        `Checkpoint checksum mismatch in "${filePath}": expected "${computedChecksum}", found "${checksum}" (tampering or corruption detected)`
      );
    }

    // 設定照合
    if (parsed.campaignId !== expectedConfig.campaignId) {
      throw new EvolutionCampaignIntegrityError(
        `Checkpoint campaignId mismatch: expected "${expectedConfig.campaignId}", found "${parsed.campaignId}"`
      );
    }
    if (parsed.campaignSeed !== expectedConfig.campaignSeed) {
      throw new EvolutionCampaignIntegrityError(
        `Checkpoint campaignSeed mismatch: expected ${expectedConfig.campaignSeed}, found ${parsed.campaignSeed}`
      );
    }
    const expectedReg = expectedConfig.regulationId ?? "standard-pack";
    if (parsed.regulationId !== expectedReg) {
      throw new EvolutionCampaignIntegrityError(
        `Checkpoint regulationId mismatch: expected "${expectedReg}", found "${parsed.regulationId}"`
      );
    }
    const expectedFrameId = expectedConfig.frameId ?? "entry16";
    if (parsed.frameId !== expectedFrameId) {
      throw new EvolutionCampaignIntegrityError(
        `Checkpoint frameId mismatch: expected "${expectedFrameId}", found "${parsed.frameId}"`
      );
    }
    const expectedRuleVer = expectedConfig.rulePackageVersion ?? "1.0.0";
    if (parsed.rulePackageVersion !== expectedRuleVer) {
      throw new EvolutionCampaignIntegrityError(
        `Checkpoint rulePackageVersion mismatch: expected "${expectedRuleVer}", found "${parsed.rulePackageVersion}"`
      );
    }
    const expectedSchemaVer = expectedConfig.featureSchemaVersion ?? 6;
    if (parsed.featureSchemaVersion !== expectedSchemaVer) {
      throw new EvolutionCampaignIntegrityError(
        `Checkpoint featureSchemaVersion mismatch: expected ${expectedSchemaVer}, found ${parsed.featureSchemaVersion}`
      );
    }

    // 世代整合性検証
    if (parsed.completedGenerations !== parsed.history.length) {
      throw new EvolutionCampaignIntegrityError(
        `Checkpoint generation inconsistency: completedGenerations (${parsed.completedGenerations}) does not match history length (${parsed.history.length})`
      );
    }
    if (parsed.nextGenerationToProcess !== parsed.completedGenerations) {
      throw new EvolutionCampaignIntegrityError(
        `Checkpoint nextGenerationToProcess (${parsed.nextGenerationToProcess}) does not match completedGenerations (${parsed.completedGenerations})`
      );
    }
    if (parsed.nextPopulation.generation !== parsed.completedGenerations) {
      throw new EvolutionCampaignIntegrityError(
        `Checkpoint nextPopulation generation (${parsed.nextPopulation.generation}) does not match completedGenerations (${parsed.completedGenerations})`
      );
    }

    return parsed as CampaignCheckpointState;
  }

  /**
   * 世代内 Fitness Snapshot から決定論的に最上位 Champion 候補を特定
   *
   * 契約:
   * 1. VALID な個体のみを候補とする (INVALID / INSUFFICIENT は除外)
   * 2. 決定論的ソート (fitnessScore 降順 -> wins 降順 -> genomeId 昇順)
   * 3. 必ず実績のある sourcePopulation (P_g) の entries から DNA を取得 (未対戦 P_(g+1) からは取得しない)
   */
  public static selectGenerationChampionCandidate(
    fitnessSnapshot: FitnessEvaluationSnapshot,
    sourcePopulation: PopulationSnapshot
  ): { readonly genomeId: string; readonly fitnessScore: number; readonly dna: DecisionDNA } {
    if (!fitnessSnapshot || !fitnessSnapshot.entries || fitnessSnapshot.entries.length === 0) {
      throw new EvolutionCampaignExecutionError("Cannot select champion candidate: fitnessSnapshot.entries is empty");
    }

    // VALID なエントリのみを抽出
    const validEntries = fitnessSnapshot.entries.filter(
      (e): e is typeof e & { result: { status: "VALID"; fitnessScore: number; wins: number } } =>
        e.result.status === "VALID"
    );

    if (validEntries.length === 0) {
      throw new EvolutionCampaignExecutionError(
        `Cannot select champion candidate: generation ${fitnessSnapshot.generation} has no VALID fitness entries`
      );
    }

    // 決定論的ソート (fitnessScore 降順 -> wins 降順 -> genomeId 昇順)
    const sorted = [...validEntries].sort((a, b) => {
      if (b.result.fitnessScore !== a.result.fitnessScore) {
        return b.result.fitnessScore - a.result.fitnessScore;
      }
      if (b.result.wins !== a.result.wins) {
        return b.result.wins - a.result.wins;
      }
      return a.genomeId.localeCompare(b.genomeId);
    });

    const bestEntry = sorted[0];

    // 必ず実績のある sourcePopulation (P_g) から DNA を取得
    const populationEntry = sourcePopulation.entries.find((e) => e.genomeId === bestEntry.genomeId);
    if (!populationEntry) {
      throw new EvolutionCampaignExecutionError(
        `Champion candidate genomeId "${bestEntry.genomeId}" not found in generation ${sourcePopulation.generation} population entries`
      );
    }

    return {
      genomeId: populationEntry.genomeId,
      fitnessScore: bestEntry.result.fitnessScore,
      dna: populationEntry.dna,
    };
  }

  /**
   * 多世代進化学習キャンペーンを実行
   */
  public static run(config: EvolutionCampaignConfig): CampaignExecutionResult {
    const startTime = performance.now();

    // 1. 設定の Fail-Fast 検証
    this.validateConfig(config);

    const {
      campaignId,
      campaignSeed,
      totalGenerations,
      initialPopulation,
      validationOpponents,
      validationSeeds,
      sessionFactory,
      regulationId = "standard-pack",
      frameId = "entry16",
      rulePackageVersion = "1.0.0",
      featureSchemaVersion = 6,
      runnerConfig,
      earlyStopping,
      checkpointDir,
      checkpointIntervalGenerations = 1,
      significanceLevelAlpha = 0.05,
      minimumCompletedPairs = 5,
      maxDecisionsPerMatch = 500,
      resumeFromCheckpointPath,
    } = config;

    // 2. 初期 Seed 空間の衝突事前検証
    EvolutionIndependentEvaluator.assertNoSeedCollision([
      { category: "VALIDATION", seeds: validationSeeds },
    ]);

    // 3. 状態の初期化または Checkpoint からの復元
    let completedGenerations = 0;
    let currentPopulation = initialPopulation;
    let provisionalBestChampion: CampaignChampionInfo | null = null;
    const history: CampaignGenerationRecord[] = [];
    const trainingSeedsByGeneration: Record<number, number[]> = {};
    const allUsedSeedsSet = new Set<number>(validationSeeds);

    let earlyStoppingState: CampaignEarlyStoppingState = {
      enabled: Boolean(earlyStopping),
      patience: earlyStopping?.patience ?? 3,
      minGenerations: earlyStopping?.minGenerations ?? 0,
      noImprovementCount: 0,
      bestValidationMeanScore: 0.0,
      triggered: false,
    };

    const storage: CampaignCheckpointStorage =
      config.checkpointStorage ?? new InMemoryCampaignCheckpointStorage();

    if (resumeFromCheckpointPath) {
      const restored = this.loadCheckpoint(
        resumeFromCheckpointPath,
        {
          campaignId,
          campaignSeed,
          regulationId,
          frameId,
          rulePackageVersion,
          featureSchemaVersion,
        },
        storage
      );

      completedGenerations = restored.completedGenerations;
      currentPopulation = restored.nextPopulation;
      provisionalBestChampion = restored.provisionalBestChampion;
      history.push(...restored.history);
      Object.assign(trainingSeedsByGeneration, restored.seedRegistry.trainingSeedsByGeneration);
      for (const s of restored.seedRegistry.allUsedSeeds) {
        allUsedSeedsSet.add(s);
      }
      earlyStoppingState = { ...restored.earlyStoppingState };
    }

    const environment: GenerationRunnerEnvironmentContext = {
      environmentRef: `campaign:${campaignId}`,
      regulationId,
      frameId,
      rulePackageVersion,
    };

    let campaignStatus: CampaignStatus = "COMPLETED";
    let stopReason = `All target generations (${totalGenerations}) completed successfully`;
    let totalTrainingMatches = 0;
    let totalValidationMatches = 0;

    // 4. 多世代ステップ駆動ループ (g = completedGenerations .. totalGenerations - 1)
    for (let g = completedGenerations; g < totalGenerations; g++) {
      const genStreamKey = canonicalGenerationStreamKey(g);
      const generationSeedScheduleIdentity = canonicalLoopSeedScheduleIdentity(campaignSeed);

      // 4.1 世代 g の進化処理を一括委譲 (EvolutionLoop.run with generationCount: 1)
      const loopResult = EvolutionLoop.run({
        initialPopulation: currentPopulation,
        campaignSeed,
        environment,
        sessionFactory,
        config: {
          generationCount: 1,
          runnerConfig,
        },
      });

      // 4.2 戻り値ステータス分岐契約
      if (loopResult.logicalResult.status === "REEVALUATION_REQUIRED") {
        campaignStatus = "REEVALUATION_REQUIRED";
        stopReason = `Evolution loop aborted at generation ${g}: REEVALUATION_REQUIRED (${loopResult.logicalResult.reason})`;
        break;
      }

      const completedLoop = loopResult.logicalResult;
      const genAdvancedRecord = completedLoop.generations[0];
      const fitnessSnapshot = genAdvancedRecord.fitnessSnapshot;
      const nextPopulation = completedLoop.finalPopulation; // 未対戦オフスプリング P_(g+1)

      // 4.3 Training match seeds の収集と Seed Registry への登録
      const matchSeeds: number[] = [];
      if ((genAdvancedRecord as any).schedule?.matches) {
        for (const m of (genAdvancedRecord as any).schedule.matches) {
          matchSeeds.push(m.matchSeed);
        }
      }
      trainingSeedsByGeneration[g] = matchSeeds;
      for (const s of matchSeeds) {
        allUsedSeedsSet.add(s);
      }
      totalTrainingMatches += matchSeeds.length;

      // 4.4 世代 g の Champion 候補を特定 (P_g のみから選定)
      const candidateInfo = EvolutionCampaignManager.selectGenerationChampionCandidate(
        fitnessSnapshot,
        currentPopulation
      );
      const candidateDnaDigest = EvolutionIndependentEvaluator.computeDnaDigest(candidateInfo.dna);

      // 4.5 独立 Validation 評価の実行
      // 過去世代の Training seeds を集約して seedRegistry を構築
      const priorSeedSets: EvaluationSeedSet[] = [];
      for (const [genStr, sArr] of Object.entries(trainingSeedsByGeneration)) {
        priorSeedSets.push({ category: "TRAINING", seeds: sArr });
      }

      const valResult = EvolutionIndependentEvaluator.evaluate({
        candidateDNA: candidateInfo.dna,
        seeds: validationSeeds,
        seedCategory: "VALIDATION",
        seedRegistry: priorSeedSets,
        opponents: validationOpponents,
        sessionFactory,
        significanceLevelAlpha,
        minimumCompletedPairs,
        maxDecisionsPerMatch,
        regulationId,
        rulePackageVersion,
        featureSchemaVersion,
      });

      totalValidationMatches += valResult.totalMatches;

      // 4.6 Validation Evidence の妥当性検証 (無効 Evidence は Fail-Closed 停止)
      if (valResult.evidenceStatus !== "VALID") {
        campaignStatus = "FAILED";
        stopReason = `Validation evaluation failed for generation ${g} champion candidate: evidenceStatus="${valResult.evidenceStatus}"`;
        break;
      }

      // 4.7 Validation スコア集計と暫定最良 Champion の追跡
      const valOppSummaries = Object.values(valResult.opponents);
      const meanValidationWinRate =
        valOppSummaries.reduce((acc, s) => acc + s.meanPairScore, 0) / valOppSummaries.length;

      let isBestChampionUpdated = false;

      if (provisionalBestChampion === null) {
        // 第0世代の候補を初代暫定最良 Champion として登録
        provisionalBestChampion = {
          generation: g,
          genomeId: candidateInfo.genomeId,
          dna: DecisionDNACodec.clone(candidateInfo.dna),
          dnaDigest: candidateDnaDigest,
          selectionReason: `Generation ${g} fitness top candidate verified by validation (initial baseline champion)`,
          fitnessScore: candidateInfo.fitnessScore,
          validationMeanWinRate: meanValidationWinRate,
          validationOpponentSummaries: valResult.opponents,
          isHoldoutVerified: false,
        };
        earlyStoppingState = {
          ...earlyStoppingState,
          bestValidationMeanScore: meanValidationWinRate,
          noImprovementCount: 0,
        };
        isBestChampionUpdated = true;
      } else {
        // 前 Champion との比較
        if (meanValidationWinRate > earlyStoppingState.bestValidationMeanScore) {
          provisionalBestChampion = {
            generation: g,
            genomeId: candidateInfo.genomeId,
            dna: DecisionDNACodec.clone(candidateInfo.dna),
            dnaDigest: candidateDnaDigest,
            selectionReason: `Generation ${g} fitness top candidate improved validation win rate from ${earlyStoppingState.bestValidationMeanScore.toFixed(3)} to ${meanValidationWinRate.toFixed(3)}`,
            fitnessScore: candidateInfo.fitnessScore,
            validationMeanWinRate: meanValidationWinRate,
            validationOpponentSummaries: valResult.opponents,
            isHoldoutVerified: false,
          };
          earlyStoppingState = {
            ...earlyStoppingState,
            bestValidationMeanScore: meanValidationWinRate,
            noImprovementCount: 0,
          };
          isBestChampionUpdated = true;
        } else {
          earlyStoppingState = {
            ...earlyStoppingState,
            noImprovementCount: earlyStoppingState.noImprovementCount + 1,
          };
          isBestChampionUpdated = false;
        }
      }

      // 4.8 世代履歴レコードの記録
      const genRecord: CampaignGenerationRecord = {
        generation: g,
        generationSeed: genAdvancedRecord.generationSeed,
        trainingSeedScheduleIdentity: generationSeedScheduleIdentity,
        trainingMatchCount: matchSeeds.length,
        candidateGenomeId: candidateInfo.genomeId,
        candidateDnaDigest,
        candidateFitnessScore: candidateInfo.fitnessScore,
        validationResult: valResult,
        isBestChampionUpdated,
        timestamp: new Date().toISOString(),
      };
      history.push(genRecord);

      completedGenerations = g + 1;
      currentPopulation = nextPopulation;

      // 4.9 Early Stopping 判定
      if (
        earlyStoppingState.enabled &&
        g >= earlyStoppingState.minGenerations &&
        earlyStoppingState.noImprovementCount >= earlyStoppingState.patience
      ) {
        earlyStoppingState = {
          ...earlyStoppingState,
          triggered: true,
        };
        campaignStatus = "EARLY_STOPPED";
        stopReason = `Early stopping triggered at generation ${g}: no validation improvement for ${earlyStoppingState.noImprovementCount} consecutive generations (patience=${earlyStoppingState.patience})`;

        // Checkpoint 保存 (指定時)
        if (checkpointDir) {
          this.saveCheckpoint(
            checkpointDir,
            {
              checkpointVersion: CAMPAIGN_VERSION,
              campaignId,
              campaignSeed,
              regulationId,
              frameId,
              rulePackageVersion,
              featureSchemaVersion,
              totalTargetGenerations: totalGenerations,
              completedGenerations,
              nextGenerationToProcess: completedGenerations,
              nextPopulation: currentPopulation,
              provisionalBestChampion,
              history,
              seedRegistry: {
                trainingSeedsByGeneration,
                validationSeeds,
                holdoutSeeds: [],
                allUsedSeeds: Array.from(allUsedSeedsSet),
              },
              earlyStoppingState,
              timestamp: new Date().toISOString(),
            },
            storage
          );
        }

        break;
      }

      // 4.10 Checkpoint 定期保存
      if (checkpointDir && completedGenerations % checkpointIntervalGenerations === 0) {
        this.saveCheckpoint(
          checkpointDir,
          {
            checkpointVersion: CAMPAIGN_VERSION,
            campaignId,
            campaignSeed,
            regulationId,
            frameId,
            rulePackageVersion,
            featureSchemaVersion,
            totalTargetGenerations: totalGenerations,
            completedGenerations,
            nextGenerationToProcess: completedGenerations,
            nextPopulation: currentPopulation,
            provisionalBestChampion,
            history,
            seedRegistry: {
              trainingSeedsByGeneration,
              validationSeeds,
              holdoutSeeds: [],
              allUsedSeeds: Array.from(allUsedSeedsSet),
            },
            earlyStoppingState,
            timestamp: new Date().toISOString(),
          },
          storage
        );
      }
    }

    const endTime = performance.now();
    const timestamp = new Date().toISOString();

    const seedRegistry: CampaignSeedRegistry = {
      trainingSeedsByGeneration,
      validationSeeds,
      holdoutSeeds: [],
      allUsedSeeds: Array.from(allUsedSeedsSet),
    };

    const summaryText = `[Campaign ${campaignId}] Status: ${campaignStatus}, Completed: ${completedGenerations}/${totalGenerations} generations, Best Champion: ${provisionalBestChampion ? `Gen ${provisionalBestChampion.generation} (${provisionalBestChampion.genomeId}, ValWR: ${provisionalBestChampion.validationMeanWinRate.toFixed(3)})` : "None"}, Stop Reason: ${stopReason}`;

    const logicalResult: CampaignLogicalResult = {
      campaignVersion: CAMPAIGN_VERSION,
      campaignId,
      campaignSeed,
      regulationId,
      frameId,
      rulePackageVersion,
      featureSchemaVersion,
      totalTargetGenerations: totalGenerations,
      completedGenerations,
      status: campaignStatus,
      stopReason,
      provisionalBestChampion,
      history: Object.freeze(history),
      finalPopulation: currentPopulation,
      seedRegistry,
      summaryText,
    };

    const runtimeMetrics: CampaignRuntimeMetrics = {
      timestamp,
      totalExecutionTimeMs: endTime - startTime,
      generationsExecuted: completedGenerations,
      totalTrainingMatches,
      totalValidationMatches,
    };

    return {
      ...logicalResult,
      logicalResult,
      runtimeMetrics,
      timestamp,
    };
  }
}
