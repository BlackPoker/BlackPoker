/**
 * Gen9LearnableTacticalPolicy.ts
 *
 * BlackPoker Simulator - Gen 9 学習可能戦術評価基盤 (Work 5-2)
 *
 * 【設計目的】
 * 1. 固定ペナルティのハードコード追加方式から脱却し、汎用戦術評価基盤 (TacticalEvaluator) が算出する
 *    6カテゴリの戦術特徴量を独立した特徴量ベクトル (Schema v7 Tactical Extension, 20次元) として符号化。
 * 2. 従来 DNA (Schema v6: 23,738パラメータ) の盤面・文脈評価スコアと、20次元の戦術重みベクトル
 *    (tacticalWeights) による内積スコアを線形統合し、進化学習で戦術重みおよびベース重みを調整可能にする。
 * 3. 既存 Schema v6 DNA との完全互換性・双方向変換を保証:
 *    - tacticalWeights = ZERO_TACTICAL_WEIGHTS のとき、GenomePolicy (Schema v6) とビット単位で完全一致。
 *    - tacticalWeights = R4_PRESET_TACTICAL_WEIGHTS のとき、Gen9TacticalPrototypePolicy (Work 5-1 R4) と完全一致。
 *    - metadata.gen9TacticalWeights を介して既存の DecisionDNA (Schema v6) JSON フォーマットへ無損失格納可能。
 * 4. DecisionPolicy アーキテクチャ境界の厳格遵守:
 *    - RulePackage / GameState / GameSession への直接参照は一切持たず、Readonly<DecisionRequest> と
 *      注入された TacticalEvaluator インターフェースのみを参照する。
 */

import { DecisionPolicy, PolicyDescriptor } from "../simulation/DecisionPolicy.js";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../../domain/decision/DecisionResponse.js";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes.js";
import { DecisionDNACodec } from "./DecisionDNACodec.js";
import { DecisionFeatureEncoder } from "./DecisionFeatureEncoder.js";
import { GenomeScorer } from "./GenomeScorer.js";
import { LegalPattern } from "../../domain/decision/LegalPattern.js";
import { UnitView, PlayerObservationView } from "../../domain/decision/PlayerObservation.js";
import { TacticalEvaluator } from "../../domain/decision/TacticalEvaluationTypes.js";
import { Gen9TacticalPrototypePolicy } from "./Gen9TacticalPrototypePolicy.js";

export const TACTICAL_FEATURE_SCHEMA_VERSION = 7;

/**
 * 独立評価可能な6つの戦術特徴量カテゴリ
 */
export type TacticalFeatureCategory =
  | "CERTAIN_DAMAGE"
  | "ESTIMATED_DAMAGE"
  | "COUNTER_PREVENTION"
  | "COMBAT_OUTCOME"
  | "SURVIVAL"
  | "LETHAL_OPPORTUNITY";

/**
 * Gen 9 学習可能戦術特徴量名リスト (全20次元)
 */
export const TACTICAL_FEATURE_NAMES = [
  // Category 1: DSLから計算した確定損害 (CERTAIN_DAMAGE)
  "t00_pass_certain_lethal",
  "t01_pass_certain_severe_ratio",
  "t02_pass_certain_moderate",

  // Category 2: 非公開情報を考慮した推定損害 (ESTIMATED_DAMAGE)
  "t03_pass_estimated_lethal_risk",
  "t04_pass_estimated_severe_ratio",
  "t05_pass_estimated_moderate",

  // Category 3: リクエスト打ち消しによる損害阻止 (COUNTER_PREVENTION)
  "t06_counter_certain_lethal_prevent",
  "t07_counter_estimated_lethal_prevent",
  "t08_counter_damage_prevent_scaled",
  "t09_counter_uncertain_cancel",

  // Category 4: 攻撃・ブロックの戦闘損害 (COMBAT_OUTCOME)
  "t10_attack_unblocked_nonlethal",
  "t11_attack_numerical_advantage",
  "t12_attack_favorable_or_equal_trade",
  "t13_attack_suicide_scaled",
  "t14_block_trade_advantage",
  "t15_block_unblocked_lethal",
  "t16_block_unblocked_danger_ratio",

  // Category 5: 生存可能性 (SURVIVAL)
  "t17_survival_critical_life_board_build",

  // Category 6: 攻撃機会・リーサル完遂 (LETHAL_OPPORTUNITY)
  "t18_attack_unblocked_lethal",
  "t19_attack_breakthrough_lethal",
] as const;

export type TacticalFeatureName = (typeof TACTICAL_FEATURE_NAMES)[number];

export const TACTICAL_FEATURE_DIMENSION: number = TACTICAL_FEATURE_NAMES.length;

/**
 * 各戦術特徴量の所属カテゴリ定義
 */
export const TACTICAL_FEATURE_CATEGORY_MAP: Readonly<Record<TacticalFeatureName, TacticalFeatureCategory>> = {
  t00_pass_certain_lethal: "CERTAIN_DAMAGE",
  t01_pass_certain_severe_ratio: "CERTAIN_DAMAGE",
  t02_pass_certain_moderate: "CERTAIN_DAMAGE",

  t03_pass_estimated_lethal_risk: "ESTIMATED_DAMAGE",
  t04_pass_estimated_severe_ratio: "ESTIMATED_DAMAGE",
  t05_pass_estimated_moderate: "ESTIMATED_DAMAGE",

  t06_counter_certain_lethal_prevent: "COUNTER_PREVENTION",
  t07_counter_estimated_lethal_prevent: "COUNTER_PREVENTION",
  t08_counter_damage_prevent_scaled: "COUNTER_PREVENTION",
  t09_counter_uncertain_cancel: "COUNTER_PREVENTION",

  t10_attack_unblocked_nonlethal: "COMBAT_OUTCOME",
  t11_attack_numerical_advantage: "COMBAT_OUTCOME",
  t12_attack_favorable_or_equal_trade: "COMBAT_OUTCOME",
  t13_attack_suicide_scaled: "COMBAT_OUTCOME",
  t14_block_trade_advantage: "COMBAT_OUTCOME",
  t15_block_unblocked_lethal: "COMBAT_OUTCOME",
  t16_block_unblocked_danger_ratio: "COMBAT_OUTCOME",

  t17_survival_critical_life_board_build: "SURVIVAL",

  t18_attack_unblocked_lethal: "LETHAL_OPPORTUNITY",
  t19_attack_breakthrough_lethal: "LETHAL_OPPORTUNITY",
};

/**
 * ゼロ戦術重みベクトル（純粋な Schema v6 GenomePolicy と完全一致）
 */
export const ZERO_TACTICAL_WEIGHTS: readonly number[] = Object.freeze(
  new Array(TACTICAL_FEATURE_DIMENSION).fill(0)
);

/**
 * Work 5-1 R4 プリセット戦術重みベクトル（Gen9TacticalPrototypePolicy と完全一致）
 */
export const R4_PRESET_TACTICAL_WEIGHTS: readonly number[] = Object.freeze([
  -2.5,  // t00_pass_certain_lethal
  -0.8,  // t01_pass_certain_severe_ratio
  -0.35, // t02_pass_certain_moderate
  -1.8,  // t03_pass_estimated_lethal_risk
  -0.5,  // t04_pass_estimated_severe_ratio
  -0.25, // t05_pass_estimated_moderate
  +2.2,  // t06_counter_certain_lethal_prevent
  +1.8,  // t07_counter_estimated_lethal_prevent
  +1.0,  // t08_counter_damage_prevent_scaled
  +0.2,  // t09_counter_uncertain_cancel
  +0.2,  // t10_attack_unblocked_nonlethal
  +0.25, // t11_attack_numerical_advantage
  +0.05, // t12_attack_favorable_or_equal_trade
  -0.35, // t13_attack_suicide_scaled
  +0.2,  // t14_block_trade_advantage
  -2.5,  // t15_block_unblocked_lethal
  -0.5,  // t16_block_unblocked_danger_ratio
  +0.1,  // t17_survival_critical_life_board_build
  +2.0,  // t18_attack_unblocked_lethal
  +2.5,  // t19_attack_breakthrough_lethal
]);

/**
 * 個体の由来区分 (Work 5-2 R2)
 * - HAND_DESIGNED_G0: G0 で人手設計された初期重み個体
 * - EVOLVED_OFFSPRING: G1 以降に親個体の交叉・突然変異によって生成された進化個体
 * - V6_BASELINE: 戦術重みゼロの既存 Schema v6 ベースライン個体
 */
export type TacticalGenomeOriginType =
  | "HAND_DESIGNED_G0"
  | "EVOLVED_OFFSPRING"
  | "V6_BASELINE";

/**
 * Gen 9 戦術統合 Genome 構造 (Schema v7 Tactical Extension)
 */
export interface Gen9TacticalGenome {
  readonly tacticalSchemaVersion: typeof TACTICAL_FEATURE_SCHEMA_VERSION;
  readonly baseDNA: DecisionDNA;
  readonly tacticalWeights: readonly number[];
  readonly metadata?: {
    readonly id?: string;
    readonly name?: string;
    readonly generation?: number;
    readonly createdGeneration?: number;
    readonly originType?: TacticalGenomeOriginType;
    readonly parentIds?: readonly string[];
    readonly notes?: string;
  };
}

/**
 * G1以降に交叉・突然変異で生成された進化個体であるかを厳格判定
 */
export function isEvolvedOffspring(genome: Readonly<Gen9TacticalGenome>): boolean {
  const meta = genome.metadata;
  if (!meta) return false;
  const createdGen = meta.createdGeneration ?? meta.generation ?? 0;
  return (
    meta.originType === "EVOLVED_OFFSPRING" &&
    createdGen >= 1 &&
    Array.isArray(meta.parentIds) &&
    meta.parentIds.length >= 1
  );
}

/**
 * G0で人手設計された初期重み個体であるかを厳格判定
 */
export function isHandDesignedG0(genome: Readonly<Gen9TacticalGenome>): boolean {
  const meta = genome.metadata;
  if (!meta) return false;
  const createdGen = meta.createdGeneration ?? meta.generation ?? 0;
  return meta.originType === "HAND_DESIGNED_G0" && createdGen === 0;
}

/**
 * パターン別の独立カテゴリ評価内訳
 */
export interface TacticalCategoryBreakdown {
  readonly baseDNAScore: number;
  readonly CERTAIN_DAMAGE: number;
  readonly ESTIMATED_DAMAGE: number;
  readonly COUNTER_PREVENTION: number;
  readonly COMBAT_OUTCOME: number;
  readonly SURVIVAL: number;
  readonly LETHAL_OPPORTUNITY: number;
  readonly totalTacticalScore: number;
  readonly finalScore: number;
}

export interface LearnableTacticalEvaluationDetail {
  readonly patternRef: number;
  readonly baseScore: number;
  readonly tacticalAdjustment: number;
  readonly finalScore: number;
  readonly tacticalFeatures: readonly number[];
  readonly categoryBreakdown: TacticalCategoryBreakdown;
  readonly reason?: string;
}

export interface LearnableTacticalEvaluationResult {
  readonly scoredPatterns: readonly LearnableTacticalEvaluationDetail[];
  readonly bestPatternRef: number;
}

/**
 * 既存 Schema v6 DecisionDNA から Gen9TacticalGenome への明示的変換
 */
export function fromV6DNA(
  dna: Readonly<DecisionDNA>,
  preset: "zero" | "r4" | readonly number[] = "r4",
  metadata?: Gen9TacticalGenome["metadata"]
): Gen9TacticalGenome {
  DecisionDNACodec.validate(dna);
  let weights: number[];
  if (preset === "zero") {
    weights = [...ZERO_TACTICAL_WEIGHTS];
  } else if (preset === "r4") {
    weights = [...R4_PRESET_TACTICAL_WEIGHTS];
  } else {
    if (preset.length !== TACTICAL_FEATURE_DIMENSION) {
      throw new Error(
        `tacticalWeights の次元数が不正です: expected=${TACTICAL_FEATURE_DIMENSION}, actual=${preset.length}`
      );
    }
    weights = [...preset];
  }

  const defaultOrigin: TacticalGenomeOriginType =
    preset === "zero" ? "V6_BASELINE" : "HAND_DESIGNED_G0";

  const defaultMeta: Record<string, any> = {
    id: dna.metadata?.id ? `${dna.metadata.id}-tactical-v7` : "gen9-tactical-v7",
    name: dna.metadata?.name ? `${dna.metadata.name} (Tactical v7)` : "Gen9TacticalGenome",
    generation: dna.metadata?.generation ?? 0,
    createdGeneration: 0,
    originType: defaultOrigin,
  };
  if (dna.metadata?.id) {
    defaultMeta.parentIds = [dna.metadata.id];
  }

  let cleanMeta: Gen9TacticalGenome["metadata"] | undefined;
  if (metadata) {
    const m: Record<string, any> = {};
    if (metadata.id !== undefined) m.id = metadata.id;
    if (metadata.name !== undefined) m.name = metadata.name;
    if (metadata.generation !== undefined) m.generation = metadata.generation;
    if (metadata.createdGeneration !== undefined) {
      m.createdGeneration = metadata.createdGeneration;
    } else if (metadata.generation !== undefined) {
      m.createdGeneration = metadata.generation;
    }
    if (metadata.originType !== undefined) {
      m.originType = metadata.originType;
    } else {
      m.originType =
        (m.createdGeneration ?? 0) >= 1
          ? "EVOLVED_OFFSPRING"
          : preset === "zero"
            ? "V6_BASELINE"
            : "HAND_DESIGNED_G0";
    }
    if (metadata.parentIds !== undefined) m.parentIds = [...metadata.parentIds];
    if (metadata.notes !== undefined) m.notes = metadata.notes;
    cleanMeta = m;
  } else {
    cleanMeta = defaultMeta;
  }

  return {
    tacticalSchemaVersion: TACTICAL_FEATURE_SCHEMA_VERSION,
    baseDNA: DecisionDNACodec.clone(dna),
    tacticalWeights: weights,
    metadata: cleanMeta,
  };
}

/**
 * Gen9TacticalGenome を既存 Schema v6 互換の DecisionDNA に変換
 * - DecisionDNACodec.validate() をそのまま通過可能
 */
export function toV6CompatibleDNA(genome: Readonly<Gen9TacticalGenome>): DecisionDNA {
  const cloned = DecisionDNACodec.clone(genome.baseDNA);
  const meta: Record<string, any> = {
    ...cloned.metadata,
    notes: JSON.stringify({
      tacticalSchemaVersion: genome.tacticalSchemaVersion,
      tacticalWeights: [...genome.tacticalWeights],
      originType: genome.metadata?.originType,
      createdGeneration: genome.metadata?.createdGeneration ?? genome.metadata?.generation,
      userNotes: genome.metadata?.notes ?? cloned.metadata?.notes,
    }),
  };
  const resolvedId = genome.metadata?.id ?? cloned.metadata?.id;
  if (resolvedId !== undefined) meta.id = resolvedId;

  const resolvedName = genome.metadata?.name ?? cloned.metadata?.name;
  if (resolvedName !== undefined) meta.name = resolvedName;

  const resolvedGen = genome.metadata?.generation ?? cloned.metadata?.generation;
  if (resolvedGen !== undefined) meta.generation = resolvedGen;

  const resolvedParents = genome.metadata?.parentIds ?? cloned.metadata?.parentIds;
  if (Array.isArray(resolvedParents)) {
    meta.parentIds = resolvedParents.filter((x): x is string => typeof x === "string");
  }

  return {
    ...cloned,
    metadata: meta,
  };
}

/**
 * Schema v6 互換 DecisionDNA から Gen9TacticalGenome を復元
 */
export function fromV6CompatibleDNA(
  dna: Readonly<DecisionDNA>,
  fallbackPreset: "zero" | "r4" = "r4"
): Gen9TacticalGenome {
  DecisionDNACodec.validate(dna);
  if (typeof dna.metadata?.notes === "string") {
    try {
      const parsed = JSON.parse(dna.metadata.notes);
      if (
        parsed &&
        Array.isArray(parsed.tacticalWeights) &&
        parsed.tacticalWeights.length === TACTICAL_FEATURE_DIMENSION
      ) {
        const rawParents = dna.metadata.parentIds;
        const parentIds = Array.isArray(rawParents)
          ? rawParents.filter((x): x is string => typeof x === "string")
          : undefined;
        return fromV6DNA(dna, parsed.tacticalWeights, {
          id: typeof dna.metadata.id === "string" ? dna.metadata.id : undefined,
          name: typeof dna.metadata.name === "string" ? dna.metadata.name : undefined,
          generation: typeof dna.metadata.generation === "number" ? dna.metadata.generation : undefined,
          createdGeneration:
            typeof parsed.createdGeneration === "number" ? parsed.createdGeneration : undefined,
          originType:
            parsed.originType === "HAND_DESIGNED_G0" ||
            parsed.originType === "EVOLVED_OFFSPRING" ||
            parsed.originType === "V6_BASELINE"
              ? parsed.originType
              : undefined,
          parentIds,
          notes: typeof parsed.userNotes === "string" ? parsed.userNotes : undefined,
        });
      }
    } catch {
      // 通常文字列の notes の場合はフォールバックを使用
    }
  }
  return fromV6DNA(dna, fallbackPreset);
}

/**
 * Gen9TacticalGenome のディープクローン
 */
export function cloneTacticalGenome(genome: Readonly<Gen9TacticalGenome>): Gen9TacticalGenome {
  let cleanMeta: Gen9TacticalGenome["metadata"] | undefined;
  if (genome.metadata) {
    const m: Record<string, any> = {};
    if (genome.metadata.id !== undefined) m.id = genome.metadata.id;
    if (genome.metadata.name !== undefined) m.name = genome.metadata.name;
    if (genome.metadata.generation !== undefined) m.generation = genome.metadata.generation;
    if (genome.metadata.createdGeneration !== undefined)
      m.createdGeneration = genome.metadata.createdGeneration;
    if (genome.metadata.originType !== undefined) m.originType = genome.metadata.originType;
    if (genome.metadata.parentIds !== undefined) m.parentIds = [...genome.metadata.parentIds];
    if (genome.metadata.notes !== undefined) m.notes = genome.metadata.notes;
    cleanMeta = m;
  }
  return {
    tacticalSchemaVersion: TACTICAL_FEATURE_SCHEMA_VERSION,
    baseDNA: DecisionDNACodec.clone(genome.baseDNA),
    tacticalWeights: [...genome.tacticalWeights],
    metadata: cleanMeta,
  };
}

/**
 * 単一パターンの戦術特徴量ベクトル (20次元) をエンコード
 */
export function encodeTacticalPatternFeatures(
  request: Readonly<DecisionRequest>,
  pattern: Readonly<LegalPattern>,
  tacticalEvaluator?: TacticalEvaluator
): { features: Float64Array; reasons: string[] } {
  const features = new Float64Array(TACTICAL_FEATURE_DIMENSION);
  const reasons: string[] = [];

  const obs = request.observation;
  const selfKey = request.playerId;
  const selfView = obs.players.find((p) => p.playerId === selfKey) ?? obs.players.find((p) => p.isViewer);
  const oppView = obs.players.find((p) => p.playerId !== selfKey) ?? obs.players.find((p) => !p.isViewer);
  const selfLife = selfView?.lifeCount ?? 15;

  // ===========================================================================
  // カテゴリ 1, 2, 3: リクエスト確定損害 / 推定損害 / 打ち消しによる損害阻止
  // ===========================================================================
  const stageRequests = obs.stageRequests ?? [];
  const oppRequests = stageRequests.filter((r) => r.controller !== selfKey);

  if (oppRequests.length > 0 && tacticalEvaluator) {
    const primaryOppReq = oppRequests[oppRequests.length - 1];
    const reqOutcome = tacticalEvaluator.evaluateRequestOutcome(primaryOppReq, selfKey, obs);

    if (!reqOutcome.isGuardedOut) {
      const netDmg = reqOutcome.netDamageToSelf;

      if (pattern.kind === "PASS") {
        if (reqOutcome.certainty === "CERTAIN") {
          // Category 1: DSLから計算した確定損害
          if (netDmg.min >= selfLife && selfLife > 0) {
            features[0] = 1.0; // t00_pass_certain_lethal
            reasons.push(`t00_pass_certain_lethal=1.0 (dmg=${netDmg.min}>=life=${selfLife})`);
          } else if (selfLife - netDmg.expected <= 4) {
            const ratio = netDmg.expected / Math.max(1, selfLife);
            features[1] = ratio; // t01_pass_certain_severe_ratio
            reasons.push(`t01_pass_certain_severe_ratio=${ratio.toFixed(2)}`);
          } else if (netDmg.expected >= 5) {
            features[2] = 1.0; // t02_pass_certain_moderate
            reasons.push(`t02_pass_certain_moderate=1.0 (dmg=${netDmg.expected})`);
          }
        } else if (reqOutcome.certainty === "ESTIMATED") {
          // Category 2: 非公開情報を考慮した推定損害
          if (netDmg.max >= selfLife && selfLife > 0) {
            const riskPenalty = Math.min(1.8, 0.8 + 0.8 * (netDmg.expected / Math.max(1, selfLife)));
            features[3] = riskPenalty / 1.8; // t03_pass_estimated_lethal_risk (R4 weight -1.8 で -riskPenalty を再現)
            reasons.push(`t03_pass_estimated_lethal_risk=${features[3].toFixed(2)} (max=${netDmg.max}>=life=${selfLife})`);
          } else if (selfLife - netDmg.expected <= 4) {
            const ratio = netDmg.expected / Math.max(1, selfLife);
            features[4] = ratio; // t04_pass_estimated_severe_ratio
            reasons.push(`t04_pass_estimated_severe_ratio=${ratio.toFixed(2)}`);
          } else if (netDmg.expected >= 5) {
            features[5] = 1.0; // t05_pass_estimated_moderate
            reasons.push(`t05_pass_estimated_moderate=1.0 (expected=${netDmg.expected})`);
          }
        }
      }

      // Category 3: リクエスト打ち消しによる損害阻止
      const counterOutcome = tacticalEvaluator.evaluateCounterOutcome(
        pattern,
        primaryOppReq,
        request,
        reqOutcome
      );
      if (counterOutcome.cancelStatus === "CERTAIN_CANCEL" && !counterOutcome.preventedDamageToSelf.isUnknown) {
        const prevented = counterOutcome.preventedDamageToSelf;
        if (prevented.isCertain && prevented.min >= selfLife && selfLife > 0) {
          features[6] = 1.0; // t06_counter_certain_lethal_prevent
          reasons.push(`t06_counter_certain_lethal_prevent=1.0 (prevents=${prevented.min})`);
        } else if (!prevented.isCertain && prevented.max >= selfLife && selfLife > 0) {
          features[7] = 1.0; // t07_counter_estimated_lethal_prevent
          reasons.push(`t07_counter_estimated_lethal_prevent=1.0 (preventsMax=${prevented.max})`);
        } else if (prevented.expected >= 4) {
          const scaled = Math.min(1.0, 0.3 + 0.08 * prevented.expected);
          features[8] = scaled; // t08_counter_damage_prevent_scaled
          reasons.push(`t08_counter_damage_prevent_scaled=${scaled.toFixed(2)}`);
        }
      } else if (counterOutcome.cancelStatus === "UNCERTAIN_CANCEL" && !counterOutcome.preventedDamageToSelf.isUnknown) {
        features[9] = 1.0; // t09_counter_uncertain_cancel
        reasons.push(`t09_counter_uncertain_cancel=1.0`);
      }
    }
  }

  // ===========================================================================
  // カテゴリ 4 & 6: 攻撃の戦闘損害・数的優位・リーサル機会
  // ===========================================================================
  const act =
    pattern.actionSelectionRef !== undefined
      ? request.catalog.actions[pattern.actionSelectionRef]
      : undefined;

  if (act && act.actionId === "action.attack") {
    const oppUnits = oppView?.field ?? [];
    const oppTrumps = oppView?.trumps ?? [];
    const oppLife = oppView?.lifeCount ?? 15;

    const activeBlockers = [...oppUnits, ...oppTrumps].filter(
      (u) => u.state === "charge" && (u.currentSize ?? 0) > 0
    );
    const myAttackers = (selfView?.field ?? []).filter(
      (u) => u.state === "charge" && u.kind !== "bulwark" && (u.currentSize ?? 0) > 0
    );

    if (myAttackers.length > 0) {
      const totalAtk = myAttackers.reduce((sum, u) => sum + (u.currentSize ?? 0), 0);

      if (activeBlockers.length === 0) {
        if (totalAtk >= oppLife) {
          features[18] = 1.0; // t18_attack_unblocked_lethal
          reasons.push(`t18_attack_unblocked_lethal=1.0 (totalAtk=${totalAtk}>=oppLife=${oppLife})`);
        } else {
          features[10] = 1.0; // t10_attack_unblocked_nonlethal
          reasons.push(`t10_attack_unblocked_nonlethal=1.0`);
        }
      } else if (myAttackers.length > activeBlockers.length) {
        const sortedAttackers = [...myAttackers].sort((a, b) => (a.currentSize ?? 0) - (b.currentSize ?? 0));
        const unblockedCount = myAttackers.length - activeBlockers.length;
        const minBreakthrough = sortedAttackers
          .slice(0, unblockedCount)
          .reduce((sum, u) => sum + (u.currentSize ?? 0), 0);

        if (minBreakthrough >= oppLife) {
          features[19] = 1.0; // t19_attack_breakthrough_lethal
          reasons.push(`t19_attack_breakthrough_lethal=1.0 (minBreak=${minBreakthrough}>=oppLife=${oppLife})`);
        } else {
          features[11] = 1.0; // t11_attack_numerical_advantage
          reasons.push(`t11_attack_numerical_advantage=1.0 (${myAttackers.length}>${activeBlockers.length})`);
        }
      } else {
        const maxMyAtk = myAttackers.reduce((max, u) => Math.max(max, u.currentSize ?? 0), 0);
        const minOppBlk = activeBlockers.reduce((min, u) => Math.min(min, u.currentSize ?? 0), Infinity);

        if (maxMyAtk >= minOppBlk) {
          features[12] = 1.0; // t12_attack_favorable_or_equal_trade
          reasons.push(`t12_attack_favorable_or_equal_trade=1.0 (maxMyAtk=${maxMyAtk}>=minOppBlk=${minOppBlk})`);
        } else {
          const penalty = Math.min(0.35, 0.1 + 0.04 * (minOppBlk - maxMyAtk));
          features[13] = penalty / 0.35; // t13_attack_suicide_scaled (R4 weight -0.35 で -penalty を再現)
          reasons.push(`t13_attack_suicide_scaled=${features[13].toFixed(2)}`);
        }
      }
    }
  }

  // ===========================================================================
  // カテゴリ 5: 生存可能性と盤面リソース管理
  // ===========================================================================
  if (selfLife <= 6) {
    if (act && (act.actionId === "action.summonSoldier" || act.actionId === "action.addBulwark")) {
      features[17] = 1.0; // t17_survival_critical_life_board_build
      reasons.push(`t17_survival_critical_life_board_build=1.0`);
    }
  }

  return { features, reasons };
}

/**
 * ストリーミングブロック割り当ての戦術特徴量 (t14, t15, t16) を O(1) メモリで計算
 */
export interface StreamingBlockAssignmentEntry {
  readonly sourceUnitId?: string;
  readonly selectedUnitIds?: readonly string[];
}

export function computeStreamingBlockTacticalScore(
  assignments: readonly StreamingBlockAssignmentEntry[],
  myUnitsMap: ReadonlyMap<string, UnitView>,
  oppAttackersMap: ReadonlyMap<string, UnitView>,
  selfLife: number,
  tacticalWeights: readonly number[]
): number {
  let tradeAdvantageUnits = 0; // R4 weight +0.2 に対して +1.0 = +0.2, +0.5 = +0.1, -0.75 = -0.15
  const blockedAttackerIds = new Set<string>();

  for (const assign of assignments) {
    const attackerUnitId = assign.sourceUnitId;
    const blockerUnitIds = assign.selectedUnitIds ?? [];
    if (!attackerUnitId || blockerUnitIds.length === 0) continue;

    blockedAttackerIds.add(attackerUnitId);
    const atk = oppAttackersMap.get(attackerUnitId);
    const atkSize = atk?.currentSize ?? 0;

    for (const blockerUnitId of blockerUnitIds) {
      const blk = myUnitsMap.get(blockerUnitId);
      const blkSize = blk?.currentSize ?? 0;

      if (blkSize > atkSize) {
        tradeAdvantageUnits += 1.0;
      } else if (blkSize === atkSize && blkSize > 0) {
        tradeAdvantageUnits += 0.5;
      } else if (blkSize < atkSize) {
        if (selfLife > 8 && blkSize >= 5) {
          tradeAdvantageUnits -= 0.75;
        }
      }
    }
  }

  let unblockedDamage = 0;
  for (const [atkId, atk] of oppAttackersMap.entries()) {
    if (!blockedAttackerIds.has(atkId)) {
      unblockedDamage += atk.currentSize ?? 0;
    }
  }

  let f15Lethal = 0;
  let f16DangerRatio = 0;
  if (unblockedDamage >= selfLife && selfLife > 0) {
    f15Lethal = 1.0;
  } else if (selfLife - unblockedDamage <= 3) {
    f16DangerRatio = unblockedDamage / Math.max(1, selfLife);
  }

  return (
    tacticalWeights[14] * tradeAdvantageUnits +
    tacticalWeights[15] * f15Lethal +
    tacticalWeights[16] * f16DangerRatio
  );
}

/**
 * 特徴量ベクトルと戦術重みベクトルからカテゴリ別スコア内訳を計算
 */
export function computeCategoryBreakdown(
  baseScore: number,
  features: Float64Array | readonly number[],
  tacticalWeights: readonly number[]
): TacticalCategoryBreakdown {
  let CERTAIN_DAMAGE = 0;
  let ESTIMATED_DAMAGE = 0;
  let COUNTER_PREVENTION = 0;
  let COMBAT_OUTCOME = 0;
  let SURVIVAL = 0;
  let LETHAL_OPPORTUNITY = 0;

  for (let k = 0; k < TACTICAL_FEATURE_DIMENSION; k++) {
    const contrib = features[k] * tacticalWeights[k];
    if (contrib === 0) continue;
    const name = TACTICAL_FEATURE_NAMES[k];
    const cat = TACTICAL_FEATURE_CATEGORY_MAP[name];
    switch (cat) {
      case "CERTAIN_DAMAGE":
        CERTAIN_DAMAGE += contrib;
        break;
      case "ESTIMATED_DAMAGE":
        ESTIMATED_DAMAGE += contrib;
        break;
      case "COUNTER_PREVENTION":
        COUNTER_PREVENTION += contrib;
        break;
      case "COMBAT_OUTCOME":
        COMBAT_OUTCOME += contrib;
        break;
      case "SURVIVAL":
        SURVIVAL += contrib;
        break;
      case "LETHAL_OPPORTUNITY":
        LETHAL_OPPORTUNITY += contrib;
        break;
    }
  }

  const totalTacticalScore =
    CERTAIN_DAMAGE +
    ESTIMATED_DAMAGE +
    COUNTER_PREVENTION +
    COMBAT_OUTCOME +
    SURVIVAL +
    LETHAL_OPPORTUNITY;

  return {
    baseDNAScore: baseScore,
    CERTAIN_DAMAGE,
    ESTIMATED_DAMAGE,
    COUNTER_PREVENTION,
    COMBAT_OUTCOME,
    SURVIVAL,
    LETHAL_OPPORTUNITY,
    totalTacticalScore,
    finalScore: baseScore + totalTacticalScore,
  };
}

/**
 * Gen 9 学習可能戦術 Policy
 */
export class Gen9LearnableTacticalPolicy implements DecisionPolicy {
  public readonly descriptor: PolicyDescriptor;
  private readonly genome: Gen9TacticalGenome;
  private readonly tacticalEvaluator?: TacticalEvaluator;

  constructor(
    genomeOrDNA: Readonly<Gen9TacticalGenome> | Readonly<DecisionDNA>,
    name?: string,
    evaluator?: TacticalEvaluator
  ) {
    if ("tacticalSchemaVersion" in genomeOrDNA) {
      DecisionDNACodec.validate(genomeOrDNA.baseDNA);
      if (genomeOrDNA.tacticalWeights.length !== TACTICAL_FEATURE_DIMENSION) {
        throw new Error(
          `tacticalWeights の次元数が不正です: expected=${TACTICAL_FEATURE_DIMENSION}, actual=${genomeOrDNA.tacticalWeights.length}`
        );
      }
      this.genome = cloneTacticalGenome(genomeOrDNA);
    } else {
      this.genome = fromV6CompatibleDNA(genomeOrDNA, "r4");
    }

    this.tacticalEvaluator = evaluator ?? Gen9TacticalPrototypePolicy.getDefaultEvaluator();

    this.descriptor = {
      kind: "genome",
      policyVersion: 9,
      name: name ?? "Gen9LearnableTacticalPolicy",
      metadata: {
        dnaFormatVersion: this.genome.baseDNA.dnaFormatVersion,
        featureSchemaVersion: this.genome.baseDNA.featureSchemaVersion,
        tacticalSchemaVersion: this.genome.tacticalSchemaVersion,
        scoringModel: "linear_interaction_v6_plus_learnable_tactical_v7",
        dnaId: this.genome.metadata?.id ?? this.genome.baseDNA.metadata?.id,
        dnaName: this.genome.metadata?.name ?? this.genome.baseDNA.metadata?.name,
      },
    };
  }

  public getGenome(): Gen9TacticalGenome {
    return cloneTacticalGenome(this.genome);
  }

  public getTacticalWeights(): readonly number[] {
    return [...this.genome.tacticalWeights];
  }

  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    if (
      request.blockAssignmentStream &&
      (request.patterns.length === 0 || request.blockAssignmentStream.patternCount > 256)
    ) {
      return this.chooseStreamingWithLearnableTactics(request);
    }

    const patterns = request.patterns;
    if (!patterns || patterns.length === 0) {
      throw new Error(`DecisionRequest に選択可能なパターンが存在しません: ${request.decisionId}`);
    }

    const evaluation = this.evaluatePatterns(request);

    return {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: evaluation.bestPatternRef,
    };
  }

  private chooseStreamingWithLearnableTactics(request: Readonly<DecisionRequest>): DecisionResponse {
    const stream = request.blockAssignmentStream!;
    if (stream.patternCount === 0) {
      throw new Error(`DecisionRequest に選択可能なパターンが存在しません: ${request.decisionId}`);
    }

    const obs = request.observation;
    const selfKey = request.playerId;
    const selfView = obs.players.find((p) => p.playerId === selfKey) ?? obs.players.find((p) => p.isViewer);
    const oppView = obs.players.find((p) => p.playerId !== selfKey) ?? obs.players.find((p) => !p.isViewer);
    const selfLife = selfView?.lifeCount ?? 15;

    const myUnitsMap = new Map<string, UnitView>();
    for (const u of selfView?.field ?? []) myUnitsMap.set(u.unitId, u);
    for (const u of selfView?.trumps ?? []) myUnitsMap.set(u.unitId, u);

    const oppAttackersMap = new Map<string, UnitView>();
    for (const u of oppView?.field ?? []) {
      if (u.battle?.role === "attacker") oppAttackersMap.set(u.unitId, u);
    }

    const contextValues = DecisionFeatureEncoder.encodeContextOnly(request);
    const encoderContext = DecisionFeatureEncoder.createBlockAssignmentEncoderContext(request);
    const weights = this.genome.tacticalWeights;
    const hasBlockTacticalWeights =
      weights[14] !== 0 || weights[15] !== 0 || weights[16] !== 0;

    let bestScore = -Infinity;
    let bestIndex = 0;
    let currentIndex = 0;

    for (const assignments of stream.iterateAssignments()) {
      const pValues = DecisionFeatureEncoder.encodeBlockAssignmentValues(
        assignments,
        stream.candidateCount,
        encoderContext
      );
      const baseScore = GenomeScorer.scoreSinglePattern(contextValues, pValues, this.genome.baseDNA);

      const tacticalAdj = hasBlockTacticalWeights
        ? computeStreamingBlockTacticalScore(
            assignments,
            myUnitsMap,
            oppAttackersMap,
            selfLife,
            weights
          )
        : 0;

      const finalScore = baseScore + tacticalAdj;
      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestIndex = currentIndex;
      }
      currentIndex++;
    }

    return {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: bestIndex,
    };
  }

  /**
   * 各合法パターンのベーススコア・20次元戦術特徴量・6カテゴリ別寄与度を算出し、最善手を選択
   */
  public evaluatePatterns(request: Readonly<DecisionRequest>): LearnableTacticalEvaluationResult {
    const encodedFeatures = DecisionFeatureEncoder.encode(request);
    const baseScored = GenomeScorer.score(encodedFeatures, this.genome.baseDNA);

    const patterns = request.patterns;
    const details: LearnableTacticalEvaluationDetail[] = [];
    const weights = this.genome.tacticalWeights;

    let bestScore = -Infinity;
    let bestPatternRef = baseScored[0]?.patternRef ?? 0;

    for (let i = 0; i < baseScored.length; i++) {
      const sp = baseScored[i];
      const pat = patterns[sp.patternRef];

      const { features, reasons } = encodeTacticalPatternFeatures(
        request,
        pat,
        this.tacticalEvaluator
      );
      const breakdown = computeCategoryBreakdown(sp.score, features, weights);

      details.push({
        patternRef: sp.patternRef,
        baseScore: sp.score,
        tacticalAdjustment: breakdown.totalTacticalScore,
        finalScore: breakdown.finalScore,
        tacticalFeatures: Array.from(features),
        categoryBreakdown: breakdown,
        reason: reasons.length > 0 ? reasons.join("; ") : undefined,
      });

      if (breakdown.finalScore > bestScore) {
        bestScore = breakdown.finalScore;
        bestPatternRef = sp.patternRef;
      }
    }

    return {
      scoredPatterns: details,
      bestPatternRef,
    };
  }
}
