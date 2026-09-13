import { PlayerObservation } from "../../domain/decision/PlayerObservation";

/**
 * UI Presentation 専用のバトル関係（アタッカー・ブロッカー番号マッピング）構築ユーティリティ
 * ※ GameState や Core 内部状態には番号を保存せず、UI 表示時のみ snapshot 生成します。
 */

export interface UnitBattleDisplayInfo {
  readonly unitId: string;
  readonly badge: string; // Target番号: "①", "②" 等 (Player内で一意)
  readonly label: string; // "① ♠6 一般兵", "② 防壁" 等
  readonly ownerPlayerKey?: string; // "p1" | "p2"
  readonly bulwarkPosition?: string; // 防壁のみ: ライフ側から "①", "②", "③" 等 (物理配置番号)
  readonly role?: "attacker" | "blocker";
  readonly targetUnitId?: string; // ブロッカーが対象としているアタッカーID
  readonly targetBadge?: string; // 自分がブロックしているアタッカーの番号 (例: "①")
  readonly blockedByBadges: readonly string[]; // 自分をブロックしているブロッカーの番号リスト (例: ["②"])
}

export class BattleRelationPresenter {
  public static readonly DIGITS = [
    "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩",
    "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"
  ];

  /**
   * 全プレイヤーのフィールドユニットから一貫した番号マッピングと戦闘関係を構築します。
   * Target relation番号は各プレイヤーごとに ① からリセットし、同一プレイヤー内では一意とします。
   * 防壁には物理配置番号 (bulwarkPosition: ライフ側から ①, ②...) を付与します。
   * Observation が存在する場合は Observation (配列構造) を最優先し、
   * HIDDEN なカードから秘密情報 (カードコード/スート/ランク) を漏洩させません。
   */
  static buildPresentationMap(
    gameState?: any,
    observation?: PlayerObservation
  ): Map<string, UnitBattleDisplayInfo> {
    const map = new Map<string, UnitBattleDisplayInfo>();
    const allUnitsWithPlayer: { unit: any; ownerPlayerKey: string }[] = [];

    // 1. 各プレイヤーごとにフィールドユニットを収集
    const playersKeys = ["p1", "p2"] as const;

    for (const pKey of playersKeys) {
      const unitsOfPlayer: any[] = [];

      if (observation?.players && Array.isArray(observation.players)) {
        const obsPlayer = observation.players.find((p) => p.playerId === pKey);
        if (obsPlayer?.field && Array.isArray(obsPlayer.field)) {
          unitsOfPlayer.push(...obsPlayer.field);
        }
      } else if (gameState?.players) {
        const p = gameState.players[pKey];
        if (p?.field && Array.isArray(p.field)) {
          unitsOfPlayer.push(...p.field);
        }
      }

      // 兵士と防壁を分離
      const soldiers = unitsOfPlayer.filter(
        (u) => u.componentId !== "character.bulwark" && u.kind !== "防壁"
      );
      const bulwarks = unitsOfPlayer.filter(
        (u) => u.componentId === "character.bulwark" || u.kind === "防壁"
      );

      let targetCount = 0;

      // 2. 兵士の Target 番号採番 (プレイヤー内 ①, ②...)
      soldiers.forEach((unit) => {
        const badge = targetCount < this.DIGITS.length ? this.DIGITS[targetCount] : `(${targetCount + 1})`;
        targetCount++;

        let formattedCard = "";
        const firstCard = unit.cards?.[0];
        if (firstCard && firstCard.visibility !== "HIDDEN" && (firstCard.suit || firstCard.code)) {
          const cardCode = firstCard.code || `${firstCard.suit}${firstCard.rank || ""}`;
          formattedCard = cardCode
            .replace(/S/g, "♠")
            .replace(/H/g, "♡")
            .replace(/D/g, "♢")
            .replace(/C/g, "♣");
        }

        const kind = unit.kind || "一般兵";
        const label = `${badge} ${formattedCard ? `${formattedCard} ` : ""}${kind}`;

        const info: UnitBattleDisplayInfo = {
          unitId: unit.unitId,
          badge,
          label,
          ownerPlayerKey: pKey,
          role: unit.battle?.role,
          targetUnitId: unit.battle?.blocksUnitId,
          blockedByBadges: [],
        };
        map.set(unit.unitId, info);
        allUnitsWithPlayer.push({ unit, ownerPlayerKey: pKey });
      });

      // 3. 防壁の Target 番号採番 & 物理配置番号採番
      // bulwarks[0] は最初に追加された防壁 = 最もライフ側 (右端)
      bulwarks.forEach((unit, bIdx) => {
        const badge = targetCount < this.DIGITS.length ? this.DIGITS[targetCount] : `(${targetCount + 1})`;
        targetCount++;

        // ライフ側から ①, ②, ③...
        const bulwarkPosition = bIdx < this.DIGITS.length ? this.DIGITS[bIdx] : `(${bIdx + 1})`;

        let formattedCard = "";
        const firstCard = unit.cards?.[0];
        if (firstCard && firstCard.visibility !== "HIDDEN" && (firstCard.suit || firstCard.code)) {
          const cardCode = firstCard.code || `${firstCard.suit}${firstCard.rank || ""}`;
          formattedCard = cardCode
            .replace(/S/g, "♠")
            .replace(/H/g, "♡")
            .replace(/D/g, "♢")
            .replace(/C/g, "♣");
        }

        const kind = unit.kind || "防壁";
        const label = `${badge} ${formattedCard ? `${formattedCard} ` : ""}${kind}`;

        const info: UnitBattleDisplayInfo = {
          unitId: unit.unitId,
          badge,
          label,
          ownerPlayerKey: pKey,
          bulwarkPosition,
          role: unit.battle?.role,
          targetUnitId: unit.battle?.blocksUnitId,
          blockedByBadges: [],
        };
        map.set(unit.unitId, info);
        allUnitsWithPlayer.push({ unit, ownerPlayerKey: pKey });
      });
    }

    // 4. アタッカーとブロッカーの双方向関係を解決
    for (const { unit } of allUnitsWithPlayer) {
      const info = map.get(unit.unitId);
      if (!info) continue;

      if (unit.battle?.role === "blocker" && unit.battle?.blocksUnitId) {
        const attackerInfo = map.get(unit.battle.blocksUnitId);
        if (attackerInfo) {
          // ブロッカー側にアタッカー番号を設定
          (info as any).targetBadge = attackerInfo.badge;

          // アタッカー側にブロッカー番号を追加 (複数ブロッカー対応)
          const existingBlockers = [...attackerInfo.blockedByBadges, info.badge];
          (attackerInfo as any).blockedByBadges = existingBlockers;
        }
      }
    }

    return map;
  }
}
