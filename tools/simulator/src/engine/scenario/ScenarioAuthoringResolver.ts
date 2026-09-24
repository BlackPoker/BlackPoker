import {
  ScenarioDefinitionV1,
  ScenarioPlayerV1,
  ScenarioUnitV1,
  ScenarioCardRefV1,
  ScenarioZoneConfigV1,
  ScenarioValidationError,
  ScenarioValidationErrorCode,
  SCENARIO_SCHEMA_VERSION,
} from "../../domain/scenario/ScenarioTypes";
import {
  ScenarioAuthoringDraftV1,
  ScenarioAuthoringPlayerDraftV1,
  ScenarioAuthoringHandDraftV1,
  ScenarioAuthoringGraveDraftV1,
  ScenarioAuthoringResult,
} from "../../domain/scenario/ScenarioAuthoringTypes";
import { RegulationCatalog } from "../../domain/regulation/RegulationDefinition";
import { RegulationValidator } from "../regulation/RegulationValidator";
import { SimulatorDeckProfileResolver } from "../regulation/SimulatorDeckProfileResolver";
import { extractRegulationId } from "../playtest/PlaytestEnvironmentController";
import { SeededRandom } from "../random/RandomSource";
import { deriveSeed, shuffleCards } from "../random/DeterministicShuffle";
import {
  PhysicalCardTemplate,
  expandDeckPhysicalTemplates,
} from "./ScenarioCompiler";

/**
 * Scenario Authoring Resolver
 *
 * 部分指定（ドラフト）から決定論的かつCanonicalな ScenarioDefinitionV1 を構築・補完します。
 * - 手札・ライフ・フィールド・パック・墓地の明示指定カードを最優先で物理予約
 * - Joker等の多重コピーカードの occurrence を自動導出
 * - 手札不足分 -> パック不足分 -> ライフ不足分 の順に決定論的シャッフルプールから自動補完
 * - ライフ枚数指定時は残余カードをすべて墓地へ割り当て（保存則充足）
 * - ライフ枚数未指定時は残余カードのすべてをライフへ割り当て
 */
export class ScenarioAuthoringResolver {
  public static resolve(
    draft: ScenarioAuthoringDraftV1,
    catalog: RegulationCatalog
  ): ScenarioAuthoringResult {
    const errors: ScenarioValidationError[] = [];

    // 1. 環境IDの検証
    if (!draft.environmentId || typeof draft.environmentId !== "string") {
      errors.push({
        code: "UNSUPPORTED_ENVIRONMENT",
        path: "environmentId",
        message: "環境IDが指定されていません。",
      });
      return { success: false, errors };
    }

    const regId = extractRegulationId(draft.environmentId);
    if (!regId) {
      errors.push({
        code: "UNSUPPORTED_ENVIRONMENT",
        path: "environmentId",
        message: `不正な環境ID形式です: "${draft.environmentId}"。"official:<regulationId>" 形式で指定してください。`,
      });
      return { success: false, errors };
    }

    const regValidation = RegulationValidator.validateRegulation(catalog, regId, {
      assertImplemented: true,
    });
    if (!regValidation.ruleLegal || !regValidation.simulatorImplemented || !regValidation.regulation || !regValidation.frame) {
      errors.push({
        code: "UNSUPPORTED_ENVIRONMENT",
        path: "environmentId",
        message: `レギュレーション "${regId}" は未実装またはカタログに存在しません。`,
      });
      return { success: false, errors };
    }

    const regulation = regValidation.regulation;
    const frame = regValidation.frame;
    const frameHasPack = typeof frame.setup.packCount === "number" && frame.setup.packCount > 0;

    // 2. メタデータの検証
    if (typeof draft.seed !== "number" || !Number.isInteger(draft.seed) || draft.seed < 0) {
      errors.push({
        code: "INVALID_SEED",
        path: "seed",
        message: "seed は 0 以上の整数でなければなりません。",
      });
    }

    if (draft.turnPlayer !== "p1" && draft.turnPlayer !== "p2") {
      errors.push({
        code: "INVALID_PLAYER",
        path: "turnPlayer",
        message: `turnPlayer は "p1" または "p2" でなければなりません: "${draft.turnPlayer}"`,
      });
    }

    if (draft.chancePlayer !== "p1" && draft.chancePlayer !== "p2") {
      errors.push({
        code: "INVALID_PLAYER",
        path: "chancePlayer",
        message: `chancePlayer は "p1" または "p2" でなければなりません: "${draft.chancePlayer}"`,
      });
    }

    if (draft.turnCount !== undefined && (typeof draft.turnCount !== "number" || !Number.isInteger(draft.turnCount) || draft.turnCount < 1)) {
      errors.push({
        code: "SCHEMA_VIOLATION",
        path: "turnCount",
        message: "turnCount は 1 以上の整数でなければなりません。",
      });
    }

    if (!draft.players || typeof draft.players !== "object") {
      errors.push({
        code: "SCHEMA_VIOLATION",
        path: "players",
        message: "players オブジェクトが指定されていません。",
      });
      return { success: false, errors };
    }

    // 3. デッキプロファイルおよび物理カードテンプレート展開 (SSOT)
    const deckProfile = SimulatorDeckProfileResolver.resolveDeckProfile(frame, regulation.id);
    const physicalTemplates = expandDeckPhysicalTemplates(deckProfile.cards);

    // 各カード (suit-rank) の総出現数マップ
    const multisetTotalCount = new Map<string, number>();
    for (const t of physicalTemplates) {
      const key = `${t.suit}-${t.rank}`;
      multisetTotalCount.set(key, (multisetTotalCount.get(key) ?? 0) + 1);
    }

    const resolvedPlayers: { p1?: ScenarioPlayerV1; p2?: ScenarioPlayerV1 } = {};

    // 4. プレイヤーごとの解決 (P1, P2 独立)
    for (const playerKey of ["p1", "p2"] as const) {
      const playerDraft: ScenarioAuthoringPlayerDraftV1 = draft.players[playerKey] || {};
      const allocatedPhysicalIndices = new Set<number>();
      const allocatedOccurrences = new Map<string, Set<number>>();

      /**
       * PhysicalCardTemplate から ScenarioCardRefV1 を生成
       * デッキ内に同一 (suit, rank) が2枚以上存在する場合のみ occurrence を付与
       */
      const toCardRef = (t: PhysicalCardTemplate): ScenarioCardRefV1 => {
        const key = `${t.suit}-${t.rank}`;
        const total = multisetTotalCount.get(key) ?? 1;
        if (total > 1) {
          return { suit: t.suit, rank: t.rank, occurrence: t.occurrence };
        }
        return { suit: t.suit, rank: t.rank };
      };

      /**
       * ユーザー指定の ScenarioCardRefV1 を物理テンプレートへ解決
       * occurrence が省略されている場合は未使用の最小 occurrence を貪欲に自動導出
       */
      const resolveCardRef = (
        ref: ScenarioCardRefV1,
        path: string
      ): PhysicalCardTemplate | null => {
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

        const key = `${ref.suit}-${ref.rank}`;
        const usedOcc = allocatedOccurrences.get(key) ?? new Set<number>();

        let matchedTemplate: PhysicalCardTemplate | undefined;

        if (ref.occurrence !== undefined) {
          if (ref.occurrence < 0 || ref.occurrence >= candidates.length) {
            errors.push({
              code: "INVALID_CARD_REF",
              path: `${path}.occurrence`,
              message: `カード "${ref.suit}${ref.rank}" の occurrence ${ref.occurrence} は存在しません (最大: ${candidates.length - 1})。`,
            });
            return null;
          }
          if (usedOcc.has(ref.occurrence)) {
            errors.push({
              code: "DUPLICATE_CARD",
              path,
              message: `物理カード "${ref.suit}${ref.rank}" (occurrence: ${ref.occurrence}) は同一プレイヤー内で既に別の領域に配置されています。`,
            });
            return null;
          }
          matchedTemplate = candidates.find((c) => c.occurrence === ref.occurrence);
        } else {
          // occurrence 省略時は、未配置の最小 occurrence を自動選択
          matchedTemplate = candidates.find((c) => !usedOcc.has(c.occurrence));
          if (!matchedTemplate) {
            errors.push({
              code: "DUPLICATE_CARD",
              path,
              message: `カード "${ref.suit}${ref.rank}" の全物理カード (${candidates.length}枚) は同一プレイヤー内で既に割り当てられています。`,
            });
            return null;
          }
        }

        if (!matchedTemplate) {
          errors.push({
            code: "INVALID_CARD_REF",
            path,
            message: `物理カード "${ref.suit}${ref.rank}" を特定できませんでした。`,
          });
          return null;
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
        if (!allocatedOccurrences.has(key)) {
          allocatedOccurrences.set(key, new Set<number>());
        }
        allocatedOccurrences.get(key)!.add(matchedTemplate.occurrence);

        return matchedTemplate;
      };

      // ========================================================
      // STEP 1: すべての固定・明示指定カードの事前物理予約
      // ========================================================

      // 1. フィールドユニット予約
      const resolvedFieldUnits: ScenarioUnitV1[] = [];
      if (playerDraft.field) {
        if (!Array.isArray(playerDraft.field)) {
          errors.push({
            code: "SCHEMA_VIOLATION",
            path: `players.${playerKey}.field`,
            message: "field は配列でなければなりません。",
          });
        } else {
          for (let uIdx = 0; uIdx < playerDraft.field.length; uIdx++) {
            const u = playerDraft.field[uIdx];
            const uPath = `players.${playerKey}.field[${uIdx}]`;
            if (!Array.isArray(u.cards) || u.cards.length === 0) {
              errors.push({
                code: "SCHEMA_VIOLATION",
                path: `${uPath}.cards`,
                message: "ユニットには少なくとも1枚のカード (cards) を指定する必要があります。",
              });
              continue;
            }

            const unitCardRefs: ScenarioCardRefV1[] = [];
            for (let cIdx = 0; cIdx < u.cards.length; cIdx++) {
              const tmpl = resolveCardRef(u.cards[cIdx], `${uPath}.cards[${cIdx}]`);
              if (tmpl) {
                unitCardRefs.push(toCardRef(tmpl));
              }
            }

            resolvedFieldUnits.push({
              componentId: u.componentId,
              cards: unitCardRefs,
              state: u.state,
              face: u.face,
            });
          }
        }
      }

      // 2. 手札固定カード予約
      let fixedHandRefs: readonly ScenarioCardRefV1[] = [];
      let targetHandCount: number | undefined = undefined;
      if (playerDraft.hand) {
        if (Array.isArray(playerDraft.hand)) {
          fixedHandRefs = playerDraft.hand;
        } else {
          const handObj = playerDraft.hand as ScenarioAuthoringHandDraftV1;
          fixedHandRefs = handObj.fixedCards ?? [];
          targetHandCount = handObj.count;
        }
      }

      const resolvedFixedHand: ScenarioCardRefV1[] = [];
      for (let hIdx = 0; hIdx < fixedHandRefs.length; hIdx++) {
        const tmpl = resolveCardRef(fixedHandRefs[hIdx], `players.${playerKey}.hand[${hIdx}]`);
        if (tmpl) {
          resolvedFixedHand.push(toCardRef(tmpl));
        }
      }

      // 3. 墓地明示カード予約 (配列末尾が墓地TOP)
      let explicitGraveRefs: readonly ScenarioCardRefV1[] = [];
      if (playerDraft.grave) {
        if (Array.isArray(playerDraft.grave)) {
          explicitGraveRefs = playerDraft.grave;
        } else {
          const graveObj = playerDraft.grave as ScenarioAuthoringGraveDraftV1;
          explicitGraveRefs = graveObj.explicitCards ?? [];
        }
      }

      const resolvedExplicitGrave: ScenarioCardRefV1[] = [];
      for (let gIdx = 0; gIdx < explicitGraveRefs.length; gIdx++) {
        const tmpl = resolveCardRef(explicitGraveRefs[gIdx], `players.${playerKey}.grave[${gIdx}]`);
        if (tmpl) {
          resolvedExplicitGrave.push(toCardRef(tmpl));
        }
      }

      // 4. パック固定カード予約
      let fixedPackRefs: readonly ScenarioCardRefV1[] = [];
      let targetPackCount: number | undefined = undefined;
      if (playerDraft.pack) {
        if (!frameHasPack && ((playerDraft.pack.count !== undefined && playerDraft.pack.count > 0) || ("fixedCards" in playerDraft.pack && playerDraft.pack.fixedCards && playerDraft.pack.fixedCards.length > 0) || ("cards" in playerDraft.pack && playerDraft.pack.cards && playerDraft.pack.cards.length > 0))) {
          errors.push({
            code: "INVALID_ZONE_CONFIG",
            path: `players.${playerKey}.pack`,
            message: `レギュレーション "${regulation.id}" のフレーム "${frame.id}" にはパック (Pack) が存在しないため、pack を指定することはできません。`,
          });
        }
        if ("fixedCards" in playerDraft.pack && playerDraft.pack.fixedCards) {
          fixedPackRefs = playerDraft.pack.fixedCards;
        } else if ("cards" in playerDraft.pack && playerDraft.pack.cards) {
          fixedPackRefs = playerDraft.pack.cards;
        }
        if (playerDraft.pack.count !== undefined) {
          targetPackCount = playerDraft.pack.count;
        }
      }

      const resolvedFixedPack: ScenarioCardRefV1[] = [];
      for (let pIdx = 0; pIdx < fixedPackRefs.length; pIdx++) {
        const tmpl = resolveCardRef(fixedPackRefs[pIdx], `players.${playerKey}.pack[${pIdx}]`);
        if (tmpl) {
          resolvedFixedPack.push(toCardRef(tmpl));
        }
      }

      // 5. ライフ固定カード予約 (先頭側カード)
      let fixedLifeRefs: readonly ScenarioCardRefV1[] = [];
      let targetLifeCount: number | undefined = undefined;
      if (playerDraft.life) {
        if ("fixedTopCards" in playerDraft.life && playerDraft.life.fixedTopCards) {
          fixedLifeRefs = playerDraft.life.fixedTopCards;
        } else if ("cards" in playerDraft.life && playerDraft.life.cards) {
          fixedLifeRefs = playerDraft.life.cards;
        }
        if (playerDraft.life.count !== undefined) {
          targetLifeCount = playerDraft.life.count;
        }
      }

      const resolvedFixedLifeTop: ScenarioCardRefV1[] = [];
      for (let lIdx = 0; lIdx < fixedLifeRefs.length; lIdx++) {
        const tmpl = resolveCardRef(fixedLifeRefs[lIdx], `players.${playerKey}.life[${lIdx}]`);
        if (tmpl) {
          resolvedFixedLifeTop.push(toCardRef(tmpl));
        }
      }

      // ========================================================
      // STEP 2: 残り物理プール収集と決定論的補完
      // ========================================================
      const remainingTemplates = physicalTemplates.filter(
        (t) => !allocatedPhysicalIndices.has(t.physicalIndex)
      );

      // プレイヤー独立の決定論的シャッフル
      const playerCompletionRng = new SeededRandom(
        deriveSeed(draft.seed, `${playerKey}-authoring-completion`)
      );
      const shuffledRemaining: PhysicalCardTemplate[] = shuffleCards(
        remainingTemplates,
        playerCompletionRng
      );

      // --------------------------------------------------------
      // A. 手札不足分の自動補完
      // --------------------------------------------------------
      let resolvedHand: ScenarioCardRefV1[] = [...resolvedFixedHand];
      if (targetHandCount !== undefined) {
        if (targetHandCount < resolvedFixedHand.length) {
          errors.push({
            code: "INVALID_ZONE_CONFIG",
            path: `players.${playerKey}.hand.count`,
            message: `hand の目標枚数 (${targetHandCount}) は指定された固定カード枚数 (${resolvedFixedHand.length}) 以上でなければなりません。`,
          });
        } else {
          const neededForHand = targetHandCount - resolvedFixedHand.length;
          if (neededForHand > 0) {
            if (shuffledRemaining.length < neededForHand) {
              errors.push({
                code: "DECK_COMPLETION_IMPOSSIBLE",
                path: `players.${playerKey}.hand`,
                message: `Hand を補完するための残りカードが不足しています (必要: ${neededForHand}, 残り: ${shuffledRemaining.length})。`,
              });
            } else {
              const autoHandTemplates = shuffledRemaining.splice(0, neededForHand);
              resolvedHand.push(...autoHandTemplates.map(toCardRef));
            }
          }
        }
      }

      // --------------------------------------------------------
      // B. パック不足分の自動補完
      // --------------------------------------------------------
      let resolvedPackCards: ScenarioCardRefV1[] = [...resolvedFixedPack];
      let finalPackCount: number | undefined = undefined;

      if (frameHasPack) {
        finalPackCount = targetPackCount !== undefined ? targetPackCount : frame.setup.packCount;
        if (finalPackCount < resolvedFixedPack.length) {
          errors.push({
            code: "INVALID_ZONE_CONFIG",
            path: `players.${playerKey}.pack.count`,
            message: `pack の目標枚数 (${finalPackCount}) は指定された固定カード枚数 (${resolvedFixedPack.length}) 以上でなければなりません。`,
          });
        } else {
          const neededForPack = finalPackCount - resolvedFixedPack.length;
          if (neededForPack > 0) {
            if (shuffledRemaining.length < neededForPack) {
              errors.push({
                code: "DECK_COMPLETION_IMPOSSIBLE",
                path: `players.${playerKey}.pack`,
                message: `Pack を補完するための残りカードが不足しています (必要: ${neededForPack}, 残り: ${shuffledRemaining.length})。`,
              });
            } else {
              const autoPackTemplates = shuffledRemaining.splice(0, neededForPack);
              resolvedPackCards.push(...autoPackTemplates.map(toCardRef));
            }
          }
        }
      }

      // --------------------------------------------------------
      // C. ライフ不足分および残余カードの自動補完 (Life & Remainder)
      // --------------------------------------------------------
      let resolvedLifeCards: ScenarioCardRefV1[] = [...resolvedFixedLifeTop];
      let resolvedGraveCards: ScenarioCardRefV1[] = [...resolvedExplicitGrave];
      let finalLifeCount: number | undefined = undefined;

      if (targetLifeCount !== undefined) {
        // [Case 1] ライフ枚数が明示指定されている場合:
        finalLifeCount = targetLifeCount;
        if (finalLifeCount < resolvedFixedLifeTop.length) {
          errors.push({
            code: "INVALID_ZONE_CONFIG",
            path: `players.${playerKey}.life.count`,
            message: `life の目標枚数 (${finalLifeCount}) は指定された固定カード枚数 (${resolvedFixedLifeTop.length}) 以上でなければなりません。`,
          });
        } else {
          const neededForLife = finalLifeCount - resolvedFixedLifeTop.length;
          if (neededForLife > 0) {
            if (shuffledRemaining.length < neededForLife) {
              errors.push({
                code: "DECK_COMPLETION_IMPOSSIBLE",
                path: `players.${playerKey}.life`,
                message: `Life を補完するための残りカードが不足しています (必要: ${neededForLife}, 残り: ${shuffledRemaining.length})。`,
              });
            } else {
              const autoLifeTemplates = shuffledRemaining.splice(0, neededForLife);
              resolvedLifeCards.push(...autoLifeTemplates.map(toCardRef));
            }
          }

          // 残余カードはすべて墓地へ（明示指定カードの手前に追加することで、明示カードのTOP順を保持）
          const autoGraveTemplates = shuffledRemaining.splice(0, shuffledRemaining.length);
          resolvedGraveCards = [
            ...autoGraveTemplates.map(toCardRef),
            ...resolvedExplicitGrave,
          ];
        }
      } else {
        // [Case 2] ライフ枚数が未指定の場合:
        // 残余カードのすべてをライフへ割り当てる
        const autoLifeTemplates = shuffledRemaining.splice(0, shuffledRemaining.length);
        resolvedLifeCards.push(...autoLifeTemplates.map(toCardRef));
        finalLifeCount = resolvedLifeCards.length;
        // 墓地は明示カードのみ
        resolvedGraveCards = [...resolvedExplicitGrave];
      }

      // プレイヤー定義構築
      const playerDef: ScenarioPlayerV1 = {
        ...(resolvedHand.length > 0 ? { hand: resolvedHand } : {}),
        ...(resolvedFieldUnits.length > 0 ? { field: resolvedFieldUnits } : {}),
        ...(resolvedGraveCards.length > 0 ? { grave: resolvedGraveCards } : {}),
        ...(resolvedLifeCards.length > 0 || finalLifeCount !== undefined
          ? {
              life: {
                ...(resolvedLifeCards.length > 0 ? { cards: resolvedLifeCards } : {}),
                ...(finalLifeCount !== undefined ? { count: finalLifeCount } : {}),
              },
            }
          : {}),
        ...(frameHasPack && (resolvedPackCards.length > 0 || finalPackCount !== undefined)
          ? {
              pack: {
                ...(resolvedPackCards.length > 0 ? { cards: resolvedPackCards } : {}),
                ...(finalPackCount !== undefined ? { count: finalPackCount } : {}),
              },
            }
          : {}),
      };

      resolvedPlayers[playerKey] = playerDef;
    }

    if (errors.length > 0) {
      return {
        success: false,
        errors,
      };
    }

    const definition: ScenarioDefinitionV1 = {
      version: 1,
      ...(draft.name ? { name: draft.name } : {}),
      ...(draft.description ? { description: draft.description } : {}),
      environmentId: draft.environmentId,
      seed: draft.seed,
      turnPlayer: draft.turnPlayer,
      chancePlayer: draft.chancePlayer,
      turnCount: draft.turnCount ?? 1,
      players: {
        p1: resolvedPlayers.p1 ?? {},
        p2: resolvedPlayers.p2 ?? {},
      },
    };

    return {
      success: true,
      definition,
    };
  }
}
