import { DecisionPolicy, PolicyDescriptor } from "../simulation/DecisionPolicy";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { LegalPattern } from "../../domain/decision/LegalPattern";

export const DEFAULT_MIN_HAND_RESERVE = 4;

/**
 * LegalPattern のリソース消費特性プロファイル
 */
export interface PatternResourceProfile {
  readonly patternIndex: number;
  readonly pattern: LegalPattern;
  readonly isPass: boolean;
  readonly timing?: string;
  readonly speed?: string;
  readonly handCommitment: number;
  readonly lifeCost: number;
  readonly sacrificedUnits: number;
  readonly drivenBulwarks: number;
}

/**
 * リソース負荷比較関数。
 * 1. handCommitment 少
 * 2. sacrificedUnits 少
 * 3. lifeCost 少
 * 4. drivenBulwarks 少
 * 5. patternIndex 小 (安定ソート)
 */
export function compareResourceBurden(a: PatternResourceProfile, b: PatternResourceProfile): number {
  if (a.handCommitment !== b.handCommitment) {
    return a.handCommitment - b.handCommitment;
  }
  if (a.sacrificedUnits !== b.sacrificedUnits) {
    return a.sacrificedUnits - b.sacrificedUnits;
  }
  if (a.lifeCost !== b.lifeCost) {
    return a.lifeCost - b.lifeCost;
  }
  if (a.drivenBulwarks !== b.drivenBulwarks) {
    return a.drivenBulwarks - b.drivenBulwarks;
  }
  return a.patternIndex - b.patternIndex;
}

/**
 * 単一パターンの Generic Resource Profile を算出
 */
export function calculatePatternResourceProfile(
  pattern: LegalPattern,
  patternIndex: number,
  request: Readonly<DecisionRequest>
): PatternResourceProfile {
  const isPass = pattern.kind === "PASS";
  const catalog = request.catalog;

  const keyCardSelection =
    pattern.keyCardSelectionRef !== undefined
      ? catalog.cardSelections?.[pattern.keyCardSelectionRef]
      : undefined;

  const costPayment =
    pattern.costPaymentRef !== undefined
      ? catalog.costPayments?.[pattern.costPaymentRef]
      : undefined;

  const actionSelection =
    pattern.actionSelectionRef !== undefined
      ? catalog.actions?.[pattern.actionSelectionRef]
      : undefined;

  const keyCardIds = keyCardSelection?.cardIds ?? [];
  const discardedCardIds = costPayment?.discardedCardIds ?? [];
  // 一意カードID数（同じ cardId は二重カウントしない）
  const uniqueCardIds = new Set<string>([...keyCardIds, ...discardedCardIds]);

  return {
    patternIndex,
    pattern,
    isPass,
    timing: actionSelection?.timing,
    speed: actionSelection?.speed,
    handCommitment: uniqueCardIds.size,
    lifeCost: costPayment?.lifeCount ?? 0,
    sacrificedUnits: costPayment?.sacrificedUnitIds?.length ?? 0,
    drivenBulwarks: costPayment?.drivenBulwarkUnitIds?.length ?? 0,
  };
}

/**
 * Playtest専用 AI Policy: PlaytestConservativePolicy
 *
 * 【設計目的】
 * Simulatorでルール・UI・カード効果を確認しやすくするため、
 * 簡単で予測可能、かつ手札を適度に温存する対戦相手を提供する。
 *
 * 【特徴】
 * - 決定論的 (PRNG不使用、同一リクエストに対し常に同一回答)
 * - 手札温存 (デフォルトで MIN_HAND_RESERVE = 4 を維持)
 * - 相手ターンでの不用意な手札消費 (Quick連打等) を抑制
 * - PASS専用AIではない (手札を消費しない攻撃・ブロック・ターン進行等は通常通り実行)
 * - Action ID / Name のハードコードは一切なし (Generic Resource Profile ベースで判断)
 * - 生 GameState / 相手の非公開情報には一切アクセスせず、DecisionRequest の公開情報のみ使用
 */
export class PlaytestConservativePolicy implements DecisionPolicy {
  readonly descriptor: PolicyDescriptor;
  readonly minHandReserve: number;

  constructor(minHandReserve: number = DEFAULT_MIN_HAND_RESERVE) {
    this.minHandReserve = minHandReserve;
    this.descriptor = {
      kind: "playtestConservative",
      policyVersion: 1,
      name: "PlaytestConservative",
      metadata: {
        minHandReserve: this.minHandReserve,
      },
    };
  }

  choose(request: Readonly<DecisionRequest>): DecisionResponse {
    if (!request.patterns || request.patterns.length === 0) {
      throw new Error(`DecisionRequest に選択可能なパターンが存在しません: ${request.decisionId}`);
    }

    // 14. EFFECT_RESOLUTION / ZONE_TOP_SELECTION 等、ACTION_REQUEST 以外の判断
    if (request.source?.type !== "ACTION_REQUEST") {
      const nonPassIdx = request.patterns.findIndex((p) => p.kind !== "PASS");
      const selectedIndex = nonPassIdx !== -1 ? nonPassIdx : 0;
      return {
        decisionId: request.decisionId,
        stateVersion: request.stateVersion,
        selectedPatternRef: selectedIndex,
      };
    }

    // 9. 自分の手札枚数
    const myPlayer = request.observation?.players?.find((p) => p.playerId === request.playerId);
    const handCount = myPlayer?.handCount ?? 0;

    // 各パターンの Generic Resource Profile を算出
    const profiles = request.patterns.map((p, idx) => calculatePatternResourceProfile(p, idx, request));

    const passProfile = profiles.find((p) => p.isPass);
    const actionProfiles = profiles.filter((p) => !p.isPass && p.pattern.kind === "ACTION");
    const candidateActionProfiles =
      actionProfiles.length > 0 ? actionProfiles : profiles.filter((p) => !p.isPass);

    const turnPlayerId = request.observation?.turnPlayerId;
    const isOwnTurn = turnPlayerId !== undefined && turnPlayerId === request.playerId;

    let selectedIndex: number | null = null;

    if (isOwnTurn) {
      // 11-A. Turn Player が自分の場合:
      // 優先1: 手札を使用する (handCommitment > 0) timing === "main" の Action のうち、
      // handCount - handCommitment >= minHandReserve を満たすもの
      const priority1Candidates = candidateActionProfiles.filter(
        (p) =>
          p.handCommitment > 0 &&
          p.timing?.toLowerCase() === "main" &&
          handCount - p.handCommitment >= this.minHandReserve
      );

      if (priority1Candidates.length > 0) {
        priority1Candidates.sort(compareResourceBurden);
        selectedIndex = priority1Candidates[0].patternIndex;
      } else {
        // 11-B. 手札を温存する段階: handCommitment === 0 の ACTION を選ぶ
        const zeroHandCandidates = candidateActionProfiles.filter((p) => p.handCommitment === 0);
        if (zeroHandCandidates.length > 0) {
          zeroHandCandidates.sort(compareResourceBurden);
          selectedIndex = zeroHandCandidates[0].patternIndex;
        } else if (passProfile) {
          // 11-C. それでも Action を選べない場合、PASS があれば PASS
          selectedIndex = passProfile.patternIndex;
        } else if (candidateActionProfiles.length > 0) {
          // 11-D. PASS が存在しない場合 (Mandatory Decision): resource burden 最小を選択
          const allMandatory = [...candidateActionProfiles].sort(compareResourceBurden);
          selectedIndex = allMandatory[0].patternIndex;
        }
      }
    } else {
      // 12. 相手 Turn での挙動 (または 13. turnPlayerId 不明時: fail-conservative)
      // 相手ターンでは、handCommitment === 0 の non-PASS ACTION を優先
      const zeroHandCandidates = candidateActionProfiles.filter((p) => p.handCommitment === 0);
      if (zeroHandCandidates.length > 0) {
        zeroHandCandidates.sort(compareResourceBurden);
        selectedIndex = zeroHandCandidates[0].patternIndex;
      } else if (passProfile) {
        // 手札を使用する Quick 等しかなく PASS 可能な場合は PASS
        selectedIndex = passProfile.patternIndex;
      } else if (candidateActionProfiles.length > 0) {
        // PASS が存在しない Mandatory Decision
        const allMandatory = [...candidateActionProfiles].sort(compareResourceBurden);
        selectedIndex = allMandatory[0].patternIndex;
      }
    }

    if (selectedIndex === null) {
      selectedIndex = passProfile ? passProfile.patternIndex : 0;
    }

    return {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: selectedIndex,
    };
  }

  async decide(request: Readonly<DecisionRequest>): Promise<DecisionResponse> {
    return this.choose(request);
  }
}
