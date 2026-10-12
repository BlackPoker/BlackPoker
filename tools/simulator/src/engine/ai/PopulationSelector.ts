/**
 * Population & Tournament Selection Engine (BP-SIM-AI-POPULATION-SELECTION-DESIGN-V1-R1 / BP-SIM-AI-POPULATION-SELECTION-V1)
 *
 * BlackPoker Simulator AI基盤における母集団検証およびトーナメント親個体選択エンジン。
 *
 * 設計仕様: tools/simulator/docs/ai-population-selection-design-v1.md
 *
 * 最重要設計原則:
 * 1. "Victory is the objective. Life is a resource, not a score."
 * 2. DNA と Fitness の厳格な分離 (DNA オブジェクトへ適応度スコアを書き込まない)
 * 3. Standard Selection Pool は VALID 個体のみ (全敗 0.0 も正当候補、INSUFFICIENT / INVALID は完全除外)
 * 4. Tier 2 fallback 禁止 (VALID 不足時は REEVALUATION_REQUIRED で停止)
 * 5. 1 トーナメント内非復元抽出 (without replacement)、トーナメント間再利用可能
 * 6. 同点時は Seeded Deterministic Tie-Break (配列順・ID順バイアス完全排除)
 * 7. 完全な決定論的再現性 (SeededRandom)
 */

import {
  PopulationSnapshot,
  PopulationEntry,
  FitnessEvaluationSnapshot,
  PopulationFitnessEntry,
  ComparableEvaluationContext,
  SelectionReadiness,
  SelectionReadinessStatus,
  PopulationSelectionConfig,
  DEFAULT_POPULATION_SELECTION_CONFIG,
  SelectedParent,
  PopulationSelectionIntegrityError,
  PopulationSelectionConfigurationError,
  PopulationSelectionExecutionError,
  isComparableEvaluationContextEqual,
} from "../../domain/ai/PopulationSelectionTypes";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes";
import { DecisionDNACodec } from "./DecisionDNACodec";
import { RandomSource, SeededRandom } from "../random/RandomSource";

/**
 * Standard Selection Pool に登録される有効候補
 */
export interface SelectionCandidate {
  readonly genomeId: string;
  readonly dnaRef: string;
  readonly generation: number;
  readonly dna: DecisionDNA;
  readonly fitnessScore: number;
}

export class PopulationSelector {
  public readonly config: PopulationSelectionConfig;

  public constructor(config?: Partial<PopulationSelectionConfig>) {
    this.config = PopulationSelector.validateConfig(config);
  }

  /**
   * 親選択設定の検証と解決 (Fail-Fast)
   */
  public static validateConfig(
    config?: Partial<PopulationSelectionConfig>
  ): PopulationSelectionConfig {
    const minimumValidPopulationCount =
      config?.minimumValidPopulationCount !== undefined
        ? config.minimumValidPopulationCount
        : DEFAULT_POPULATION_SELECTION_CONFIG.minimumValidPopulationCount;

    const tournamentSize =
      config?.tournamentSize !== undefined
        ? config.tournamentSize
        : DEFAULT_POPULATION_SELECTION_CONFIG.tournamentSize;

    const eliteCount =
      config?.eliteCount !== undefined
        ? config.eliteCount
        : DEFAULT_POPULATION_SELECTION_CONFIG.eliteCount;

    if (
      typeof minimumValidPopulationCount !== "number" ||
      !Number.isFinite(minimumValidPopulationCount) ||
      !Number.isInteger(minimumValidPopulationCount) ||
      minimumValidPopulationCount < 2
    ) {
      throw new PopulationSelectionConfigurationError(
        `Invalid minimumValidPopulationCount: must be a finite integer >= 2, got ${minimumValidPopulationCount}`
      );
    }

    if (
      typeof tournamentSize !== "number" ||
      !Number.isFinite(tournamentSize) ||
      !Number.isInteger(tournamentSize) ||
      tournamentSize < 2
    ) {
      throw new PopulationSelectionConfigurationError(
        `Invalid tournamentSize: must be a finite integer >= 2, got ${tournamentSize}`
      );
    }

    if (
      typeof eliteCount !== "number" ||
      !Number.isFinite(eliteCount) ||
      !Number.isInteger(eliteCount) ||
      eliteCount < 0
    ) {
      throw new PopulationSelectionConfigurationError(
        `Invalid eliteCount: must be a finite non-negative integer >= 0, got ${eliteCount}`
      );
    }

    return Object.freeze({
      minimumValidPopulationCount,
      tournamentSize,
      eliteCount,
    });
  }

  /**
   * selectionSeed の厳格なバリデーション (Fail-Fast)
   *
   * 規約:
   * - finite integer のみ許可 (NaN, Infinity, -Infinity, 小数は拒絶)
   * - 0 は合法 (明示指定として許可)
   * - undefined / 未指定は拒絶 (暗黙 0 へのフォールバック禁止)
   */
  public static validateSelectionSeed(selectionSeed: unknown): number {
    if (
      typeof selectionSeed !== "number" ||
      !Number.isFinite(selectionSeed) ||
      !Number.isInteger(selectionSeed)
    ) {
      throw new PopulationSelectionConfigurationError(
        `Invalid selectionSeed: must be a finite integer, got ${selectionSeed}`
      );
    }
    return selectionSeed;
  }

  /**
   * 母集団スナップショットおよび適応度評価スナップショットのデータ整合性検証 (Fail-Fast)
   *
   * 違反がある場合は PopulationSelectionIntegrityError をスローする。
   */
  public static validateIntegrity(
    population: PopulationSnapshot,
    fitnessSnapshot: FitnessEvaluationSnapshot
  ): void {
    if (!population || typeof population !== "object") {
      throw new PopulationSelectionIntegrityError(
        "PopulationSnapshot must be a valid non-null object"
      );
    }

    if (!Array.isArray(population.entries)) {
      throw new PopulationSelectionIntegrityError(
        "PopulationSnapshot entries must be an array"
      );
    }

    if (population.entries.length < 2) {
      throw new PopulationSelectionIntegrityError(
        `Population must contain at least 2 entries for sexual reproduction, got ${population.entries.length}`
      );
    }

    if (
      typeof population.generation !== "number" ||
      !Number.isFinite(population.generation) ||
      !Number.isInteger(population.generation) ||
      population.generation < 0
    ) {
      throw new PopulationSelectionIntegrityError(
        `Invalid population generation: must be a non-negative integer, got ${population.generation}`
      );
    }

    if (!fitnessSnapshot || typeof fitnessSnapshot !== "object") {
      throw new PopulationSelectionIntegrityError(
        "FitnessEvaluationSnapshot must be a valid non-null object"
      );
    }

    if (!Array.isArray(fitnessSnapshot.entries)) {
      throw new PopulationSelectionIntegrityError(
        "FitnessEvaluationSnapshot entries must be an array"
      );
    }

    if (population.generation !== fitnessSnapshot.generation) {
      throw new PopulationSelectionIntegrityError(
        `Generation mismatch: population generation is ${population.generation}, but fitnessSnapshot generation is ${fitnessSnapshot.generation}`
      );
    }

    // Population entries 検証
    const popGenomeIds = new Set<string>();
    for (let i = 0; i < population.entries.length; i++) {
      const entry = population.entries[i];
      if (!entry || typeof entry !== "object") {
        throw new PopulationSelectionIntegrityError(
          `Population entry at index ${i} must be a non-null object`
        );
      }
      if (
        typeof entry.genomeId !== "string" ||
        entry.genomeId.trim().length === 0
      ) {
        throw new PopulationSelectionIntegrityError(
          `Population entry at index ${i} has invalid genomeId: must be a non-empty string`
        );
      }
      if (popGenomeIds.has(entry.genomeId)) {
        throw new PopulationSelectionIntegrityError(
          `Duplicate genomeId found in population: '${entry.genomeId}'`
        );
      }
      popGenomeIds.add(entry.genomeId);

      if (
        typeof entry.dnaRef !== "string" ||
        entry.dnaRef.trim().length === 0
      ) {
        throw new PopulationSelectionIntegrityError(
          `Population entry '${entry.genomeId}' has invalid dnaRef: must be a non-empty string`
        );
      }

      if (entry.generation !== population.generation) {
        throw new PopulationSelectionIntegrityError(
          `Population entry '${entry.genomeId}' generation (${entry.generation}) does not match population generation (${population.generation})`
        );
      }

      try {
        DecisionDNACodec.validate(entry.dna);
      } catch (err) {
        throw new PopulationSelectionIntegrityError(
          `Population entry '${entry.genomeId}' has invalid DecisionDNA: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    // Fitness entries 検証
    const fitnessGenomeIds = new Set<string>();
    for (let i = 0; i < fitnessSnapshot.entries.length; i++) {
      const fEntry = fitnessSnapshot.entries[i];
      if (!fEntry || typeof fEntry !== "object") {
        throw new PopulationSelectionIntegrityError(
          `Fitness entry at index ${i} must be a non-null object`
        );
      }
      if (
        typeof fEntry.genomeId !== "string" ||
        fEntry.genomeId.trim().length === 0
      ) {
        throw new PopulationSelectionIntegrityError(
          `Fitness entry at index ${i} has invalid genomeId: must be a non-empty string`
        );
      }
      if (fitnessGenomeIds.has(fEntry.genomeId)) {
        throw new PopulationSelectionIntegrityError(
          `Duplicate genomeId found in fitnessSnapshot: '${fEntry.genomeId}'`
        );
      }
      fitnessGenomeIds.add(fEntry.genomeId);

      if (!fEntry.result || typeof fEntry.result !== "object") {
        throw new PopulationSelectionIntegrityError(
          `Fitness entry '${fEntry.genomeId}' is missing result object`
        );
      }

      const res = fEntry.result;
      if (
        res.status !== "VALID" &&
        res.status !== "INSUFFICIENT_EVIDENCE" &&
        res.status !== "INVALID"
      ) {
        throw new PopulationSelectionIntegrityError(
          `Fitness entry '${fEntry.genomeId}' has unknown status: '${res.status}'`
        );
      }

      if (res.status === "VALID") {
        if (
          typeof res.fitnessScore !== "number" ||
          !Number.isFinite(res.fitnessScore) ||
          res.fitnessScore < 0.0 ||
          res.fitnessScore > 1.0
        ) {
          throw new PopulationSelectionIntegrityError(
            `VALID fitness entry '${fEntry.genomeId}' must have finite fitnessScore in [0.0, 1.0], got ${res.fitnessScore}`
          );
        }
      } else {
        if (res.fitnessScore !== null) {
          throw new PopulationSelectionIntegrityError(
            `${res.status} fitness entry '${fEntry.genomeId}' must have fitnessScore === null, got ${res.fitnessScore}`
          );
        }
      }
    }

    // 1:1 対応関係の完全性検証
    for (const genomeId of popGenomeIds) {
      if (!fitnessGenomeIds.has(genomeId)) {
        throw new PopulationSelectionIntegrityError(
          `Population genomeId '${genomeId}' has no corresponding fitness result in fitnessSnapshot (1:1 mapping violation)`
        );
      }
    }

    for (const genomeId of fitnessGenomeIds) {
      if (!popGenomeIds.has(genomeId)) {
        throw new PopulationSelectionIntegrityError(
          `Fitness result genomeId '${genomeId}' does not exist in population (unexpected extra fitness result)`
        );
      }
    }
  }

  /**
   * Selection Readiness (選択実行可能性) の判定
   *
   * 4値ステータス:
   * - READY: 選択実行可能
   * - REEVALUATION_REQUIRED: VALID 個体数不足
   * - INVALID_POPULATION: 母集団データの構造的不正
   * - INCOMPARABLE_EVALUATION: 評価コンテキスト不一致
   */
  public static assessReadiness(
    population: PopulationSnapshot,
    fitnessSnapshot: FitnessEvaluationSnapshot,
    config?: Partial<PopulationSelectionConfig>,
    expectedContext?: ComparableEvaluationContext
  ): SelectionReadiness {
    const resolvedConfig = PopulationSelector.validateConfig(config);
    const requiredCount = Math.max(
      resolvedConfig.minimumValidPopulationCount,
      resolvedConfig.tournamentSize
    );

    // 1. データ整合性チェック
    try {
      PopulationSelector.validateIntegrity(population, fitnessSnapshot);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Unknown population integrity error";
      return {
        status: "INVALID_POPULATION",
        validCount: 0,
        requiredCount,
        reason,
      };
    }

    // 2. 比較可能性チェック
    if (!fitnessSnapshot.context || typeof fitnessSnapshot.context !== "object") {
      return {
        status: "INCOMPARABLE_EVALUATION",
        validCount: 0,
        requiredCount,
        reason: "FitnessEvaluationSnapshot is missing a valid ComparableEvaluationContext",
      };
    }

    if (
      fitnessSnapshot.context.generation !== fitnessSnapshot.generation ||
      fitnessSnapshot.context.generation !== population.generation
    ) {
      return {
        status: "INCOMPARABLE_EVALUATION",
        validCount: 0,
        requiredCount,
        reason: `ComparableEvaluationContext generation (${fitnessSnapshot.context.generation}) does not match fitnessSnapshot generation (${fitnessSnapshot.generation}) or population generation (${population.generation})`,
      };
    }

    if (
      expectedContext &&
      !isComparableEvaluationContextEqual(fitnessSnapshot.context, expectedContext)
    ) {
      return {
        status: "INCOMPARABLE_EVALUATION",
        validCount: 0,
        requiredCount,
        reason:
          "FitnessEvaluationSnapshot context does not match expected ComparableEvaluationContext",
      };
    }

    for (const entry of fitnessSnapshot.entries) {
      if (
        entry.context &&
        !isComparableEvaluationContextEqual(entry.context, fitnessSnapshot.context)
      ) {
        return {
          status: "INCOMPARABLE_EVALUATION",
          validCount: 0,
          requiredCount,
          reason: `Fitness entry '${entry.genomeId}' has an individual context that conflicts with the snapshot context`,
        };
      }
    }

    // 3. VALID 個体数 & トーナメント実行可能性チェック
    let validCount = 0;
    for (const entry of fitnessSnapshot.entries) {
      if (entry.result.status === "VALID") {
        validCount++;
      }
    }

    if (validCount < requiredCount) {
      return {
        status: "REEVALUATION_REQUIRED",
        validCount,
        requiredCount,
        reason: `Insufficient valid candidates: required at least ${requiredCount} (max of minimumValid=${resolvedConfig.minimumValidPopulationCount}, tournamentSize=${resolvedConfig.tournamentSize}), but got ${validCount}`,
      };
    }

    return {
      status: "READY",
      validCount,
      requiredCount,
    };
  }

  /**
   * Standard Selection Pool の抽出
   *
   * - VALID 個体のみを抽出
   * - fitnessScore = 0.0 も正当な候補として残留
   * - INSUFFICIENT_EVIDENCE (provisionalScore の高低に関わらず) および INVALID は完全除外
   * - 入力配列順バイアスを排除するため、genomeId コードポイント昇順で正規ソート (Canonical Pool Ordering)
   */
  public static getStandardSelectionPool(
    population: PopulationSnapshot,
    fitnessSnapshot: FitnessEvaluationSnapshot
  ): readonly SelectionCandidate[] {
    PopulationSelector.validateIntegrity(population, fitnessSnapshot);

    const fitnessMap = new Map<string, PopulationFitnessEntry>();
    for (const entry of fitnessSnapshot.entries) {
      fitnessMap.set(entry.genomeId, entry);
    }

    const pool: SelectionCandidate[] = [];
    for (const popEntry of population.entries) {
      const fEntry = fitnessMap.get(popEntry.genomeId)!;
      if (fEntry.result.status === "VALID") {
        pool.push({
          genomeId: popEntry.genomeId,
          dnaRef: popEntry.dnaRef,
          generation: popEntry.generation,
          dna: popEntry.dna,
          fitnessScore: fEntry.result.fitnessScore!,
        });
      }
    }

    // Canonical Ordering: genomeId コードポイント順にソートして入力順バイアスを完全に中和
    pool.sort((a, b) =>
      a.genomeId < b.genomeId ? -1 : a.genomeId > b.genomeId ? 1 : 0
    );

    return Object.freeze(pool);
  }

  /**
   * 1 トーナメントの親選択 (内部サンプリング)
   *
   * 規約:
   * - 1 トーナメント内: 非復元抽出 (without replacement, k 体は必ず異なる個体)
   * - 最高スコア個体を勝者とする
   * - 最高スコアが同点 (Tie) の場合: 同点候補群を genomeId 正規ソートした上で PRNG により一様ランダム決定論的タイブレーク
   */
  private static selectParentFromPool(
    pool: readonly SelectionCandidate[],
    tournamentSize: number,
    rng: RandomSource
  ): SelectedParent {
    const N = pool.length;
    if (N < tournamentSize) {
      throw new PopulationSelectionExecutionError(
        `Selection pool size (${N}) is smaller than tournamentSize (${tournamentSize})`,
        "REEVALUATION_REQUIRED"
      );
    }

    // Fisher-Yates による非復元サンプリング (k distinct candidates)
    const indices = Array.from({ length: N }, (_, i) => i);
    const sampledCandidates: SelectionCandidate[] = [];

    for (let i = 0; i < tournamentSize; i++) {
      const j = rng.nextInt(i, N - 1);
      const tmp = indices[i];
      indices[i] = indices[j];
      indices[j] = tmp;
      sampledCandidates.push(pool[indices[i]]);
    }

    // 最高 fitnessScore の探索
    let maxScore = -Infinity;
    for (const candidate of sampledCandidates) {
      if (candidate.fitnessScore > maxScore) {
        maxScore = candidate.fitnessScore;
      }
    }

    // 同点候補の抽出
    const tiedWinners = sampledCandidates.filter(
      (c) => c.fitnessScore === maxScore
    );

    let winner: SelectionCandidate;
    if (tiedWinners.length === 1) {
      winner = tiedWinners[0];
    } else {
      // Seeded Deterministic Tie-Break:
      // 配列順・ID順バイアスを中和するため、genomeId コードポイント順で並べた上で一様抽出
      tiedWinners.sort((a, b) =>
        a.genomeId < b.genomeId ? -1 : a.genomeId > b.genomeId ? 1 : 0
      );
      const tieIndex = rng.nextInt(0, tiedWinners.length - 1);
      winner = tiedWinners[tieIndex];
    }

    return {
      genomeId: winner.genomeId,
      dnaRef: winner.dnaRef,
      generation: winner.generation,
      dna: winner.dna,
      fitnessScore: winner.fitnessScore,
      tournamentCandidates: Object.freeze(
        sampledCandidates.map((c) => c.genomeId)
      ),
    };
  }

  /**
   * 単一親個体のトーナメント選択
   */
  public static selectParent(
    population: PopulationSnapshot,
    fitnessSnapshot: FitnessEvaluationSnapshot,
    config: Partial<PopulationSelectionConfig> | undefined,
    selectionSeed: number,
    expectedContext?: ComparableEvaluationContext
  ): SelectedParent {
    const results = PopulationSelector.selectParents(
      1,
      population,
      fitnessSnapshot,
      config,
      selectionSeed,
      expectedContext
    );
    return results[0];
  }

  /**
   * 複数親個体のトーナメント選択 (決定論的親系列生成)
   *
   * 規約:
   * - 各トーナメントごとに全 Standard Selection Pool からサンプリング (with replacement across tournaments)
   * - 優秀個体は複数回親として選出可能
   */
  public static selectParents(
    count: number,
    population: PopulationSnapshot,
    fitnessSnapshot: FitnessEvaluationSnapshot,
    config: Partial<PopulationSelectionConfig> | undefined,
    selectionSeed: number,
    expectedContext?: ComparableEvaluationContext
  ): readonly SelectedParent[] {
    const validatedSeed = PopulationSelector.validateSelectionSeed(selectionSeed);

    if (
      typeof count !== "number" ||
      !Number.isFinite(count) ||
      !Number.isInteger(count) ||
      count < 1
    ) {
      throw new PopulationSelectionConfigurationError(
        `Selection count must be a positive integer >= 1, got ${count}`
      );
    }

    const resolvedConfig = PopulationSelector.validateConfig(config);
    const readiness = PopulationSelector.assessReadiness(
      population,
      fitnessSnapshot,
      resolvedConfig,
      expectedContext
    );

    if (readiness.status !== "READY") {
      if (readiness.status === "INVALID_POPULATION") {
        throw new PopulationSelectionIntegrityError(
          readiness.reason ?? "Invalid population snapshot"
        );
      }
      throw new PopulationSelectionExecutionError(
        readiness.reason ?? `Selection execution impossible in state ${readiness.status}`,
        readiness.status
      );
    }

    const pool = PopulationSelector.getStandardSelectionPool(
      population,
      fitnessSnapshot
    );

    const rng = new SeededRandom(validatedSeed);
    const selected: SelectedParent[] = [];

    for (let i = 0; i < count; i++) {
      const parent = PopulationSelector.selectParentFromPool(
        pool,
        resolvedConfig.tournamentSize,
        rng
      );
      selected.push(parent);
    }

    return Object.freeze(selected);
  }

  /**
   * エリート個体の選出 (Elite Selection)
   *
   * 規約:
   * - VALID プールの最高適応度個体上位 E 体を無変更で選出
   * - 境界線上で同点 (Tie) が発生した場合、genomeId 正規ソートした上で PRNG による一様ランダム決定論的タイブレーク
   * - 目的は best-known genotype の消失防止 (次世代での measured fitness 単調非減少は保証しない)
   */
  public static selectElites(
    population: PopulationSnapshot,
    fitnessSnapshot: FitnessEvaluationSnapshot,
    config: Partial<PopulationSelectionConfig> | undefined,
    selectionSeed: number,
    expectedContext?: ComparableEvaluationContext
  ): readonly SelectedParent[] {
    const validatedSeed = PopulationSelector.validateSelectionSeed(selectionSeed);
    const resolvedConfig = PopulationSelector.validateConfig(config);
    if (resolvedConfig.eliteCount === 0) {
      return Object.freeze([]);
    }

    const readiness = PopulationSelector.assessReadiness(
      population,
      fitnessSnapshot,
      resolvedConfig,
      expectedContext
    );

    if (readiness.status !== "READY") {
      if (readiness.status === "INVALID_POPULATION") {
        throw new PopulationSelectionIntegrityError(
          readiness.reason ?? "Invalid population snapshot"
        );
      }
      throw new PopulationSelectionExecutionError(
        readiness.reason ?? `Elite selection execution impossible in state ${readiness.status}`,
        readiness.status
      );
    }

    const pool = PopulationSelector.getStandardSelectionPool(
      population,
      fitnessSnapshot
    );

    if (resolvedConfig.eliteCount > pool.length) {
      throw new PopulationSelectionConfigurationError(
        `eliteCount (${resolvedConfig.eliteCount}) cannot exceed valid selection pool size (${pool.length})`
      );
    }

    // スコア降順グループ化
    const scoreMap = new Map<number, SelectionCandidate[]>();
    for (const candidate of pool) {
      let group = scoreMap.get(candidate.fitnessScore);
      if (!group) {
        group = [];
        scoreMap.set(candidate.fitnessScore, group);
      }
      group.push(candidate);
    }

    const descendingScores = Array.from(scoreMap.keys()).sort((a, b) => b - a);
    const rng = new SeededRandom(validatedSeed);
    const elites: SelectedParent[] = [];
    let remainingSlots = resolvedConfig.eliteCount;

    for (const score of descendingScores) {
      const group = scoreMap.get(score)!;
      if (group.length <= remainingSlots) {
        // グループ内を genomeId コードポイント順にソートして確定
        const sorted = [...group].sort((a, b) =>
          a.genomeId < b.genomeId ? -1 : a.genomeId > b.genomeId ? 1 : 0
        );
        for (const candidate of sorted) {
          elites.push({
            genomeId: candidate.genomeId,
            dnaRef: candidate.dnaRef,
            generation: candidate.generation,
            dna: candidate.dna,
            fitnessScore: candidate.fitnessScore,
          });
        }
        remainingSlots -= group.length;
        if (remainingSlots === 0) break;
      } else {
        // 境界タイブレーク: group から remainingSlots 体を PRNG で非復元サンプリング
        const sorted = [...group].sort((a, b) =>
          a.genomeId < b.genomeId ? -1 : a.genomeId > b.genomeId ? 1 : 0
        );
        const indices = Array.from({ length: sorted.length }, (_, i) => i);
        for (let i = 0; i < remainingSlots; i++) {
          const j = rng.nextInt(i, indices.length - 1);
          const tmp = indices[i];
          indices[i] = indices[j];
          indices[j] = tmp;
          const picked = sorted[indices[i]];
          elites.push({
            genomeId: picked.genomeId,
            dnaRef: picked.dnaRef,
            generation: picked.generation,
            dna: picked.dna,
            fitnessScore: picked.fitnessScore,
          });
        }
        remainingSlots = 0;
        break;
      }
    }

    return Object.freeze(elites);
  }

  // --- インスタンスメソッド (インスタンス設定保持用) ---

  public assessReadiness(
    population: PopulationSnapshot,
    fitnessSnapshot: FitnessEvaluationSnapshot,
    expectedContext?: ComparableEvaluationContext
  ): SelectionReadiness {
    return PopulationSelector.assessReadiness(
      population,
      fitnessSnapshot,
      this.config,
      expectedContext
    );
  }

  public getStandardSelectionPool(
    population: PopulationSnapshot,
    fitnessSnapshot: FitnessEvaluationSnapshot
  ): readonly SelectionCandidate[] {
    return PopulationSelector.getStandardSelectionPool(
      population,
      fitnessSnapshot
    );
  }

  public selectParent(
    population: PopulationSnapshot,
    fitnessSnapshot: FitnessEvaluationSnapshot,
    selectionSeed: number,
    expectedContext?: ComparableEvaluationContext
  ): SelectedParent {
    return PopulationSelector.selectParent(
      population,
      fitnessSnapshot,
      this.config,
      selectionSeed,
      expectedContext
    );
  }

  public selectParents(
    count: number,
    population: PopulationSnapshot,
    fitnessSnapshot: FitnessEvaluationSnapshot,
    selectionSeed: number,
    expectedContext?: ComparableEvaluationContext
  ): readonly SelectedParent[] {
    return PopulationSelector.selectParents(
      count,
      population,
      fitnessSnapshot,
      this.config,
      selectionSeed,
      expectedContext
    );
  }

  public selectElites(
    population: PopulationSnapshot,
    fitnessSnapshot: FitnessEvaluationSnapshot,
    selectionSeed: number,
    expectedContext?: ComparableEvaluationContext
  ): readonly SelectedParent[] {
    return PopulationSelector.selectElites(
      population,
      fitnessSnapshot,
      this.config,
      selectionSeed,
      expectedContext
    );
  }
}
