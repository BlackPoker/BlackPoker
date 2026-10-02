import { ComponentDefinition } from "../../domain/rules/RulePackage";
import { isCharacterComponent, getCharacterType, resolveComponentForUnit } from "./characterUtils";

export interface CharacterTransformOptions {
  readonly destination?: "opposite" | "soldier" | "bulwark" | string;
  readonly state?: "charge" | "drive" | string;
  readonly clearReceivedEffects?: boolean;
  readonly clearBattleRole?: boolean;
  readonly [key: string]: any;
}

export interface CharacterTransformParams {
  readonly targetUnit: any;
  readonly state: any;
  readonly components: readonly ComponentDefinition[];
  readonly options?: CharacterTransformOptions;
}

export interface TransformedUnitInfo {
  readonly unitId: string;
  readonly componentId: string;
  readonly characterType: string;
  readonly cardIds: readonly string[];
  readonly face: "up" | "down" | string;
  readonly state: "charge" | "drive" | string;
}

export interface CharacterTransformResult {
  readonly ownerKey: string;
  readonly sourceUnitId: string;
  readonly sourceComponentId: string;
  readonly sourceCharacterType: string;
  readonly oldState: "charge" | "drive" | string;
  readonly selectedState: "charge" | "drive" | string;
  readonly stateChanged: boolean;
  readonly results: readonly TransformedUnitInfo[];
}

/**
 * 汎用キャラクター変形基盤 (Generic Character Transform Foundation)
 * 
 * 公式ルール v9.1.2 に基づき、キャラクターの形態変形（兵士⇔防壁、複数カード兵士の分裂等）を
 * 盤面整合性を維持しながら原子的 (Atomic) に実行します。
 * 
 * 特定のアクションIDに依存せず、将来の形態変化・分裂・能力解除等にも再利用可能な設計。
 */
export class CharacterTransformService {
  /**
   * 対象キャラクターの形態を変形・置換します。
   *
   * Preflight 検証フェーズで全項目を確認し、1つでも問題がある場合は
   * 盤面を一切変更せずに fail-closed で例外をスローします。
   */
  static transformCharacter(params: CharacterTransformParams): CharacterTransformResult {
    const { targetUnit, state, components, options } = params;

    const targetUnitId = typeof targetUnit === "string" ? targetUnit : targetUnit?.unitId;
    if (!targetUnitId || typeof targetUnitId !== "string" || targetUnitId.trim() === "") {
      throw new Error("変形対象のユニットIDが指定されていないか不正です (fail-closed)。");
    }

    // =========================================================================
    // PREFLIGHT PHASE (All checks before mutation)
    // =========================================================================

    // 1. 対象ユニットおよびオーナーの特定 (CURRENT Field 存在 & グローバル一意性)
    let ownerKey: string | undefined;
    let sourceUnit: any;
    let targetIdx = -1;
    let matchCount = 0;

    for (const [pKey, player] of Object.entries<any>(state.players || {})) {
      if (!player?.field || !Array.isArray(player.field)) continue;
      const idx = player.field.findIndex((u: any) => u && u.unitId === targetUnitId);
      if (idx !== -1) {
        matchCount++;
        ownerKey = pKey;
        sourceUnit = player.field[idx];
        targetIdx = idx;
      }
    }

    if (matchCount === 0 || !sourceUnit || !ownerKey) {
      throw new Error(`変形対象のユニット [${targetUnitId}] がフィールド上に存在しません (fail-closed)。`);
    }
    if (matchCount > 1) {
      throw new Error(`重複するユニットID [${targetUnitId}] がフィールド上で検出されました (fail-closed)。`);
    }

    const targetPlayer = state.players[ownerKey];
    if (!targetPlayer || !Array.isArray(targetPlayer.field)) {
      throw new Error(`対象ユニットのオーナー '${ownerKey}' のフィールドが存在しません (fail-closed)。`);
    }

    // 2. キャラクター検証
    if (!isCharacterComponent(sourceUnit, components)) {
      throw new Error(`ユニット [${targetUnitId}] はキャラクターではありません (fail-closed)。`);
    }

    // 3. 元の characterType の特定 (兵士または防壁)
    const sourceCharType = getCharacterType(sourceUnit, components);
    if (sourceCharType !== "soldier" && sourceCharType !== "bulwark") {
      throw new Error(
        `変形対象のキャラクター種別 [${sourceCharType || "不明"}] は兵士または防壁である必要があります (fail-closed)。`
      );
    }

    // 4. 要求された State (charge / drive) の事前検証
    const oldState = sourceUnit.state;
    let requestedState = options?.state;
    if (requestedState !== undefined && requestedState !== null) {
      if (requestedState !== "charge" && requestedState !== "drive") {
        throw new Error(
          `要求されたユニット状態が不正です。期待: charge または drive, 実際: ${requestedState} (fail-closed)`
        );
      }
    } else {
      requestedState = oldState;
      if (requestedState !== "charge" && requestedState !== "drive") {
        throw new Error(`ユニットの現在の状態 [${requestedState}] が不正です (fail-closed)。`);
      }
    }
    const stateChanged = oldState !== requestedState;

    // 5. 構成カードの検証 (物理カード ID の存在・非空・一意性)
    if (!sourceUnit.cards || !Array.isArray(sourceUnit.cards) || sourceUnit.cards.length === 0) {
      throw new Error("変形対象の構成カードが存在しません (fail-closed)。");
    }

    if (sourceCharType === "bulwark" && sourceUnit.cards.length !== 1) {
      throw new Error(
        `防壁の構成カード枚数が不正です。期待: 1枚, 実際: ${sourceUnit.cards.length}枚 (fail-closed)`
      );
    }

    const sourceCardIds: string[] = [];
    const seenSourceCardIds = new Set<string>();
    for (const card of sourceUnit.cards) {
      if (!card || typeof card.id !== "string" || card.id.trim() === "") {
        throw new Error("変形対象の構成カードIDが欠落または空文字です (fail-closed)。");
      }
      if (seenSourceCardIds.has(card.id)) {
        throw new Error(`変形対象の構成カードIDに重複が存在します: '${card.id}' (fail-closed)。`);
      }
      seenSourceCardIds.add(card.id);
      sourceCardIds.push(card.id);
    }

    // 6. 変形先の決定
    const destination = options?.destination || "opposite";
    let destCharType: string;
    if (destination === "opposite") {
      destCharType = sourceCharType === "soldier" ? "bulwark" : "soldier";
    } else if (destination === "soldier" || destination === "bulwark") {
      destCharType = destination;
    } else {
      throw new Error(`未対応の変形先指定です: ${destination} (fail-closed)`);
    }

    // 7. 変形後ユニット群の事前計算 & コンポーネント一意解決 (Precompute)
    let resultingUnits: any[] = [];

    if (destCharType === "bulwark") {
      // 兵士 → 防壁
      // Generic Bulwark Resolution (Section 9):
      // 実際の1枚カード + face down + field + character から ComponentDefinition を Generic に解決
      if (sourceUnit.cards.length === 1) {
        // 1枚構成: 1対1変形 (unitId を維持)
        const card = sourceUnit.cards[0];
        const bulwarkComp = resolveComponentForUnit({
          cards: [{ ...card, face: "down" }],
          face: "down",
          zone: "field",
          components,
          componentType: "character",
        });
        const bulwarkCharType = getCharacterType({ componentId: bulwarkComp.id }, components);
        if (bulwarkCharType !== "bulwark") {
          throw new Error(`解決されたコンポーネント [${bulwarkComp.id}] の characterType が bulwark ではありません。`);
        }

        const bulwarkLabels = Array.isArray(bulwarkComp.properties?.labels)
          ? [...bulwarkComp.properties.labels]
          : ["防御"];
        const bulwarkKind = bulwarkComp.display?.kind || bulwarkComp.properties?.kind || "防壁";

        resultingUnits = [
          {
            unitId: sourceUnit.unitId,
            kind: bulwarkKind,
            componentId: bulwarkComp.id,
            state: requestedState,
            face: "down",
            cards: [{ ...card, face: "down" }],
            labels: [...bulwarkLabels],
            enteredTurn: sourceUnit.enteredTurn,
            enteredFieldTurn: sourceUnit.enteredFieldTurn,
            enteredFieldBeforeGame: sourceUnit.enteredFieldBeforeGame,
          },
        ];
      } else {
        // 2枚以上構成 (装備兵など): 各カードを1枚ずつ別個の防壁に分裂 (Split)
        // 元の unitId は消滅し、確定的な新規 unitId を各防壁に付与
        resultingUnits = sourceUnit.cards.map((c: any) => {
          const bulwarkComp = resolveComponentForUnit({
            cards: [{ ...c, face: "down" }],
            face: "down",
            zone: "field",
            components,
            componentType: "character",
          });
          const bulwarkCharType = getCharacterType({ componentId: bulwarkComp.id }, components);
          if (bulwarkCharType !== "bulwark") {
            throw new Error(`解決されたコンポーネント [${bulwarkComp.id}] の characterType が bulwark ではありません。`);
          }

          const bulwarkLabels = Array.isArray(bulwarkComp.properties?.labels)
            ? [...bulwarkComp.properties.labels]
            : ["防御"];
          const bulwarkKind = bulwarkComp.display?.kind || bulwarkComp.properties?.kind || "防壁";

          return {
            unitId: `${sourceUnit.unitId}-split-${c.id}`,
            kind: bulwarkKind,
            componentId: bulwarkComp.id,
            state: requestedState,
            face: "down",
            cards: [{ ...c, face: "down" }],
            labels: [...bulwarkLabels],
            enteredTurn: sourceUnit.enteredTurn,
            enteredFieldTurn: sourceUnit.enteredFieldTurn,
            enteredFieldBeforeGame: sourceUnit.enteredFieldBeforeGame,
          };
        });
      }
    } else {
      // 防壁 → 兵士
      const card = sourceUnit.cards[0];
      const cardUp = { ...card, face: "up" };

      // カードのランク・スート・種別から兵士コンポーネント (一般兵, 英雄, エース, 魔術士等) を動的に解決
      const destComp = resolveComponentForUnit({
        cards: [cardUp],
        face: "up",
        zone: "field",
        components,
        componentType: "character",
      });

      const resolvedCharType = getCharacterType({ componentId: destComp.id }, components);
      if (resolvedCharType !== "soldier") {
        throw new Error(`変形先コンポーネント [${destComp.id}] の characterType が soldier ではありません。`);
      }

      const destLabels = Array.isArray(destComp.properties?.labels)
        ? [...destComp.properties.labels]
        : ["攻撃", "防御"];
      const destKind = destComp.display?.kind || destComp.properties?.kind || "兵士";

      resultingUnits = [
        {
          unitId: sourceUnit.unitId,
          kind: destKind,
          componentId: destComp.id,
          state: requestedState,
          face: "up",
          cards: [cardUp],
          labels: [...destLabels],
          enteredTurn: sourceUnit.enteredTurn,
          enteredFieldTurn: sourceUnit.enteredFieldTurn,
          enteredFieldBeforeGame: sourceUnit.enteredFieldBeforeGame,
        },
      ];
    }

    // 8. Resulting Unit IDs の一意性 & 既存 Field との衝突チェック (Section 7, 8)
    const resultUnitIds = resultingUnits.map((u) => u.unitId);
    if (new Set(resultUnitIds).size !== resultUnitIds.length) {
      throw new Error("生成されるユニットIDに重複が存在します (fail-closed)。");
    }

    for (const player of Object.values<any>(state.players || {})) {
      if (Array.isArray(player?.field)) {
        for (const u of player.field) {
          if (u && u.unitId !== sourceUnit.unitId) {
            if (resultUnitIds.includes(u.unitId)) {
              throw new Error(
                `生成されるユニットID '${u.unitId}' が既存のフィールド上ユニットと衝突しています (fail-closed)。`
              );
            }
          }
        }
      }
    }

    // 9. カード完全保存チェック (Exact Equality: No loss, no duplication)
    const resultingCardIds = resultingUnits.flatMap((u) => u.cards.map((c: any) => c.id));
    if (resultingCardIds.length !== sourceCardIds.length) {
      throw new Error("変形前後でカード枚数が一致しません (fail-closed)。");
    }
    for (let i = 0; i < sourceCardIds.length; i++) {
      if (resultingCardIds[i] !== sourceCardIds[i]) {
        throw new Error("変形前後で物理カードIdentityが完全保存されていません (fail-closed)。");
      }
    }

    // =========================================================================
    // MUTATION PHASE (Only executed after ALL preflight checks pass)
    // =========================================================================

    // 10-a. 受けた効果の解除 (Fog のターゲティング関係を解除)
    if (options?.clearReceivedEffects) {
      for (const player of Object.values<any>(state.players || {})) {
        if (Array.isArray(player.fog)) {
          for (const f of player.fog) {
            if (f.bindings && f.bindings.target === sourceUnit.unitId) {
              delete f.bindings.target;
            }
          }
        }
      }
    }

    // 10-b. 戦闘役割の解除 (attacker / blocker role)
    if (options?.clearBattleRole) {
      if (sourceUnit.battle) {
        delete sourceUnit.battle;
      }
    }

    // 10-c. フィールド上のスロット置換 (順序維持)
    targetPlayer.field.splice(targetIdx, 1, ...resultingUnits);

    return {
      ownerKey,
      sourceUnitId: sourceUnit.unitId,
      sourceComponentId: sourceUnit.componentId,
      sourceCharacterType: sourceCharType,
      oldState,
      selectedState: requestedState,
      stateChanged,
      results: resultingUnits.map((u) => ({
        unitId: u.unitId,
        componentId: u.componentId,
        characterType: getCharacterType(u, components),
        cardIds: u.cards.map((c: any) => c.id),
        face: u.face,
        state: u.state,
      })),
    };
  }
}
