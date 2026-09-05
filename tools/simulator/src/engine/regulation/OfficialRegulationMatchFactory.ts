import { RulePackage, ComponentDefinition } from "../../domain/rules/RulePackage";
import {
  CardDefinition,
  FrameDefinition,
  RegulationDefinition,
  SetupOutcome,
} from "../../domain/regulation/RegulationDefinition";
import { RegulationCatalog, loadRegulationCatalog } from "./RegulationLoader";
import { RegulationValidator } from "./RegulationValidator";
import { RegulationRulePackageSelector } from "./RegulationRulePackageSelector";
import { loadRulePackageFromDirectory } from "../rules/RuleLoader";
import { GameSession } from "../session/GameSession";
import { SeededRandom, RandomSource } from "../random/RandomSource";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { getOpponentPlayerKey } from "../rules/playerUtils";
import { rankToValue, matchesRank } from "../rules/cardUtils";
import { BatchMatchContext } from "../../domain/simulation/BatchSimulationTypes";

export interface OfficialMatchFactoryOptions {
  readonly catalog?: RegulationCatalog;
  readonly fullRulePackage?: RulePackage;
  readonly matchId?: string;
  readonly playerNames?: {
    readonly p1?: string;
    readonly p2?: string;
  };
}

export interface InGameCard {
  readonly id: string;
  readonly suit: "S" | "H" | "D" | "C" | "J";
  readonly rank: string;
  readonly value: number;
}

/**
 * 32-bit FNV-1a を用いて独立した決定論的乱数シードを導出します。
 */
function deriveSeed(baseSeed: number, streamKey: string): number {
  const str = `${baseSeed}:${streamKey}`;
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Fisher-Yates アルゴリズムによる決定論的カードシャッフル
 */
function shuffleCards<T>(cards: readonly T[], rng: RandomSource): T[] {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

/**
 * 公式対戦レギュレーション（ライト + エントリー16 等）に基づき、
 * 決定論的な初期盤面生成・シャッフル・共通プリセット・先攻決定・GameSession 構築を行うファクトリ。
 */
export class OfficialRegulationMatchFactory {
  /**
   * 候補カードが、選択中の公式 RulePackage 内で「プリセット兵士として適格」な Component に適合するか判定します。
   *
   * 【重要設計】
   * characterType === "soldier" へ意味を寄せず、Character 種別とは独立した
   * generic 属性 (eligibleAsPresetSoldier: true) および unitCondition の rank 適合性により判定します。
   */
  public static findMatchingPresetSoldierComponent(
    card: InGameCard,
    components: readonly ComponentDefinition[]
  ): ComponentDefinition | undefined {
    return components.find((comp) => {
      if (comp.type !== "character") return false;
      if (comp.properties?.eligibleAsPresetSoldier !== true) return false;

      // unitCondition のカード枚数およびランク条件を検証
      const cond = comp.unitCondition;
      if (!cond || !cond.cards) return false;

      // プリセット兵士は 1枚構成
      if (cond.cards.count !== undefined && cond.cards.count !== 1) return false;
      if (cond.cards.minCount !== undefined && cond.cards.minCount > 1) return false;

      if (cond.cards.rank) {
        return matchesRank(card.rank, card.value, cond.cards.rank);
      }

      return true;
    });
  }

  /**
   * カード保存則（16枚が全領域で完全保存、消失・重複なし）を検証します。
   */
  public static verifyCardConservation(
    playerKey: PlayerKey,
    player: any,
    expectedDeck: readonly CardDefinition[]
  ): void {
    const cards: InGameCard[] = [];

    // Life
    if (Array.isArray(player.life)) {
      cards.push(...player.life);
    }
    // Hand
    if (Array.isArray(player.hand)) {
      cards.push(...player.hand);
    }
    // Field
    if (Array.isArray(player.field)) {
      for (const unit of player.field) {
        if (Array.isArray(unit.cards)) {
          cards.push(...unit.cards);
        }
      }
    }
    // Grave
    if (Array.isArray(player.grave)) {
      for (const entry of player.grave) {
        if (Array.isArray(entry.cards)) {
          cards.push(...entry.cards);
        } else if (entry.id && entry.suit && entry.rank) {
          cards.push(entry);
        }
      }
    }

    if (cards.length !== expectedDeck.length) {
      throw new Error(
        `Card conservation violated for ${playerKey}: expected ${expectedDeck.length} cards, but found ${cards.length}`
      );
    }

    // ID 一意性チェック
    const idSet = new Set<string>();
    for (const c of cards) {
      if (idSet.has(c.id)) {
        throw new Error(`Duplicate card identity detected for ${playerKey}: card ID ${c.id}`);
      }
      idSet.add(c.id);
    }

    // suit + rank マルチセット突合
    const getMultisetKey = (c: { suit: string; rank: string }) => `${c.suit.toUpperCase()}-${String(c.rank).toUpperCase()}`;
    const expectedKeys = expectedDeck.map(getMultisetKey).sort();
    const actualKeys = cards.map(getMultisetKey).sort();

    if (expectedKeys.join(",") !== actualKeys.join(",")) {
      throw new Error(
        `Card multiset mismatch for ${playerKey}: expected [${expectedKeys.join(",")}], actual [${actualKeys.join(",")}]`
      );
    }
  }

  /**
   * 公式ゲーム開始手順（公式ルール第9.1.2版 3.9 & 8.3.1.1）を実行し、ゲーム初期状態を構築します。
   */
  public static setupMatch(
    regulation: RegulationDefinition,
    frame: FrameDefinition,
    rulePackage: RulePackage,
    matchSeed: number,
    options?: {
      matchId?: string;
      playerNames?: { p1?: string; p2?: string };
    }
  ): SetupOutcome {
    const matchId = options?.matchId || `match-official-${matchSeed}`;
    const p1Name = options?.playerNames?.p1 || "Player A";
    const p2Name = options?.playerNames?.p2 || "Player B";

    // 1. フレーム定義から P1, P2 の固定16枚デッキを生成 (ID 一意化)
    const buildDeck = (playerKey: PlayerKey): InGameCard[] =>
      frame.deck.cards.map((c) => ({
        id: `${playerKey}-c-${c.suit}${c.rank}`,
        suit: c.suit,
        rank: c.rank,
        value: c.value !== undefined ? c.value : rankToValue(c.rank),
      }));

    const p1RawDeck = buildDeck("p1");
    const p2RawDeck = buildDeck("p2");

    // 2. 独立した乱数ストリームで Seeded Shuffle (P1, P2 それぞれ独立)
    const p1Rng = new SeededRandom(deriveSeed(matchSeed, "p1-deck"));
    const p2Rng = new SeededRandom(deriveSeed(matchSeed, "p2-deck"));

    const p1Shuffled = shuffleCards(p1RawDeck, p1Rng);
    const p2Shuffled = shuffleCards(p2RawDeck, p2Rng);

    // 3. デッキ全体を Life として伏せる (Deck は Zone ではない)
    const state: any = {
      stateVersion: 1,
      version: 1,
      matchId,
      regulationId: regulation.id,
      formatId: regulation.formatId,
      frameId: regulation.frameId,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 1,
      actionCount: 0,
      stage: { requests: [] },
      requestBuffer: { requests: [], history: [] },
      players: {
        p1: {
          name: p1Name,
          life: p1Shuffled,
          hand: [],
          field: [],
          grave: [],
          fog: [],
          trump: [],
        },
        p2: {
          name: p2Name,
          life: p2Shuffled,
          hand: [],
          field: [],
          grave: [],
          fog: [],
          trump: [],
        },
      },
    };

    const p1 = state.players.p1;
    const p2 = state.players.p2;

    // 4. 初期手札 7枚を Life 先頭から引く
    for (let i = 0; i < frame.setup.initialHandCount; i++) {
      p1.hand.push(p1.life.shift());
      p2.hand.push(p2.life.shift());
    }

    // 5. 共通プリセット (3.9.1)
    for (const playerKey of ["p1", "p2"] as const) {
      const player = state.players[playerKey];

      // 5-1. 防壁プリセット (裏向き, enteredFieldBeforeGame = true)
      if (player.life.length === 0) {
        const winner = getOpponentPlayerKey(playerKey, state);
        return {
          type: "TERMINAL",
          winner,
          loser: playerKey,
          reason: `プリセット防壁配置中に ${player.name} のライフが枯渇しました`,
        };
      }
      const bulwarkCard = player.life.shift();
      player.field.push({
        unitId: `bw-${playerKey}-preset`,
        kind: "防壁",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        cards: [bulwarkCard],
        labels: ["防御"],
        enteredFieldBeforeGame: true,
        enteredFieldTurn: 0,
        enteredTurn: 0,
      });

      // 5-2. 兵士プリセット (RulePackage の eligibleAsPresetSoldier 属性を持つ Component に適合するか検証)
      let soldierPlaced = false;
      while (!soldierPlaced) {
        if (player.life.length === 0) {
          // 公式ルール上の敗北（技術的エラーではない）
          const winner = getOpponentPlayerKey(playerKey, state);
          return {
            type: "TERMINAL",
            winner,
            loser: playerKey,
            reason: `プリセット兵士配置中に ${player.name} のライフが枯渇しました`,
          };
        }

        const candidateCard = player.life.shift();
        const matchedComp = this.findMatchingPresetSoldierComponent(candidateCard, rulePackage.components);

        if (matchedComp) {
          const kind = matchedComp.display?.kind || matchedComp.name || "兵士";
          const labels = matchedComp.properties?.labels || matchedComp.display?.labels || ["攻撃", "防御"];

          player.field.push({
            unitId: `soldier-${playerKey}-preset`,
            kind,
            componentId: matchedComp.id,
            state: "charge",
            face: "up",
            cards: [candidateCard],
            labels: [...labels],
            enteredFieldBeforeGame: true,
            enteredFieldTurn: 0,
            enteredTurn: 0,
          });
          soldierPlaced = true;
        } else {
          // 不適格カードは墓地へ送り再試行
          player.grave.push({
            unitId: `unit-preset-discard-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            kind: "墓地カード",
            cards: [candidateCard],
            labels: [],
          });
        }
      }
    }

    // 6. 先攻決定 (3.9.2: 両者 Life 先頭を比較、タイ時は再試行、公開カードはすべて各々の墓地へ)
    let firstPlayer: PlayerKey | null = null;
    const p1Discarded: InGameCard[] = [];
    const p2Discarded: InGameCard[] = [];

    while (!firstPlayer) {
      if (p1.life.length === 0 && p2.life.length === 0) {
        return {
          type: "TERMINAL",
          winner: "p1",
          loser: "p2",
          reason: "先攻決定中に双方のライフが枯渇しました",
        };
      }
      if (p1.life.length === 0) {
        return {
          type: "TERMINAL",
          winner: "p2",
          loser: "p1",
          reason: `先攻決定中に ${p1.name} のライフが枯渇しました`,
        };
      }
      if (p2.life.length === 0) {
        return {
          type: "TERMINAL",
          winner: "p1",
          loser: "p2",
          reason: `先攻決定中に ${p2.name} のライフが枯渇しました`,
        };
      }

      const p1Card = p1.life.shift();
      const p2Card = p2.life.shift();

      p1Discarded.push(p1Card);
      p2Discarded.push(p2Card);

      const p1Val = p1Card.value !== undefined ? p1Card.value : rankToValue(p1Card.rank);
      const p2Val = p2Card.value !== undefined ? p2Card.value : rankToValue(p2Card.rank);

      if (p1Val > p2Val) {
        firstPlayer = "p1";
      } else if (p2Val > p1Val) {
        firstPlayer = "p2";
      }
    }

    // 公開カードをすべて Grave へ
    for (const c of p1Discarded) {
      p1.grave.push({
        unitId: `unit-first-draw-${c.id}`,
        kind: "墓地カード",
        cards: [c],
        labels: [],
      });
    }
    for (const c of p2Discarded) {
      p2.grave.push({
        unitId: `unit-first-draw-${c.id}`,
        kind: "墓地カード",
        cards: [c],
        labels: [],
      });
    }

    // 7. ゲーム開始 (3.9.3: 先攻プレイヤーは Life 先頭から 1枚引いて Hand へ)
    const firstPlayerObj = state.players[firstPlayer];
    if (firstPlayerObj.life.length > 0) {
      firstPlayerObj.hand.push(firstPlayerObj.life.shift());
    }

    state.turnPlayer = firstPlayer;
    state.chancePlayer = firstPlayer;
    state.nonTurnPlayer = getOpponentPlayerKey(firstPlayer, state);
    state.turnCount = 1;
    state.actionCount = 0;
    state.turnUsage = {};

    // 8. カード保存則検証
    this.verifyCardConservation("p1", p1, frame.deck.cards);
    this.verifyCardConservation("p2", p2, frame.deck.cards);

    return {
      type: "READY",
      state,
      firstPlayer,
    };
  }

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
