/**
 * Gen9TacticalPrototypePolicy.ts
 *
 * BlackPoker Simulator - Gen 9 戦術判断プロトタイプ Policy (Work 5-1)
 *
 * 【設計原則】
 * 1. Gen 8 Champion DNA (1,482パラメータ) をベース評価として完全に維持・保護。
 * 2. DecisionPolicy 境界の厳格遵守:
 *    - 入力は Readonly<DecisionRequest> のみ。
 *    - 相手の非公開手札・伏せカード・未開封パックは一切覗かない（PlayerObservation の合法情報のみ使用）。
 *    - GameState や GameSession への直接アクセス禁止。
 * 3. 汎用的な戦術評価レイヤーの付加:
 *    - A. リクエスト解決後の損害・致死性予測 (Stage Damage & Lethal Awareness)
 *    - B. ブロックを考慮した攻撃評価 (Combat Outcome & Blocker Trade Awareness)
 *    - C. 生存と資源管理 (Life & Board Resource Awareness)
 * 4. 厳格な決定論的 Argmax:
 *    - 同一 Request + 同一 DNA で完全同一の Response を返す。
 */

import { DecisionPolicy, PolicyDescriptor } from "../simulation/DecisionPolicy.js";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../../domain/decision/DecisionResponse.js";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes.js";
import { DecisionDNACodec } from "./DecisionDNACodec.js";
import { DecisionFeatureEncoder } from "./DecisionFeatureEncoder.js";
import { GenomeScorer, ScoredPattern } from "./GenomeScorer.js";
import { LegalPattern } from "../../domain/decision/LegalPattern.js";
import { UnitView, RequestView, PlayerObservationView } from "../../domain/decision/PlayerObservation.js";

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

  constructor(dna: Readonly<DecisionDNA>, name?: string) {
    DecisionDNACodec.validate(dna);
    this.dna = DecisionDNACodec.clone(dna);

    this.descriptor = {
      kind: "genome",
      policyVersion: 9,
      name: name ?? "Gen9TacticalPrototypePolicy",
      metadata: {
        dnaFormatVersion: this.dna.dnaFormatVersion,
        featureSchemaVersion: this.dna.featureSchemaVersion,
        scoringModel: "linear_interaction_plus_tactical_v1",
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
      return this.chooseStreaming(request);
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
   * ブロック割り当てなどの超大規模合法手空間をストリーミング評価して最善手を決定論的に選択
   */
  private chooseStreaming(request: Readonly<DecisionRequest>): DecisionResponse {
    const stream = request.blockAssignmentStream!;
    if (stream.patternCount === 0) {
      throw new Error(`DecisionRequest に選択可能なパターンが存在しません: ${request.decisionId}`);
    }

    // 1. 文脈特徴量ベクトル (163次元) を 1 回だけ計算
    const contextValues = DecisionFeatureEncoder.encodeContextOnly(request);

    // 2. ブロック割り当て特徴量エンコーダのコンテキスト準備
    const encoderContext = DecisionFeatureEncoder.createBlockAssignmentEncoderContext(request);

    let bestScore = -Infinity;
    let bestIndex = 0;
    let currentIndex = 0;

    for (const assignments of stream.iterateAssignments()) {
      const pValues = DecisionFeatureEncoder.encodeBlockAssignmentValues(
        assignments,
        stream.candidateCount,
        encoderContext
      );
      const score = GenomeScorer.scoreSinglePattern(contextValues, pValues, this.dna);

      // 決定論的 Argmax: 厳格な大なり > により、同点時は先頭 (first-encountered) を優先
      if (score > bestScore) {
        bestScore = score;
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
    // 相手がコントローラーの直近未解決リクエストを取得
    const oppRequests = stageRequests.filter((r) => r.controller !== selfKey);

    if (oppRequests.length > 0) {
      const primaryOppReq = oppRequests[oppRequests.length - 1]; // 最上位の相手リクエスト
      const estDamage = this.estimateRequestDamage(primaryOppReq, oppView);

      // (A-1) PASS を選択した場合の損害ペナルティ
      if (pattern.kind === "PASS") {
        if (estDamage > 0) {
          // 即死回避: このリクエストを通すとライフが0以下になる場合
          if (estDamage >= selfLife) {
            adjustment -= 3.0; // 極大ペナルティで PASS を確実に回避
            reasons.push(`Lethal PASS penalty (-3.0): estDamage=${estDamage} >= life=${selfLife}`);
          } else if (selfLife - estDamage <= 4) {
            // 瀕死・危険域到達
            const severePenalty = 1.0 * (estDamage / Math.max(1, selfLife));
            adjustment -= severePenalty;
            reasons.push(`Severe damage PASS penalty (-${severePenalty.toFixed(2)}): estDamage=${estDamage}`);
          } else if (estDamage >= 5) {
            // 中〜大ダメージ
            adjustment -= 0.4;
            reasons.push(`Damage PASS penalty (-0.4): estDamage=${estDamage}`);
          }
        }
      }

      // (A-2) Counter (打ち消し) を選択した場合の阻止ボーナス
      const act = pattern.actionSelectionRef !== undefined ? request.catalog.actions[pattern.actionSelectionRef] : undefined;
      if (act && act.actionId === "action.counter") {
        if (estDamage > 0) {
          if (estDamage >= selfLife) {
            // 即死阻止ボーナス
            adjustment += 2.5;
            reasons.push(`Lethal Counter bonus (+2.5): prevents estDamage=${estDamage}`);
          } else if (selfLife - estDamage <= 4 || estDamage >= 8) {
            // 致命傷阻止ボーナス
            adjustment += 1.0;
            reasons.push(`High damage Counter bonus (+1.0): prevents estDamage=${estDamage}`);
          } else if (estDamage >= 4) {
            adjustment += 0.5;
            reasons.push(`Moderate damage Counter bonus (+0.5): prevents estDamage=${estDamage}`);
          }
        }
      }
    }

    // =========================================================================
    // 戦術評価 B: ブロックを考慮した攻撃評価 (Combat Outcome Evaluation)
    // =========================================================================
    const act = pattern.actionSelectionRef !== undefined ? request.catalog.actions[pattern.actionSelectionRef] : undefined;
    if (act && act.actionId === "action.attack") {
      // 相手のアンタップ状態の最大ブロッカーサイズを算出
      const oppUnits = oppView?.field ?? [];
      const activeBlockers = oppUnits.filter(
        (u) => u.state === "charge" && (u.currentSize ?? 0) > 0
      );
      const maxBlockerSize = activeBlockers.reduce(
        (max, u) => Math.max(max, u.currentSize ?? 0),
        0
      );

      // 自軍の攻撃可能な兵士の中で最大のサイズを算出
      const myAttackers = (selfView?.field ?? []).filter(
        (u) => u.state === "charge" && u.kind !== "bulwark" && (u.currentSize ?? 0) > 0
      );
      const myMaxAttackerSize = myAttackers.reduce(
        (max, u) => Math.max(max, u.currentSize ?? 0),
        0
      );

      if (maxBlockerSize > 0 && myMaxAttackerSize > 0) {
        // 相手の大型ブロッカーに一方的に討ち取られるリスク
        if (maxBlockerSize > myMaxAttackerSize) {
          const sizeDiff = maxBlockerSize - myMaxAttackerSize;
          // 一方的破壊ペナルティ: サイズ差が大きいほど重いペナルティ
          const suicidePenalty = Math.min(1.5, 0.2 + 0.08 * sizeDiff);
          adjustment -= suicidePenalty;
          reasons.push(`Suicide attack penalty (-${suicidePenalty.toFixed(2)}): mySize=${myMaxAttackerSize} vs maxBlocker=${maxBlockerSize}`);
        } else if (myMaxAttackerSize >= maxBlockerSize) {
          // 有利・同等のトレードまたは突破可能
          adjustment += 0.1;
          reasons.push(`Favorable attack bonus (+0.1): mySize=${myMaxAttackerSize} >= maxBlocker=${maxBlockerSize}`);
        }
      } else if (maxBlockerSize === 0 && myMaxAttackerSize > 0) {
        // ブロッカーなし: 有効な直接攻撃
        adjustment += 0.15;
        reasons.push(`Unblocked attack bonus (+0.15)`);
      }
    }

    // =========================================================================
    // 戦術評価 C: 生存と盤面リソース管理 (Life & Board Resource Management)
    // =========================================================================
    if (selfLife <= 6) {
      // 残ライフ危険時の召喚・ブロッカー確保ボーナス
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
   * Stage リクエストから公開情報に基づいて推定ダメージ量を計算（汎用）
   */
  private estimateRequestDamage(req: Readonly<RequestView>, oppView?: PlayerObservationView): number {
    // 1. action.deathLance: キーカードの合計値または最大値、あるいは典型ダメージ
    if (req.actionId === "action.deathLance") {
      // キーカードが公開されている場合はその数値を合算
      if (req.keyCards && req.keyCards.length > 0) {
        let sum = 0;
        for (const k of req.keyCards) {
          if (k.visibility === "KNOWN" && typeof k.value === "number") {
            sum += k.value;
          }
        }
        if (sum > 0) return sum;
      }
      // キーカード情報が直接取得できない場合でも、死の槍は標準で 8〜13 点の大ダメージ
      return 10;
    }

    // 2. action.damageJudge (戦闘ダメージ)
    if (req.actionId === "action.damageJudge") {
      // 攻撃側ユニットのサイズを推定
      const oppAttackers = (oppView?.field ?? []).filter(
        (u) => u.battle?.role === "attacker"
      );
      if (oppAttackers.length > 0) {
        return oppAttackers.reduce((sum, u) => sum + (u.currentSize ?? 0), 0);
      }
      return 3;
    }

    // 3. action.throwing (投擲)
    if (req.actionId === "action.throwing") {
      return 4; // 投擲の典型ダメージ
    }

    // 4. action.kill (破壊)
    if (req.actionId === "action.kill") {
      return 5; // ユニット破壊相当の脅威
    }

    // デフォルト: 不明な相手アクション
    return 1;
  }
}
