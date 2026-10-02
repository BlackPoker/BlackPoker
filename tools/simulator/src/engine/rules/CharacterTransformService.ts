import { ComponentDefinition } from "../../domain/rules/RulePackage";
import { isCharacterComponent, getCharacterType, resolveComponentForUnit } from "./characterUtils";

export interface CharacterTransformOptions {
  readonly destination?: "opposite" | "soldier" | "bulwark" | string;
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
   */
  static transformCharacter(params: CharacterTransformParams): CharacterTransformResult {
    const { targetUnit, state, components, options } = params;

    const targetUnitId = typeof targetUnit === "string" ? targetUnit : targetUnit?.unitId;
    if (!targetUnitId) {
      throw new Error("変形対象のユニットIDが指定されていません。");
    }

    // 1. 対象ユニットおよびオーナーの特定
    let ownerKey: string | undefined;
    let sourceUnit: any;
    let targetIdx = -1;
    let matchCount = 0;

    for (const [pKey, player] of Object.entries<any>(state.players || {})) {
      if (!player?.field || !Array.isArray(player.field)) continue;
      const idx = player.field.findIndex((u: any) => u.unitId === targetUnitId);
      if (idx !== -1) {
        matchCount++;
        ownerKey = pKey;
        sourceUnit = player.field[idx];
        targetIdx = idx;
      }
    }

    if (matchCount === 0 || !sourceUnit || !ownerKey) {
      throw new Error(`変形対象のユニット [${targetUnitId}] がフィールド上に存在しません。`);
    }
    if (matchCount > 1) {
      throw new Error(`重複するユニットID [${targetUnitId}] がフィールド上で検出されました。`);
    }

    // 2. キャラクター検証
    if (!isCharacterComponent(sourceUnit, components)) {
      throw new Error(`ユニット [${targetUnitId}] はキャラクターではありません。`);
    }

    // 3. 元の characterType の特定
    const sourceCharType = getCharacterType(sourceUnit, components);
    if (sourceCharType !== "soldier" && sourceCharType !== "bulwark") {
      throw new Error(
        `変形対象のキャラクター種別 [${sourceCharType || "不明"}] は兵士または防壁である必要があります。`
      );
    }

    // 4. 変形先の決定
    const destination = options?.destination || "opposite";
    let destCharType: string;
    if (destination === "opposite") {
      destCharType = sourceCharType === "soldier" ? "bulwark" : "soldier";
    } else if (destination === "soldier" || destination === "bulwark") {
      destCharType = destination;
    } else {
      throw new Error(`未対応の変形先指定です: ${destination}`);
    }

    // 5. 変形後ユニット群の事前計算 (Precompute)
    let resultingUnits: any[] = [];

    if (destCharType === "bulwark") {
      // 兵士 → 防壁
      if (!sourceUnit.cards || !Array.isArray(sourceUnit.cards) || sourceUnit.cards.length === 0) {
        throw new Error("変形対象の構成カードが存在しません。");
      }

      // 防壁コンポーネント定義の解決
      const bulwarkComp =
        components.find((c) => c.id === "character.bulwark") ||
        resolveComponentForUnit({
          cards: [{ id: "temp", suit: "spade", rank: "2" }],
          face: "down",
          zone: "field",
          components,
          componentType: "character",
        });

      if (!bulwarkComp) {
        throw new Error("防壁コンポーネント定義が見つかりません。");
      }

      const bulwarkLabels = Array.isArray(bulwarkComp.properties?.labels)
        ? [...bulwarkComp.properties.labels]
        : ["防御"];
      const bulwarkKind = bulwarkComp.display?.kind || bulwarkComp.properties?.kind || "防壁";

      if (sourceUnit.cards.length === 1) {
        // 1枚構成: 1対1変形 (unitId を維持)
        const card = sourceUnit.cards[0];
        const newBulwark = {
          unitId: sourceUnit.unitId,
          kind: bulwarkKind,
          componentId: bulwarkComp.id,
          state: sourceUnit.state,
          face: "down",
          cards: [{ ...card, face: "down" }],
          labels: [...bulwarkLabels],
          enteredTurn: sourceUnit.enteredTurn,
          enteredFieldTurn: sourceUnit.enteredFieldTurn,
          enteredFieldBeforeGame: sourceUnit.enteredFieldBeforeGame,
        };
        resultingUnits = [newBulwark];
      } else {
        // 2枚以上構成 (装備兵など): 各カードを1枚ずつ別個の防壁に分裂 (Split)
        // 元の unitId は消滅し、確定的な新規 unitId を各防壁に付与
        resultingUnits = sourceUnit.cards.map((c: any, i: number) => ({
          unitId: `${sourceUnit.unitId}-split-${c.id || i + 1}`,
          kind: bulwarkKind,
          componentId: bulwarkComp.id,
          state: sourceUnit.state,
          face: "down",
          cards: [{ ...c, face: "down" }],
          labels: [...bulwarkLabels],
          enteredTurn: sourceUnit.enteredTurn,
          enteredFieldTurn: sourceUnit.enteredFieldTurn,
          enteredFieldBeforeGame: sourceUnit.enteredFieldBeforeGame,
        }));
      }
    } else {
      // 防壁 → 兵士
      if (!sourceUnit.cards || !Array.isArray(sourceUnit.cards) || sourceUnit.cards.length !== 1) {
        throw new Error(
          `防壁の構成カード枚数が不正です。期待: 1枚, 実際: ${sourceUnit.cards?.length || 0}枚`
        );
      }

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

      const newSoldier = {
        unitId: sourceUnit.unitId,
        kind: destKind,
        componentId: destComp.id,
        state: sourceUnit.state,
        face: "up",
        cards: [cardUp],
        labels: [...destLabels],
        enteredTurn: sourceUnit.enteredTurn,
        enteredFieldTurn: sourceUnit.enteredFieldTurn,
        enteredFieldBeforeGame: sourceUnit.enteredFieldBeforeGame,
      };
      resultingUnits = [newSoldier];
    }

    // 6. 原子的な盤面適用 (Apply Phase)
    // 6-a. 受けた効果の解除 (Fog のターゲティング関係を解除)
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

    // 6-b. 戦闘役割の解除 (attacker / blocker role)
    if (options?.clearBattleRole) {
      if (sourceUnit.battle) {
        delete sourceUnit.battle;
      }
    }

    // 6-c. フィールド上のスロット置換 (順序維持)
    const targetPlayer = state.players[ownerKey];
    targetPlayer.field.splice(targetIdx, 1, ...resultingUnits);

    return {
      ownerKey,
      sourceUnitId: sourceUnit.unitId,
      sourceComponentId: sourceUnit.componentId,
      sourceCharacterType: sourceCharType,
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
