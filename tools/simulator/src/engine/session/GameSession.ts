import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { PlayerKey, RequestRef } from "../../domain/decision/DecisionSource";
import { RulePackage } from "../../domain/rules/RulePackage";
import { CommandRegistry } from "../rules/CommandRegistry";
import { LegalPatternGenerator } from "../decision/LegalPatternGenerator";
import { PatternExecutor } from "../decision/PatternExecutor";
import { TurnManager } from "../rules/TurnManager";

/**
 * 将来の効果解決中断・再開用コンティニュエーション型
 */
export interface EffectContinuation {
  readonly sourceRequestId: RequestRef;
  readonly effectPath: readonly number[];
  readonly effectStepId: string;
}

/**
 * 将来の効果解決結果型
 */
export type EffectExecutionResult =
  | {
      readonly type: "COMPLETED";
    }
  | {
      readonly type: "WAITING_FOR_DECISION";
      readonly request: DecisionRequest;
      readonly continuation: EffectContinuation;
    };

export interface GameResult {
  readonly winner?: PlayerKey;
  readonly reason: string;
}

export type GameSessionStep =
  | {
      readonly type: "PROGRESSED";
      readonly events?: readonly any[];
    }
  | {
      readonly type: "WAITING_FOR_DECISION";
      readonly request: DecisionRequest;
    }
  | {
      readonly type: "FINISHED";
      readonly result: GameResult;
    };

/**
 * ゲームの進行と判断の待機・適用を管理するセッションマネージャー。
 */
export class GameSession {
  public state: any;
  public rulePackage: RulePackage;
  public registry: CommandRegistry;
  public stateVersion: number = 1;
  public matchId: string;
  public pendingDecision?: DecisionRequest;
  public continuation?: EffectContinuation;

  constructor(state: any, rulePackage: RulePackage, options?: { matchId?: string; registry?: CommandRegistry }) {
    this.state = state;
    this.rulePackage = rulePackage;
    this.registry = options?.registry || new CommandRegistry();
    this.matchId = options?.matchId || `match-${Date.now()}`;
  }

  /**
   * ゲームを自動的に進め、プレイヤーの判断が必要な場合は WAITING_FOR_DECISION を返します。
   */
  advance(): GameSessionStep {
    // 1. 勝敗判定（ライフ 0 判定）
    const finishCheck = this.checkGameFinished();
    if (finishCheck) {
      this.pendingDecision = undefined;
      return {
        type: "FINISHED",
        result: finishCheck,
      };
    }

    // すでに待機中の判断がある場合はそれを返す
    if (this.pendingDecision) {
      return {
        type: "WAITING_FOR_DECISION",
        request: this.pendingDecision,
      };
    }

    // 2. 現在のチャンスプレイヤーの判断要求を生成
    const chancePlayer: PlayerKey = this.state.chancePlayer || this.state.turnPlayer || "p1";
    const { request } = LegalPatternGenerator.generateActionRequestDecision(
      this.state,
      chancePlayer,
      this.rulePackage,
      {
        stateVersion: this.stateVersion,
        matchId: this.matchId,
      }
    );

    if (request.patterns.length > 0) {
      this.pendingDecision = request;
      return {
        type: "WAITING_FOR_DECISION",
        request,
      };
    }

    // 合法手がない場合（パス / チャンス移行 / ターン進行等）
    // 本フェーズでは手動進行やパス可能な状態としてプログレスを返す
    return {
      type: "PROGRESSED",
    };
  }

  /**
   * プレイヤー（人間またはAI）からの判断回答を受け付け、適用します。
   */
  submitDecision(response: DecisionResponse): GameSessionStep {
    if (!this.pendingDecision) {
      throw new Error("現在待機中の判断要求が存在しません。");
    }

    // 回答の検証と実行
    PatternExecutor.executeResponse(
      this.pendingDecision,
      response,
      this.state,
      this.rulePackage,
      this.registry
    );

    // 適用成功後、判断をクリアしてバージョンをインクリメント
    this.pendingDecision = undefined;
    this.stateVersion++;

    // 次のステップへ自動進行
    return this.advance();
  }

  /**
   * 勝敗チェック
   */
  private checkGameFinished(): GameResult | null {
    if (!this.state.players) return null;

    const p1 = this.state.players.p1;
    const p2 = this.state.players.p2;

    const p1Life = Array.isArray(p1?.life) ? p1.life.length : Number(p1?.life ?? 0);
    const p2Life = Array.isArray(p2?.life) ? p2.life.length : Number(p2?.life ?? 0);

    if (p1 && p1Life <= 0 && p2 && p2Life <= 0) {
      return { reason: "双方のライフが0になりました（引き分け）" };
    }
    if (p1 && p1Life <= 0) {
      return { winner: "p2", reason: "Player A のライフが0になりました" };
    }
    if (p2 && p2Life <= 0) {
      return { winner: "p1", reason: "Player B のライフが0になりました" };
    }

    return null;
  }
}
