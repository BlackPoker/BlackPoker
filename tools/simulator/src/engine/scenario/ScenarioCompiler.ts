import {
  ScenarioDefinitionV1,
  ScenarioPlayerV1,
  ScenarioUnitV1,
  ScenarioCardRefV1,
  ScenarioValidationError,
  ScenarioValidationErrorCode,
  ScenarioValidationResult,
  SCENARIO_SCHEMA_VERSION,
  parseScenarioDefinitionV1,
  normalizeScenarioDefinitionV1,
} from "../../domain/scenario/ScenarioTypes";
import { RegulationCatalog, CardDefinition } from "../../domain/regulation/RegulationDefinition";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../session/GameSession";
import { RegulationValidator } from "../regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../regulation/RegulationRulePackageSelector";
import { SimulatorDeckProfileResolver } from "../regulation/SimulatorDeckProfileResolver";
import {
  extractRegulationId,
  isOfficialEnvironment,
} from "../playtest/PlaytestEnvironmentController";
import { SeededRandom } from "../random/RandomSource";
import { deriveSeed, shuffleCards } from "../random/DeterministicShuffle";
import { verifyCardConservation, InGameCard } from "../regulation/OfficialRegulationMatchSetup";
import { getOpponentPlayerKey } from "../rules/playerUtils";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import {
  validateUnitAgainstComponentDefinition,
  validatePlaytestPreset,
} from "../session/playtest/validatePlaytestPreset";

export interface ScenarioCompilerOptions {
  readonly playerNames?: {
    readonly p1?: string;
    readonly p2?: string;
  };
  readonly matchId?: string;
}

export type ScenarioCompileOutcome =
  | {
      readonly type: "READY";
      readonly kind: "READY";
      readonly state: any;
      readonly session: GameSession;
      readonly rulePackage: RulePackage;
      readonly matchId: string;
      readonly definitionHash: string;
    }
  | {
      readonly type: "VALIDATION_ERROR";
      readonly kind: "VALIDATION_ERROR";
      readonly errors: readonly ScenarioValidationError[];
    };

export interface PhysicalCardTemplate {
  readonly physicalIndex: number;
  readonly suit: "S" | "H" | "D" | "C" | "J";
  readonly rank: string;
  readonly value: number;
  readonly occurrence: number;
}

/**
 * オブジェクトのキーをアルファベット順にソートして決定論的に文字列化します。
 */
export function canonicalJsonSerialize(value: any): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonSerialize(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonSerialize(value[key])}`);
  return `{${pairs.join(",")}}`;
}

/**
 * ブラウザ / Node.js 双方で完全に同一のハッシュを出力する 32-bit FNV-1a ハッシュ関数。
 */
export function stableFnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Canonical Deck Profile から物理カードテンプレートを展開します。
 */
export function expandDeckPhysicalTemplates(cards: readonly CardDefinition[]): PhysicalCardTemplate[] {
  const occurrenceTracker = new Map<string, number>();
  const templates: PhysicalCardTemplate[] = [];

  for (let idx = 0; idx < cards.length; idx++) {
    const c = cards[idx];
    const key = `${c.suit}-${c.rank}`;
    const occurrence = occurrenceTracker.get(key) ?? 0;
    occurrenceTracker.set(key, occurrence + 1);

    templates.push({
      physicalIndex: idx,
      suit: c.suit,
      rank: c.rank,
      value: c.value,
      occurrence,
    });
  }

  return templates;
}

/**
 * Scenario Compiler
 *
 * 高レベルシナリオ定義（ScenarioDefinitionV1）を検証し、
 * Canonical Regulation / Frame / Deck Profile に基づき
 * 決定論的な初期 GameState および GameSession を構築します。
 */
export class ScenarioCompiler {
  /**
   * ScenarioDefinitionV1 を静的検証します。
   */
  public static validateDefinition(
    definition: ScenarioDefinitionV1,
    catalog: RegulationCatalog
  ): ScenarioValidationResult {
    const parseResult = parseScenarioDefinitionV1(definition);
    if (!parseResult.success) {
      return {
        valid: false,
        errors: parseResult.errors,
      };
    }

    const errors: ScenarioValidationError[] = [];
    const regId = extractRegulationId(definition.environmentId);
    if (!regId) {
      errors.push({
        code: "UNSUPPORTED_ENVIRONMENT",
        path: "environmentId",
        message: `不正な環境ID形式です: "${definition.environmentId}"。"official:<regulationId>" 形式で指定してください。`,
      });
    } else {
      const regValidation = RegulationValidator.validateRegulation(catalog, regId);
      if (!regValidation.ruleLegal || !regValidation.simulatorImplemented) {
        errors.push({
          code: "UNSUPPORTED_ENVIRONMENT",
          path: "environmentId",
          message: `レギュレーション "${regId}" は未実装またはカタログに存在しません。`,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * ScenarioDefinitionV1 をコンパイルし、GameSession を生成します。
   */
  public static compile(
    definition: ScenarioDefinitionV1,
    catalog: RegulationCatalog,
    fullRulePackage: RulePackage,
    options?: ScenarioCompilerOptions
  ): ScenarioCompileOutcome {
    // 1. 静的バリデーション
    const staticValidation = this.validateDefinition(definition, catalog);
    if (!staticValidation.valid) {
      return {
        type: "VALIDATION_ERROR",
        kind: "VALIDATION_ERROR",
        errors: staticValidation.errors,
      };
    }

    const errors: ScenarioValidationError[] = [];
    const regId = extractRegulationId(definition.environmentId)!;
    const regValidation = RegulationValidator.validateRegulation(catalog, regId, {
      assertImplemented: true,
    });

    const regulation = regValidation.regulation!;
    const format = regValidation.format!;
    const frame = regValidation.frame!;

    // 公式ルールパッケージ解決
    const officialRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      format,
      regulation,
      frame
    );

    // デッキプロファイル解決 (SSOT)
    const deckProfile = SimulatorDeckProfileResolver.resolveDeckProfile(frame, regulation.id);
    const physicalTemplates = expandDeckPhysicalTemplates(deckProfile.cards);

    // 各カード (suit-rank) の総出現数マップ
    const multisetTotalCount = new Map<string, number>();
    for (const t of physicalTemplates) {
      const key = `${t.suit}-${t.rank}`;
      multisetTotalCount.set(key, (multisetTotalCount.get(key) ?? 0) + 1);
    }

    // 決定論的 definitionHash と matchId の導出 (正規化済み定義を使用)
    const normalizedDef = normalizeScenarioDefinitionV1(definition);
    const canonicalStr = canonicalJsonSerialize(normalizedDef);
    const definitionHash = stableFnv1a32Hex(canonicalStr);
    const matchId =
      options?.matchId || `match-scenario-${regulation.id}-${normalizedDef.seed}-${definitionHash}`;

    const p1Name = options?.playerNames?.p1 || "Player A";
    const p2Name = options?.playerNames?.p2 || "Player B";

    const frameHasPack = typeof frame.setup.packCount === "number" && frame.setup.packCount > 0;

    // プレイヤーごとのカード解決・配置
    const compiledPlayers: { p1?: any; p2?: any } = {};

    for (const playerKey of ["p1", "p2"] as const) {
      const scenarioPlayer = normalizedDef.players[playerKey] || {};
      const allocatedPhysicalIndices = new Set<number>();

      const resolveCardRef = (
        ref: ScenarioCardRefV1,
        path: string
      ): InGameCard | null => {
        if (!ref || typeof ref !== "object") {
          errors.push({
            code: "INVALID_CARD_REF",
            path,
            message: "カード参照がオブジェクトではありません。",
          });
          return null;
        }

        const validSuits = ["S", "H", "D", "C", "J"];
        if (!validSuits.includes(ref.suit)) {
          errors.push({
            code: "INVALID_CARD_REF",
            path: `${path}.suit`,
            message: `無効なスート記号です: "${ref.suit}" (有効値: ${validSuits.join(", ")})。`,
          });
          return null;
        }

        const candidates = physicalTemplates.filter(
          (t) => t.suit === ref.suit && t.rank === ref.rank
        );

        if (candidates.length === 0) {
          errors.push({
            code: "INVALID_CARD_REF",
            path,
            message: `カード "${ref.suit}${ref.rank}" はレギュレーション "${regulation.id}" のデッキに存在しません。`,
          });
          return null;
        }

        let matchedTemplate: PhysicalCardTemplate | undefined;
        if (candidates.length > 1) {
          if (ref.occurrence === undefined) {
            errors.push({
              code: "AMBIGUOUS_CARD_REFERENCE",
              path,
              message: `カード "${ref.suit}${ref.rank}" はデッキ内に ${candidates.length} 枚存在するため、occurrence (0-indexed) を明示指定してください。`,
            });
            return null;
          }
          matchedTemplate = candidates.find((c) => c.occurrence === ref.occurrence);
          if (!matchedTemplate) {
            errors.push({
              code: "INVALID_CARD_REF",
              path: `${path}.occurrence`,
              message: `カード "${ref.suit}${ref.rank}" の occurrence ${ref.occurrence} は存在しません (最大: ${candidates.length - 1})。`,
            });
            return null;
          }
        } else {
          // ユニークカードの場合、occurrence 省略時は 0、指定時は 0 のみ合致
          if (ref.occurrence !== undefined && ref.occurrence !== 0) {
            errors.push({
              code: "INVALID_CARD_REF",
              path: `${path}.occurrence`,
              message: `カード "${ref.suit}${ref.rank}" はデッキ内に 1 枚のみ存在します (指定された occurrence: ${ref.occurrence})。`,
            });
            return null;
          }
          matchedTemplate = candidates[0];
        }

        if (allocatedPhysicalIndices.has(matchedTemplate.physicalIndex)) {
          errors.push({
            code: "DUPLICATE_CARD",
            path,
            message: `物理カード "${ref.suit}${ref.rank}" (index: ${matchedTemplate.physicalIndex}) は同一プレイヤー内で既に別の領域に配置されています。`,
          });
          return null;
        }

        allocatedPhysicalIndices.add(matchedTemplate.physicalIndex);
        return {
          id: `${playerKey}-card-${matchedTemplate.physicalIndex}`,
          suit: matchedTemplate.suit,
          rank: matchedTemplate.rank,
          value: matchedTemplate.value,
        };
      };

      // ========================================================
      // STEP 1: すべての明示指定カードの物理予約 (2-Step Allocation)
      // ========================================================

      // 1. フィールドユニット配置
      const fieldUnits: any[] = [];
      if (scenarioPlayer.field) {
        if (!Array.isArray(scenarioPlayer.field)) {
          errors.push({
            code: "SCHEMA_VIOLATION",
            path: `players.${playerKey}.field`,
            message: "field は配列でなければなりません。",
          });
        } else {
          for (let uIdx = 0; uIdx < scenarioPlayer.field.length; uIdx++) {
            const u = scenarioPlayer.field[uIdx];
            const uPath = `players.${playerKey}.field[${uIdx}]`;

            const compDef = officialRulePackage.components.find((c) => c.id === u.componentId);
            if (!compDef) {
              errors.push({
                code: "UNSUPPORTED_COMPONENT",
                path: `${uPath}.componentId`,
                message: `コンポーネント "${u.componentId}" は現在のルールパッケージに存在しません。`,
              });
              continue;
            }

            if (compDef.zone !== "field") {
              errors.push({
                code: "UNSUPPORTED_COMPONENT",
                path: `${uPath}.componentId`,
                message: `コンポーネント "${u.componentId}" は field 配置可能なコンポーネントではありません (定義zone: "${compDef.zone}")。`,
              });
              continue;
            }

            if (!Array.isArray(u.cards) || u.cards.length === 0) {
              errors.push({
                code: "SCHEMA_VIOLATION",
                path: `${uPath}.cards`,
                message: "ユニットには少なくとも1枚のカード (cards) を指定する必要があります。",
              });
              continue;
            }

            const resolvedCards: InGameCard[] = [];
            for (let cIdx = 0; cIdx < u.cards.length; cIdx++) {
              const card = resolveCardRef(u.cards[cIdx], `${uPath}.cards[${cIdx}]`);
              if (card) resolvedCards.push(card);
            }

            const kind = compDef.display?.kind || compDef.name || "ユニット";
            const labels = compDef.properties?.labels || compDef.display?.labels || [];
            const unitFace = u.face;
            const unitState = u.state;

            const unitValidationErrors = validateUnitAgainstComponentDefinition(
              {
                unitId: `unit-${playerKey}-${compDef.id}-${uIdx}`,
                componentId: compDef.id,
                cards: resolvedCards,
                state: unitState,
                face: unitFace,
                kind,
              },
              compDef,
              { playerKey, unitIndex: uIdx }
            );

            for (const vErr of unitValidationErrors) {
              let code: ScenarioValidationErrorCode = "UNSUPPORTED_COMPONENT";
              if (vErr.includes("state") || vErr.includes("状態")) code = "INVALID_UNIT_STATE";
              else if (vErr.includes("face") || vErr.includes("向き")) code = "INVALID_UNIT_FACE";
              errors.push({
                code,
                path: uPath,
                message: vErr,
              });
            }

            fieldUnits.push({
              unitId: `unit-${playerKey}-${compDef.id}-${uIdx}`,
              componentId: compDef.id,
              kind,
              state: unitState,
              face: unitFace,
              cards: resolvedCards,
              labels: [...labels],
              enteredFieldBeforeGame: true,
              enteredFieldTurn: 0,
              enteredTurn: 0,
            });
          }
        }
      }

      // 2. 手札配置
      const handCards: InGameCard[] = [];
      if (scenarioPlayer.hand) {
        if (!Array.isArray(scenarioPlayer.hand)) {
          errors.push({
            code: "SCHEMA_VIOLATION",
            path: `players.${playerKey}.hand`,
            message: "hand は配列でなければなりません。",
          });
        } else {
          for (let hIdx = 0; hIdx < scenarioPlayer.hand.length; hIdx++) {
            const c = resolveCardRef(scenarioPlayer.hand[hIdx], `players.${playerKey}.hand[${hIdx}]`);
            if (c) handCards.push(c);
          }
        }
      }

      // 3. 墓地配置 (配列末尾が墓地TOP)
      const graveUnits: any[] = [];
      let graveTopCardId: string | undefined = undefined;
      if (scenarioPlayer.grave) {
        if (!Array.isArray(scenarioPlayer.grave)) {
          errors.push({
            code: "SCHEMA_VIOLATION",
            path: `players.${playerKey}.grave`,
            message: "grave は配列でなければなりません。",
          });
        } else {
          for (let gIdx = 0; gIdx < scenarioPlayer.grave.length; gIdx++) {
            const c = resolveCardRef(scenarioPlayer.grave[gIdx], `players.${playerKey}.grave[${gIdx}]`);
            if (c) {
              graveUnits.push({
                unitId: `unit-grave-${playerKey}-${c.id}-${gIdx}`,
                id: c.id,
                suit: c.suit,
                rank: c.rank,
                value: c.value,
                cards: [c],
                kind: "墓地カード",
                labels: [],
              });
              graveTopCardId = c.id;
            }
          }
        }
      }

      // 4. Pack 明示指定カードの事前予約
      const packConfig = scenarioPlayer.pack;
      const packCards: InGameCard[] = [];

      if (packConfig) {
        if (!frameHasPack && ((packConfig.count !== undefined && packConfig.count > 0) || (packConfig.cards && packConfig.cards.length > 0))) {
          errors.push({
            code: "INVALID_ZONE_CONFIG",
            path: `players.${playerKey}.pack`,
            message: `レギュレーション "${regulation.id}" のフレーム "${frame.id}" には山札 (Pack) が存在しないため、pack を指定することはできません。`,
          });
        }
        if (packConfig.cards) {
          for (let pIdx = 0; pIdx < packConfig.cards.length; pIdx++) {
            const c = resolveCardRef(packConfig.cards[pIdx], `players.${playerKey}.pack.cards[${pIdx}]`);
            if (c) packCards.push(c);
          }
        }
      }

      // 5. Life 明示指定カードの事前予約
      const lifeConfig = scenarioPlayer.life;
      const lifeCards: InGameCard[] = [];

      if (lifeConfig?.cards) {
        for (let lIdx = 0; lIdx < lifeConfig.cards.length; lIdx++) {
          const c = resolveCardRef(lifeConfig.cards[lIdx], `players.${playerKey}.life.cards[${lIdx}]`);
          if (c) lifeCards.push(c);
        }
      }

      // ========================================================
      // STEP 2: 残り物理プール収集と決定論的補完
      // ========================================================
      const remainingTemplates = physicalTemplates.filter(
        (t) => !allocatedPhysicalIndices.has(t.physicalIndex)
      );

      // 決定論的シャッフル (プレイヤー独立ストリーム)
      const playerCompletionRng = new SeededRandom(
        deriveSeed(normalizedDef.seed, `${playerKey}-scenario-completion`)
      );
      const shuffledRemainingCards: InGameCard[] = shuffleCards(
        remainingTemplates.map((t) => ({
          id: `${playerKey}-card-${t.physicalIndex}`,
          suit: t.suit,
          rank: t.rank,
          value: t.value,
        })),
        playerCompletionRng
      );

      // Pack 不足分の補完
      let targetPackCount: number | undefined = undefined;
      if (frameHasPack) {
        if (packConfig) {
          if (packConfig.count !== undefined) {
            if (packConfig.count < packCards.length) {
              errors.push({
                code: "INVALID_ZONE_CONFIG",
                path: `players.${playerKey}.pack.count`,
                message: `pack の目標枚数 (${packConfig.count}) は指定された固定カード枚数 (${packCards.length}) 以上でなければなりません。`,
              });
            }
            targetPackCount = packConfig.count;
          } else {
            targetPackCount = packCards.length;
          }
        } else {
          // デフォルトで Frame の packCount 枚を割り当て
          targetPackCount = frame.setup.packCount;
        }
      } else {
        targetPackCount = 0;
      }

      const neededForPack = (targetPackCount ?? 0) - packCards.length;
      if (neededForPack > 0) {
        if (shuffledRemainingCards.length < neededForPack) {
          errors.push({
            code: "DECK_COMPLETION_IMPOSSIBLE",
            path: `players.${playerKey}.pack`,
            message: `Pack を補完するための残りカードが不足しています (必要: ${neededForPack}, 残り: ${shuffledRemainingCards.length})。`,
          });
        } else {
          packCards.push(...shuffledRemainingCards.splice(0, neededForPack));
        }
      }

      // Life 不足分の補完
      let targetLifeCount: number | undefined = undefined;
      if (lifeConfig) {
        if (lifeConfig.count !== undefined) {
          if (lifeConfig.count < lifeCards.length) {
            errors.push({
              code: "INVALID_ZONE_CONFIG",
              path: `players.${playerKey}.life.count`,
              message: `life の目標枚数 (${lifeConfig.count}) は指定された固定カード枚数 (${lifeCards.length}) 以上でなければなりません。`,
            });
          }
          targetLifeCount = lifeConfig.count;
        }
      }

      if (targetLifeCount !== undefined) {
        const neededForLife = targetLifeCount - lifeCards.length;
        if (neededForLife > 0) {
          if (shuffledRemainingCards.length < neededForLife) {
            errors.push({
              code: "DECK_COMPLETION_IMPOSSIBLE",
              path: `players.${playerKey}.life`,
              message: `Life を補完するための残りカードが不足しています (必要: ${neededForLife}, 残り: ${shuffledRemainingCards.length})。`,
            });
          } else {
            lifeCards.push(...shuffledRemainingCards.splice(0, neededForLife));
          }
        }
        // count 明示時に余剰カードが残っている場合は配置不能として拒絶
        if (shuffledRemainingCards.length > 0) {
          errors.push({
            code: "DECK_COMPLETION_IMPOSSIBLE",
            path: `players.${playerKey}`,
            message: `すべての物理カードがいずれかのZoneに配置されなければなりません。余剰カードが ${shuffledRemainingCards.length} 枚存在します。`,
          });
        }
      } else {
        // targetLifeCount 省略時は、残りの全カードを Life に割り当て
        lifeCards.push(...shuffledRemainingCards);
      }

      // Pack オブジェクトの構成
      let packObj: any = undefined;
      if (frameHasPack || packCards.length > 0) {
        packObj = {
          count: packCards.length,
          opened: false,
          cards: packCards,
        };
      }

      compiledPlayers[playerKey] = {
        name: playerKey === "p1" ? p1Name : p2Name,
        life: lifeCards,
        hand: handCards,
        field: fieldUnits,
        grave: graveUnits,
        graveTopCardId,
        fog: [],
        trump: [],
        pack: packObj,
      };

      // カード保存則検証
      if (errors.length === 0) {
        try {
          verifyCardConservation(playerKey, compiledPlayers[playerKey], deckProfile.cards);
        } catch (err: any) {
          errors.push({
            code: "DECK_COMPLETION_IMPOSSIBLE",
            path: `players.${playerKey}`,
            message: err.message,
          });
        }
      }
    }

    if (errors.length > 0) {
      return {
        type: "VALIDATION_ERROR",
        kind: "VALIDATION_ERROR",
        errors,
      };
    }

    // Canonical GameState の正規化構築
    const nonTurnPlayer: PlayerKey = normalizedDef.turnPlayer === "p1" ? "p2" : "p1";
    const state: any = {
      stateVersion: 1,
      version: 1,
      matchId,
      regulationId: regulation.id,
      formatId: regulation.formatId,
      frameId: regulation.frameId,
      turnPlayer: normalizedDef.turnPlayer,
      chancePlayer: normalizedDef.chancePlayer,
      nonTurnPlayer,
      turnCount: normalizedDef.turnCount,
      actionCount: 0,
      turnUsage: {},
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
      pendingGraveTopSelections: [],
      players: {
        p1: compiledPlayers.p1,
        p2: compiledPlayers.p2,
      },
    };

    // 最終 Preset 検証
    const presetValidation = validatePlaytestPreset(state, officialRulePackage);
    if (!presetValidation.valid) {
      return {
        type: "VALIDATION_ERROR",
        kind: "VALIDATION_ERROR",
        errors: presetValidation.errors.map((msg) => ({
          code: "VALIDATION_ERROR",
          path: "state",
          message: msg,
        })),
      };
    }

    const session = new GameSession(state, officialRulePackage, {
      matchId,
      matchSeed: normalizedDef.seed,
    });

    return {
      type: "READY",
      kind: "READY",
      state,
      session,
      rulePackage: officialRulePackage,
      matchId,
      definitionHash,
    };
  }
}

/**
 * ScenarioDefinitionV1 をコンパイルし、GameSession を生成するスタンドアロン関数
 */
export function compileScenarioDefinitionV1(
  definition: ScenarioDefinitionV1,
  catalog: RegulationCatalog,
  fullRulePackage: RulePackage,
  options?: ScenarioCompilerOptions
): ScenarioCompileOutcome {
  return ScenarioCompiler.compile(definition, catalog, fullRulePackage, options);
}

/**
 * ScenarioDefinitionV1 を静的検証するスタンドアロン関数
 */
export function validateScenarioDefinitionV1(
  definition: ScenarioDefinitionV1,
  catalog: RegulationCatalog
): ScenarioValidationResult {
  return ScenarioCompiler.validateDefinition(definition, catalog);
}

