import { TargetSelection } from "../../domain/decision/DecisionCatalog";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { getUnitDisplayName } from "../rules/characterUtils";
import { formatSuitSymbol } from "../rules/cardUtils";

export interface FormattedTargetLabels {
  readonly primaryLabel: string;
  readonly secondaryLabel?: string;
  readonly displayName: string;
}

/**
 * 合法な TargetSelection に対して、人間向けの意味表示（Primary）および補助表示（Secondary）を
 * 閲覧者（viewerPlayerId）の秘密情報境界を保ちながら生成します。
 */
export class PlaytestTargetPresenter {
  /**
   * Requestターゲット（カウンター等）の2段表示ラベルを生成します。
   */
  static formatRequestTarget(
    req: any,
    isTop?: boolean
  ): FormattedTargetLabels {
    const cKey = req?.controller;
    const cName = cKey === "p1" ? "Player A" : cKey === "p2" ? "Player B" : "プレイヤー";
    const actName = req?.action?.name || req?.actionId || "アクション";
    const primaryLabel = `${cName}: ${actName}`;
    const reqId = req?.id || "";
    const isStageTop = isTop ?? true;
    const secondaryLabel = `Stage ${isStageTop ? "TOP " : ""}[${reqId}]`;
    const displayName = `${primaryLabel} (${secondaryLabel})`;

    return {
      primaryLabel,
      secondaryLabel,
      displayName,
    };
  }

  /**
   * ユニットターゲット（ツイスト等）の2段表示ラベルを生成します。
   * 相手の伏せ防壁のカードコードは非公開情報として隠蔽します。
   */
  static formatUnitTarget(
    unit: any,
    ownerPlayerKey: PlayerKey,
    field: readonly any[] = [],
    viewerPlayerId?: PlayerKey
  ): FormattedTargetLabels {
    const pName = ownerPlayerKey === "p1" ? "Player A" : "Player B";
    const unitLabel = unit ? getUnitDisplayName(unit, field) : "ユニット";
    const primaryLabel = `${pName} の ${unitLabel}`;

    const isBulwark = unit?.componentId === "character.bulwark" || unit?.kind === "防壁";
    const isFaceDown = unit?.face === "down";
    const isOpponent = viewerPlayerId && ownerPlayerKey !== viewerPlayerId;

    const stateLabel = (unit?.state ? unit.state : "charge").toLowerCase();

    // 伏せ防壁または非公開ユニットの場合: カード内容は伏せカード記号 🂠 で隠蔽
    let cardStr = "";
    if (isBulwark && isFaceDown) {
      cardStr = "🂠";
    } else if (unit?.cards && unit.cards.length > 0) {
      if (isOpponent && isFaceDown) {
        cardStr = "🂠";
      } else {
        cardStr = unit.cards.map((c: any) => `${formatSuitSymbol(c.suit)}${c.rank}`).join("+");
      }
    }

    const secondaryParts: string[] = [];
    if (cardStr) secondaryParts.push(`[${cardStr}]`);
    secondaryParts.push(`(${stateLabel})`);

    const secondaryLabel = secondaryParts.join(" ");
    const displayName = `${primaryLabel} ${secondaryLabel}`;

    return {
      primaryLabel,
      secondaryLabel,
      displayName,
    };
  }

  /**
   * プレイヤーターゲットの表示ラベルを生成します。
   */
  static formatPlayerTarget(playerKey: PlayerKey, state?: any): FormattedTargetLabels {
    const pName = state?.players?.[playerKey]?.name || (playerKey === "p1" ? "Player A" : "Player B");
    return {
      primaryLabel: pName,
      secondaryLabel: "プレイヤー",
      displayName: `プレイヤー: ${pName} (${playerKey})`,
    };
  }

  static formatTarget(
    target: TargetSelection,
    state?: any,
    viewerPlayerId?: PlayerKey
  ): FormattedTargetLabels {
    if (!target || target.targetType === "none") {
      return {
        primaryLabel: "対象なし",
        displayName: "対象なし",
      };
    }

    // 1. リクエストターゲット (カウンター等)
    if (target.targetType === "request") {
      let matchedReq: any = undefined;
      let isTop = false;
      if (state?.stage?.requests) {
        const reqs = state.stage.requests;
        const idx = reqs.findIndex((r: any) => r.id === target.targetRequestId);
        if (idx !== -1) {
          matchedReq = reqs[idx];
          isTop = idx === reqs.length - 1;
        }
      }
      if (!matchedReq && state?.stage?.history) {
        matchedReq = state.stage.history.find((r: any) => r.id === target.targetRequestId);
      }

      if (matchedReq) {
        return this.formatRequestTarget(matchedReq, isTop);
      }

      return this.formatRequestTarget(
        {
          id: target.targetRequestId,
          controller: target.targetPlayerKey,
          action: { name: "リクエスト" },
        },
        false
      );
    }

    // 2. ユニットターゲット (ツイスト、アップ、ダウン、防壁破壊等)
    if (target.targetType === "unit") {
      let matchedUnit: any = undefined;
      let unitPlayerKey = target.targetPlayerKey as PlayerKey | undefined;

      if (state?.players) {
        if (unitPlayerKey && state.players[unitPlayerKey]?.field) {
          matchedUnit = state.players[unitPlayerKey].field.find((u: any) => u.unitId === target.targetUnitId);
        }
        if (!matchedUnit) {
          for (const pKey of ["p1", "p2"] as const) {
            const u = state.players[pKey]?.field?.find((unit: any) => unit.unitId === target.targetUnitId);
            if (u) {
              matchedUnit = u;
              unitPlayerKey = pKey;
              break;
            }
          }
        }
      }

      const playerUnits = unitPlayerKey && state?.players?.[unitPlayerKey]?.field ? state.players[unitPlayerKey].field : [];
      return this.formatUnitTarget(matchedUnit, (unitPlayerKey || "p1") as PlayerKey, playerUnits, viewerPlayerId);
    }

    // 3. プレイヤーターゲット
    if (target.targetType === "player") {
      return this.formatPlayerTarget(target.targetPlayerKey as PlayerKey, state);
    }

    return {
      primaryLabel: target.displayName || "対象",
      secondaryLabel: target.targetRequestId || target.targetUnitId,
      displayName: target.displayName || "対象",
    };
  }
}
