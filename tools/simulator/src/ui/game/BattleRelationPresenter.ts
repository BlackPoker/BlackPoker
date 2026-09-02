import { PlayerObservation } from "../../domain/decision/PlayerObservation";

/**
 * UI Presentation 専用のバトル関係（アタッカー・ブロッカー番号マッピング）構築ユーティリティ
 * ※ GameState や Core 内部状態には番号を保存せず、UI 表示時のみ snapshot 生成します。
 */

export interface UnitBattleDisplayInfo {
  readonly unitId: string;
  readonly badge: string; // "①", "②" 等
  readonly label: string; // "① ♠6 一般兵", "② 防壁" 等
  readonly role?: "attacker" | "blocker";
  readonly targetUnitId?: string; // ブロッカーが対象としているアタッカーID
  readonly targetBadge?: string; // 自分がブロックしているアタッカーの番号 (例: "①")
  readonly blockedByBadges: readonly string[]; // 自分をブロックしているブロッカーの番号リスト (例: ["③", "④"])
}

export class BattleRelationPresenter {
  private static readonly DIGITS = [
    "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩",
    "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"
  ];

  /**
   * 全プレイヤーのフィールドユニットから一貫した番号マッピングと戦闘関係を構築します。
   * Observation が存在する場合は Observation (配列構造) を最優先し、
   * HIDDEN なカードから秘密情報 (カードコード/スート/ランク) を漏洩させません。
   */
  static buildPresentationMap(
    gameState?: any,
    observation?: PlayerObservation
  ): Map<string, UnitBattleDisplayInfo> {
    const map = new Map<string, UnitBattleDisplayInfo>();
    const allUnits: { unit: any; ownerPlayerKey: string }[] = [];

    // 1. 全フィールドユニットを順番に収集 (Player A -> Player B の順)
    if (observation?.players && Array.isArray(observation.players)) {
      // PlayerObservation 経路 (最優先: 配列構造)
      for (const pKey of ["p1", "p2"]) {
        const obsPlayer = observation.players.find((p) => p.playerId === pKey);
        if (obsPlayer?.field && Array.isArray(obsPlayer.field)) {
          for (const u of obsPlayer.field) {
            allUnits.push({ unit: u, ownerPlayerKey: pKey });
          }
        }
      }
    } else if (gameState?.players) {
      // GameState 経路 (Observation がない場合のフォールバック / テスト用等)
      for (const pKey of ["p1", "p2"]) {
        const p = gameState.players[pKey];
        if (p?.field && Array.isArray(p.field)) {
          for (const u of p.field) {
            allUnits.push({ unit: u, ownerPlayerKey: pKey });
          }
        }
      }
    }

    // 2. 各ユニットに番号 (①, ②, ...) を付与し、Presentation label を生成
    allUnits.forEach(({ unit }, idx) => {
      const badge = idx < this.DIGITS.length ? this.DIGITS[idx] : `(${idx + 1})`;

      // カードコードの整形:
      // HIDDEN なカード (相手の裏向き防壁など) はカードコードを付与せず、秘密情報の漏洩を防ぐ
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

      const kind = unit.kind || (unit.componentId === "character.bulwark" ? "防壁" : "一般兵");
      const label = `${badge} ${formattedCard ? `${formattedCard} ` : ""}${kind}`;

      map.set(unit.unitId, {
        unitId: unit.unitId,
        badge,
        label,
        role: unit.battle?.role,
        targetUnitId: unit.battle?.blocksUnitId,
        blockedByBadges: [],
      });
    });

    // 3. アタッカーとブロッカーの双方向関係を解決
    for (const { unit } of allUnits) {
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
