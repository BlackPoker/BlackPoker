/**
 * Gen9TacticalPrototypePolicy.ts
 *
 * BlackPoker Simulator - Gen 9 戦術判断プロトタイプ Policy (Work 5-1 R2)
 *
 * 【設計原則】
 * 1. Gen 8 Champion Candidate DNA (23,738パラメータ, Schema v6) をベース評価として完全に維持・保護。
 * 2. DecisionPolicy 境界の厳格遵守:
 *    - 入力は Readonly<DecisionRequest> のみ。
 *    - 相手の非公開手札・伏せカード・未開封パックは一切覗かない（PlayerObservation の合法情報のみ使用）。
 *    - GameState や GameSession への直接アクセス禁止。
 * 3. 汎用的な戦術評価レイヤーの付加 (Work 5-1 R2 改善):
 *    - A. 正確な損害予測 (公式 YAML に準拠した成立条件・対象検証・正味ライフ損害・Counter 成立判定)
 *    - B. 合法ブロックと未ブロック突破を考慮した攻撃評価 (複数アタッカー、数的優位、リーサル判定、犬死抑制)
 *    - C. ストリーミングブロック評価の統合 (O(1) メモリで即死回避・有利トレード判定)
 *    - D. 生存と資源管理 (Life & Board Resource Awareness)
 * 4. 厳格な決定論的 Argmax:
 *    - 同一 Request + 同一 DNA で完全同一の Response を返す。
 */

import { DecisionPolicy, PolicyDescriptor } from "../simulation/DecisionPolicy.js";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../../domain/decision/DecisionResponse.js";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes.js";
import { DecisionDNACodec } from "./DecisionDNACodec.js";
import { DecisionFeatureEncoder } from "./DecisionFeatureEncoder.js";
import { GenomeScorer } from "./GenomeScorer.js";
import { LegalPattern } from "../../domain/decision/LegalPattern.js";
import { UnitView, RequestView, PlayerObservationView, KnownCardView } from "../../domain/decision/PlayerObservation.js";
import {
  TacticalEvaluator,
  TacticalRequestOutcome,
  TacticalCounterOutcome,
} from "../../domain/decision/TacticalEvaluationTypes.js";

export interface TacticalEvaluationDetail {
  readonly patternRef: number;
  readonly baseScore: number;
  readonly tacticalAdjustment: number;
  readonly finalScore: number;
  readonly reason?: string;
}

export interface TacticalEvaluationResult {
  readonly scoredPatterns: readonly TacticalEvaluationDetail[];
  readonly bestPatternRef: number;
}

export class Gen9TacticalPrototypePolicy implements DecisionPolicy {
  public readonly descriptor: PolicyDescriptor;
  private readonly dna: DecisionDNA;
  private readonly tacticalEvaluator?: TacticalEvaluator;
  private static defaultEvaluator?: TacticalEvaluator;

  /**
   * グローバルデフォルトの TacticalEvaluator を設定
   */
  public static setDefaultEvaluator(evaluator: TacticalEvaluator): void {
    Gen9TacticalPrototypePolicy.defaultEvaluator = evaluator;
  }

  /**
   * グローバルデフォルトの TacticalEvaluator を取得
   */
  public static getDefaultEvaluator(): TacticalEvaluator | undefined {
    return Gen9TacticalPrototypePolicy.defaultEvaluator;
  }

  constructor(dna: Readonly<DecisionDNA>, name?: string, evaluator?: TacticalEvaluator) {
    DecisionDNACodec.validate(dna);
    this.dna = DecisionDNACodec.clone(dna);
    this.tacticalEvaluator = evaluator ?? Gen9TacticalPrototypePolicy.defaultEvaluator;

    this.descriptor = {
      kind: "genome",
      policyVersion: 9,
      name: name ?? "Gen9TacticalPrototypePolicy",
      metadata: {
        dnaFormatVersion: this.dna.dnaFormatVersion,
        featureSchemaVersion: this.dna.featureSchemaVersion,
        scoringModel: "linear_interaction_plus_tactical_v2",
        dnaId: this.dna.metadata?.id,
        dnaName: this.dna.metadata?.name,
      },
    };
  }

  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    // 0. ストリーミングプロバイダが存在し、かつパターン配列が空または大規模な場合
    if (
      request.blockAssignmentStream &&
      (request.patterns.length === 0 || request.blockAssignmentStream.patternCount > 256)
    ) {
      return this.chooseStreamingWithTactics(request);
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

  /**
   * ブロック割り当てストリーミング評価に戦術補正を統合（O(1) メモリで即死回避・トレード最適化）
   */
  private chooseStreamingWithTactics(request: Readonly<DecisionRequest>): DecisionResponse {
    const stream = request.blockAssignmentStream!;
    if (stream.patternCount === 0) {
      throw new Error(`DecisionRequest に選択可能なパターンが存在しません: ${request.decisionId}`);
    }

    const obs = request.observation;
    const selfKey = request.playerId;
    const selfView = obs.players.find((p) => p.playerId === selfKey) ?? obs.players.find((p) => p.isViewer);
    const oppView = obs.players.find((p) => p.playerId !== selfKey) ?? obs.players.find((p) => !p.isViewer);
    const selfLife = selfView?.lifeCount ?? 15;

    // 自軍ユニットマップ (unitId -> UnitView)
    const myUnitsMap = new Map<string, UnitView>();
    for (const u of selfView?.field ?? []) myUnitsMap.set(u.unitId, u);
    for (const u of selfView?.trumps ?? []) myUnitsMap.set(u.unitId, u);

    // 相手アタッカーマップ (unitId -> UnitView)
    const oppAttackersMap = new Map<string, UnitView>();
    for (const u of oppView?.field ?? []) {
      if (u.battle?.role === "attacker") oppAttackersMap.set(u.unitId, u);
    }

    // 1. 文脈特徴量ベクトル (165次元) を 1 回だけ計算
    const contextValues = DecisionFeatureEncoder.encodeContextOnly(request);

    // 2. ブロック割り当て特徴量エンコーダのコンテキスト準備
    const encoderContext = DecisionFeatureEncoder.createBlockAssignmentEncoderContext(request);

    let bestScore = -Infinity;
    let bestIndex = 0;
    let currentIndex = 0;

    for (const assignments of stream.iterateAssignments()) {
      // ベーススコア (Gen 8 DNA)
      const pValues = DecisionFeatureEncoder.encodeBlockAssignmentValues(
        assignments,
        stream.candidateCount,
        encoderContext
      );
      const baseScore = GenomeScorer.scoreSinglePattern(contextValues, pValues, this.dna);

      // 戦術調整値の算出 (O(1) メモリ)
      let tacticalAdj = 0;

      // ブロックされたアタッカーIDセット
      const blockedAttackerIds = new Set<string>();

      for (const assign of assignments) {
        const attackerUnitId = assign.sourceUnitId;
        const blockerUnitIds = assign.selectedUnitIds ?? [];
        if (blockerUnitIds.length === 0) continue;

        blockedAttackerIds.add(attackerUnitId);
        const atk = oppAttackersMap.get(attackerUnitId);
        const atkSize = atk?.currentSize ?? 0;

        for (const blockerUnitId of blockerUnitIds) {
          const blk = myUnitsMap.get(blockerUnitId);
          const blkSize = blk?.currentSize ?? 0;

          // トレード評価
          if (blkSize > atkSize) {
            tacticalAdj += 0.2; // 有利トレード
          } else if (blkSize === atkSize && blkSize > 0) {
            tacticalAdj += 0.1; // 相討ち
          } else if (blkSize < atkSize) {
            // 不利トレード（一方的破壊）
            if (selfLife > 8 && blkSize >= 5) {
              tacticalAdj -= 0.15; // ライフ余裕時の大型犬死ペナルティ
            }
          }
        }
      }

      // 未ブロックアタッカーの合計ダメージを算出
      let unblockedDamage = 0;
      for (const [atkId, atk] of oppAttackersMap.entries()) {
        if (!blockedAttackerIds.has(atkId)) {
          unblockedDamage += (atk.currentSize ?? 0);
        }
      }

      // 即死・致死ダメージ回避
      if (unblockedDamage >= selfLife && selfLife > 0) {
        tacticalAdj -= 2.5; // 即死ペナルティ
      } else if (selfLife - unblockedDamage <= 3) {
        tacticalAdj -= 0.5 * (unblockedDamage / Math.max(1, selfLife));
      }

      const finalScore = baseScore + tacticalAdj;

      // 決定論的 Argmax (厳格な大なり > により先頭優先)
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
   * 各合法パターンのベーススコアおよび戦術調整値を計算し、最善手を選択
   */
  public evaluatePatterns(request: Readonly<DecisionRequest>): TacticalEvaluationResult {
    // 1. 従来 Gen 8 DNA によるベーススコアリング
    const encodedFeatures = DecisionFeatureEncoder.encode(request);
    const baseScored = GenomeScorer.score(encodedFeatures, this.dna);

    const patterns = request.patterns;
    const details: TacticalEvaluationDetail[] = [];

    let bestScore = -Infinity;
    let bestPatternRef = baseScored[0]?.patternRef ?? 0;

    for (let i = 0; i < baseScored.length; i++) {
      const sp = baseScored[i];
      const pat = patterns[sp.patternRef];

      // 2. 戦術的調整値の算出
      const { adjustment, reason } = this.calculateTacticalAdjustment(request, pat);
      const finalScore = sp.score + adjustment;

      details.push({
        patternRef: sp.patternRef,
        baseScore: sp.score,
        tacticalAdjustment: adjustment,
        finalScore,
        reason,
      });

      // 3. 決定論的 Argmax (タイブレーク: 最小 patternRef 優先)
      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestPatternRef = sp.patternRef;
      }
    }

    return {
      scoredPatterns: details,
      bestPatternRef,
    };
  }

  /**
   * 単一パターンに対する戦術調整値を計算
   */
  private calculateTacticalAdjustment(
    request: Readonly<DecisionRequest>,
    pattern: Readonly<LegalPattern>
  ): { adjustment: number; reason?: string } {
    const obs = request.observation;
    const selfKey = request.playerId;
    const selfView = obs.players.find((p) => p.playerId === selfKey) ?? obs.players.find((p) => p.isViewer);
    const oppView = obs.players.find((p) => p.playerId !== selfKey) ?? obs.players.find((p) => !p.isViewer);
    const selfLife = selfView?.lifeCount ?? 15;

    let adjustment = 0;
    const reasons: string[] = [];

    // =========================================================================
    // 戦術評価 A: Stage リクエスト解決後の損害・致死性予測 (Lethal & Damage Awareness)
    // =========================================================================
    const stageRequests = obs.stageRequests ?? [];
    const oppRequests = stageRequests.filter((r) => r.controller !== selfKey);

    if (oppRequests.length > 0 && this.tacticalEvaluator) {
      const primaryOppReq = oppRequests[oppRequests.length - 1]; // 最上位の相手リクエスト
      const reqOutcome = this.tacticalEvaluator.evaluateRequestOutcome(primaryOppReq, selfKey, obs);

      if (!reqOutcome.isGuardedOut) {
        const netDmg = reqOutcome.netDamageToSelf;

        // (A-1) PASS を選択した場合の損害ペナルティ
        if (pattern.kind === "PASS") {
          if (reqOutcome.certainty === "CERTAIN") {
            // 確定損害
            if (netDmg.min >= selfLife && selfLife > 0) {
              adjustment -= 2.5; // 確定致死回避ペナルティ
              reasons.push(`Certain lethal PASS penalty (-2.5): damage=${netDmg.min} >= life=${selfLife}`);
            } else if (selfLife - netDmg.expected <= 4) {
              const severePenalty = 0.8 * (netDmg.expected / Math.max(1, selfLife));
              adjustment -= severePenalty;
              reasons.push(`Certain severe damage PASS penalty (-${severePenalty.toFixed(2)}): damage=${netDmg.expected}`);
            } else if (netDmg.expected >= 5) {
              adjustment -= 0.35;
              reasons.push(`Certain damage PASS penalty (-0.35): damage=${netDmg.expected}`);
            }
          } else if (reqOutcome.certainty === "ESTIMATED") {
            // 非公開情報を含む推定損害 (最悪想定〜期待値)
            if (netDmg.max >= selfLife && selfLife > 0) {
              // 最悪ケースで致死の危険性あり (最悪致死リスクヘッジ)
              // 確定致死(-2.5)とは混同せず、リスクに応じた慎重なペナルティ
              const riskPenalty = Math.min(1.8, 0.8 + 0.8 * (netDmg.expected / Math.max(1, selfLife)));
              adjustment -= riskPenalty;
              reasons.push(`Estimated lethal risk PASS penalty (-${riskPenalty.toFixed(2)}): maxDmg=${netDmg.max} >= life=${selfLife}, expected=${netDmg.expected}`);
            } else if (selfLife - netDmg.expected <= 4) {
              const p = 0.5 * (netDmg.expected / Math.max(1, selfLife));
              adjustment -= p;
              reasons.push(`Estimated damage PASS penalty (-${p.toFixed(2)}): expected=${netDmg.expected}`);
            } else if (netDmg.expected >= 5) {
              adjustment -= 0.25;
              reasons.push(`Estimated moderate damage PASS penalty (-0.25): expected=${netDmg.expected}`);
            }
          }
        }

        // (A-2) 打ち消し・阻止選択肢 (Counter 等) を選択した場合の阻止ボーナス
        const counterOutcome = this.tacticalEvaluator.evaluateCounterOutcome(pattern, primaryOppReq, request, reqOutcome);
        if (counterOutcome.cancelStatus === "CERTAIN_CANCEL") {
          const prevented = counterOutcome.preventedDamageToSelf;
          if (prevented.isCertain && prevented.min >= selfLife && selfLife > 0) {
            adjustment += 2.2; // 確定致死阻止
            reasons.push(`Certain lethal Counter bonus (+2.2): prevents damage=${prevented.min}`);
          } else if (!prevented.isCertain && prevented.max >= selfLife && selfLife > 0) {
            adjustment += 1.8; // 推定最悪致死阻止
            reasons.push(`Estimated lethal risk Counter bonus (+1.8): prevents maxDamage=${prevented.max}`);
          } else if (prevented.expected >= 4) {
            const b = Math.min(1.0, 0.3 + 0.08 * prevented.expected);
            adjustment += b;
            reasons.push(`Counter bonus (+${b.toFixed(2)}): prevents expectedDamage=${prevented.expected}`);
          }
        } else if (counterOutcome.cancelStatus === "UNCERTAIN_CANCEL") {
          adjustment += 0.2;
          reasons.push(`Uncertain Counter potential bonus (+0.2)`);
        }
      }
    }

    // =========================================================================
    // 戦術評価 B: 合法ブロックと未ブロック突破を考慮した攻撃評価 (Combat Outcome Evaluation)
    // =========================================================================
    const act = pattern.actionSelectionRef !== undefined ? request.catalog.actions[pattern.actionSelectionRef] : undefined;
    if (act && act.actionId === "action.attack") {
      const attackAdj = this.evaluateAttackTactics(request, pattern, selfView, oppView);
      adjustment += attackAdj.adjustment;
      if (attackAdj.reason) reasons.push(attackAdj.reason);
    }

    // =========================================================================
    // 戦術評価 C: 生存と盤面リソース管理 (Life & Board Resource Management)
    // =========================================================================
    if (selfLife <= 6) {
      if (act && (act.actionId === "action.summonSoldier" || act.actionId === "action.addBulwark")) {
        adjustment += 0.1;
        reasons.push(`Critical life board building bonus (+0.1)`);
      }
    }

    return {
      adjustment,
      reason: reasons.length > 0 ? reasons.join("; ") : undefined,
    };
  }

  /**
   * 攻撃アクションの多角的戦術評価（数的優位・リーサル・トレード・一方的犬死の区別）
   */
  private evaluateAttackTactics(
    request: Readonly<DecisionRequest>,
    pattern: Readonly<LegalPattern>,
    selfView?: PlayerObservationView,
    oppView?: PlayerObservationView
  ): { adjustment: number; reason?: string } {
    const oppUnits = oppView?.field ?? [];
    const oppTrumps = oppView?.trumps ?? [];
    const oppLife = oppView?.lifeCount ?? 15;

    // 相手の起立状態のブロッカー (兵士, 英雄, 防壁)
    const activeBlockers = [...oppUnits, ...oppTrumps].filter(
      (u) => u.state === "charge" && (u.currentSize ?? 0) > 0
    );

    // 自軍の攻撃可能な兵士
    const myAttackers = (selfView?.field ?? []).filter(
      (u) => u.state === "charge" && u.kind !== "bulwark" && (u.currentSize ?? 0) > 0
    );

    if (myAttackers.length === 0) {
      return { adjustment: 0 };
    }

    const totalAtk = myAttackers.reduce((sum, u) => sum + (u.currentSize ?? 0), 0);

    // -------------------------------------------------------------------------
    // ケース 1: 相手ブロッカー不在
    // -------------------------------------------------------------------------
    if (activeBlockers.length === 0) {
      if (totalAtk >= oppLife) {
        return { adjustment: 2.0, reason: `Lethal unblocked attack bonus (+2.0): totalAtk=${totalAtk} >= oppLife=${oppLife}` };
      }
      return { adjustment: 0.2, reason: `Unblocked attack bonus (+0.2)` };
    }

    // -------------------------------------------------------------------------
    // ケース 2: アタッカー数 > ブロッカー数 (数的優位・未ブロック突破)
    // -------------------------------------------------------------------------
    if (myAttackers.length > activeBlockers.length) {
      const sortedAttackers = [...myAttackers].sort((a, b) => (a.currentSize ?? 0) - (b.currentSize ?? 0));
      const unblockedCount = myAttackers.length - activeBlockers.length;
      // 相手が最大サイズのアタッカーをすべてブロックしたと仮定した際の最小突破ダメージ
      const minBreakthrough = sortedAttackers.slice(0, unblockedCount).reduce((sum, u) => sum + (u.currentSize ?? 0), 0);

      if (minBreakthrough >= oppLife) {
        return { adjustment: 2.5, reason: `Guaranteed lethal attack bonus (+2.5): minBreakthrough=${minBreakthrough} >= oppLife=${oppLife}` };
      }

      return {
        adjustment: 0.25,
        reason: `Numerical advantage attack bonus (+0.25): myAtkCount=${myAttackers.length} > oppBlkCount=${activeBlockers.length}`,
      };
    }

    // -------------------------------------------------------------------------
    // ケース 3: アタッカー数 <= ブロッカー数 (トレード可能性の評価)
    // -------------------------------------------------------------------------
    const maxMyAtk = myAttackers.reduce((max, u) => Math.max(max, u.currentSize ?? 0), 0);
    const minOppBlk = activeBlockers.reduce((min, u) => Math.min(min, u.currentSize ?? 0), Infinity);
    const maxOppBlk = activeBlockers.reduce((max, u) => Math.max(max, u.currentSize ?? 0), 0);

    // 相手の最小ブロッカーを倒せる・相討ちできるアタッカーが存在する場合: 有効な戦闘
    if (maxMyAtk >= minOppBlk) {
      return { adjustment: 0.05, reason: `Favorable/Trade combat possible (+0.05): maxMyAtk=${maxMyAtk} >= minOppBlk=${minOppBlk}` };
    }

    // 自軍の全アタッカーが相手のどのブロッカーよりも小さく、一方的に討ち取られる場合 (完全犬死)
    if (maxMyAtk < minOppBlk) {
      const penalty = Math.min(0.35, 0.1 + 0.04 * (minOppBlk - maxMyAtk));
      return {
        adjustment: -penalty,
        reason: `Suicide attack penalty (-${penalty.toFixed(2)}): maxMyAtk=${maxMyAtk} < minOppBlk=${minOppBlk}`,
      };
    }

    return { adjustment: 0 };
  }
}
