import { RulePackage } from "../../domain/rules/RulePackage";
import {
  RegulationCatalog,
  OfficialSetupRuleUnspecifiedError,
} from "../../domain/regulation/RegulationDefinition";
import { loadRegulationCatalog } from "./RegulationLoader";
import { RegulationValidator } from "./RegulationValidator";
import { RegulationRulePackageSelector } from "./RegulationRulePackageSelector";
import { loadRulePackageFromDirectory } from "../rules/RuleLoader";
import { GameSession } from "../session/GameSession";
import { BatchMatchContext } from "../../domain/simulation/BatchSimulationTypes";
import {
  OfficialRegulationMatchSetup,
  InGameCard,
  OfficialRegulationSetupOptions,
} from "./OfficialRegulationMatchSetup";

export type { InGameCard };

export interface OfficialMatchFactoryOptions {
  readonly catalog?: RegulationCatalog;
  readonly fullRulePackage?: RulePackage;
  readonly matchId?: string;
  readonly playerNames?: {
    readonly p1?: string;
    readonly p2?: string;
  };
}

/**
 * 公式対戦レギュレーション（ライト + エントリー16 等）に基づき、
 * 決定論的な初期盤面生成・シャッフル・共通プリセット・先攻決定・GameSession 構築を行うファクトリ。
 */
export class OfficialRegulationMatchFactory {
  public static findMatchingPresetSoldierComponent = OfficialRegulationMatchSetup.findMatchingPresetSoldierComponent;
  public static verifyCardConservation = OfficialRegulationMatchSetup.verifyCardConservation;
  public static setupMatch = OfficialRegulationMatchSetup.setupMatch;

  /**
   * 公式レギュレーションとシード値から、対戦可能な fresh な GameSession を生成します。
   */
  public static async createSession(
    regulationId: string = "light-entry16",
    matchSeed: number = 42,
    options?: OfficialMatchFactoryOptions
  ): Promise<GameSession> {
    const catalog = options?.catalog || (await loadRegulationCatalog());
    const validation = RegulationValidator.validateRegulation(catalog, regulationId, {
      assertImplemented: true,
    });

    const regulation = validation.regulation!;
    const format = validation.format!;
    const frame = validation.frame!;

    // 公式ルールパッケージの取得
    const officialRulePackage =
      options?.fullRulePackage && options.fullRulePackage.id === `official-${regulation.id}`
        ? options.fullRulePackage
        : RegulationRulePackageSelector.selectRulePackage(
            options?.fullRulePackage ||
              (await loadRulePackageFromDirectory(
                (await import("path")).resolve(__dirname, "../../data/rules-vnext")
              )),
            format,
            regulation
          );

    // セットアップ実行
    const outcome = this.setupMatch(regulation, frame, officialRulePackage, matchSeed, {
      matchId: options?.matchId,
      playerNames: options?.playerNames,
    });

    if (outcome.type === "TERMINAL") {
      // 敗北状態のセッション（Life 0）を生成
      const terminalState: any = {
        stateVersion: 1,
        matchId: options?.matchId || `match-official-${matchSeed}`,
        turnPlayer: outcome.loser,
        chancePlayer: outcome.loser,
        players: {
          p1: { life: outcome.winner === "p1" ? [1] : [] },
          p2: { life: outcome.winner === "p2" ? [1] : [] },
        },
      };
      return new GameSession(terminalState, officialRulePackage);
    }

    if (outcome.type === "RULE_UNSPECIFIED") {
      throw new OfficialSetupRuleUnspecifiedError(outcome);
    }

    return new GameSession(outcome.state, officialRulePackage, {
      matchId: outcome.state.matchId,
    });
  }

  /**
   * BatchSimulationOptions.sessionFactory および PolicyExperimentRunner 用の
   * sessionFactory 関数を生成します。
   */
  public static createSessionFactory(
    regulationId: string = "light-entry16",
    options?: OfficialMatchFactoryOptions
  ): (ctx: BatchMatchContext) => GameSession {
    // 非同期リソースを同期コンテキスト内で利用できるよう、事前ロードまたは Promise 同期キャッシュを保持
    let loadedPromise: Promise<{
      catalog: RegulationCatalog;
      fullRulePackage: RulePackage;
    }> | null = null;

    let preloaded: {
      catalog: RegulationCatalog;
      fullRulePackage: RulePackage;
    } | null = null;

    // 事前キャッシュの初期化
    if (options?.catalog && options?.fullRulePackage) {
      preloaded = {
        catalog: options.catalog,
        fullRulePackage: options.fullRulePackage,
      };
    }

    return (ctx: BatchMatchContext): GameSession => {
      if (!preloaded) {
        throw new Error(
          "OfficialRegulationMatchFactory.createSessionFactory requires preloaded catalog and rulePackage when called synchronously. Use prepareSessionFactory() first or pass catalog and fullRulePackage in options."
        );
      }

      const validation = RegulationValidator.validateRegulation(preloaded.catalog, regulationId, {
        assertImplemented: true,
      });

      const officialRulePackage = RegulationRulePackageSelector.selectRulePackage(
        preloaded.fullRulePackage,
        validation.format!,
        validation.regulation!
      );

      const outcome = OfficialRegulationMatchFactory.setupMatch(
        validation.regulation!,
        validation.frame!,
        officialRulePackage,
        ctx.matchSeed,
        {
          matchId: ctx.matchId,
          playerNames: options?.playerNames,
        }
      );

      if (outcome.type === "TERMINAL") {
        const terminalState: any = {
          stateVersion: 1,
          matchId: ctx.matchId,
          turnPlayer: outcome.loser,
          chancePlayer: outcome.loser,
          players: {
            p1: { life: outcome.winner === "p1" ? [1] : [] },
            p2: { life: outcome.winner === "p2" ? [1] : [] },
          },
        };
        return new GameSession(terminalState, officialRulePackage);
      }

      if (outcome.type === "RULE_UNSPECIFIED") {
        throw new OfficialSetupRuleUnspecifiedError(outcome);
      }

      return new GameSession(outcome.state, officialRulePackage, {
        matchId: outcome.state.matchId,
      });
    };
  }

  /**
   * 非同期でリソースを事前読み込みし、同期 sessionFactory を返却します。
   */
  public static async prepareSessionFactory(
    regulationId: string = "light-entry16",
    options?: OfficialMatchFactoryOptions
  ): Promise<(ctx: BatchMatchContext) => GameSession> {
    const catalog = options?.catalog || (await loadRegulationCatalog());
    const fullRulePackage =
      options?.fullRulePackage ||
      (await loadRulePackageFromDirectory(
        (await import("path")).resolve(__dirname, "../../data/rules-vnext")
      ));

    return this.createSessionFactory(regulationId, {
      ...options,
      catalog,
      fullRulePackage,
    });
  }
}
