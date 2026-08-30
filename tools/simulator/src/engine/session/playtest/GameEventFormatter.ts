import { CombatResult } from "../../../domain/rules/DamageJudgeResult";
import { getUnitDisplayName } from "../../rules/characterUtils";
import { formatSuitSymbol } from "../../rules/cardUtils";

export interface FormattedLogEntry {
  message: string;
  level: "info" | "event" | "action" | "trigger" | "system";
}

function formatCardCodeDisplay(code?: string): string {
  if (!code) return "";
  return code
    .replace(/S/gi, "♠")
    .replace(/H/gi, "♡")
    .replace(/D/gi, "♢")
    .replace(/C/gi, "♣");
}


/**
 * 盤面状態の変化 (State / Stage / RequestBuffer) から構造化ゲームログメッセージを生成します。
 */
export class GameEventFormatter {
  /**
   * 前後の State と解決アクション情報から、発生したイベントのログ配列を生成します。
   */
  static formatStateTransition(
    prevState: any,
    nextState: any
  ): FormattedLogEntry[] {
    const logs: FormattedLogEntry[] = [];
    if (!prevState || !nextState) return logs;

    const getPlayerName = (pKey: string) => {
      return nextState.players?.[pKey]?.name || (pKey === "p1" ? "Player A" : "Player B");
    };

    // 1. ターン交代の検知
    if (prevState.turnPlayer !== nextState.turnPlayer) {
      const nextTPName = getPlayerName(nextState.turnPlayer);
      logs.push({
        message: `[TURN] ターン交代: ${nextTPName} (${nextState.turnPlayer}) の手番になりました (Turn ${nextState.turnCount})`,
        level: "info",
      });
    }

    // 1.5. 新規 Stage リクエスト積載 & コスト支払いの検知
    let paidLifePlayerKey: string | null = null;
    let paidLifeCount = 0;
    const prevStageReqIds = new Set(prevState.stage?.requests?.map((r: any) => r.id) || []);
    const nextStageReqs = nextState.stage?.requests || [];
    for (const req of nextStageReqs) {
      if (!prevStageReqIds.has(req.id)) {
        const costPayment = req.selectedCostPayment;
        if (costPayment) {
          const cName = getPlayerName(req.controller);
          const parts: string[] = [];

          if (costPayment.discardedCardIds && costPayment.discardedCardIds.length > 0) {
            const prevHand = prevState.players?.[req.controller]?.hand || [];
            const discardedCodes = costPayment.discardedCardIds.map((cId: string) => {
              const c = prevHand.find((card: any) => card.id === cId);
              return formatCardCodeDisplay(c?.code || (c?.suit && c?.rank ? `${c.suit}${c.rank}` : cId));
            });
            parts.push(`手札破棄: ${discardedCodes.join(", ")} → 墓地`);
          }

          if (costPayment.drivenBulwarkUnitIds && costPayment.drivenBulwarkUnitIds.length > 0) {
            parts.push(`防壁 ${costPayment.drivenBulwarkUnitIds.length}枚をdrive`);
          }

          if (costPayment.lifeCount && costPayment.lifeCount > 0) {
            parts.push(`ライフ ${costPayment.lifeCount}枚支払い`);
            paidLifePlayerKey = req.controller;
            paidLifeCount += costPayment.lifeCount;
          }

          if (costPayment.sacrificedUnitIds && costPayment.sacrificedUnitIds.length > 0) {
            parts.push(`ユニット ${costPayment.sacrificedUnitIds.length}体破壊`);
          }

          if (parts.length > 0) {
            logs.push({
              message: `[COST] ${cName} がコストを支払いました: ${parts.join(" / ")}`,
              level: "action",
            });
          }
        }
      }
    }

    // 2. Stage リクエスト解決の検知
    const prevStageHistory = prevState.stage?.history || [];
    const nextStageHistory = nextState.stage?.history || [];
    if (nextStageHistory.length > prevStageHistory.length) {
      // 解決されたリクエスト
      const newlyResolved = nextStageHistory.slice(prevStageHistory.length);
      for (const res of newlyResolved) {
        const actName = res.action?.name || res.actionId;
        const cName = getPlayerName(res.controller);
        logs.push({
          message: `[RESOLVE] 「${actName}」が解決されました (発動者: ${cName})`,
          level: "event",
        });

        const remainingCount = nextState.stage?.requests?.length || 0;
        if (remainingCount > 0) {
          const topRemaining = nextState.stage.requests[nextState.stage.requests.length - 1];
          const topRemainingName = topRemaining.action?.name || topRemaining.actionId;
          logs.push({
            message: `[STAGE] Stage TOP から「${actName}」を除去 (残りStage: ${remainingCount}件 - 「${topRemainingName}」)`,
            level: "info",
          });
        }

        // ダメージ判定の詳細ログを出力
        if (res.actionId === "action.damageJudge" && res.result?.damageJudge?.combats) {
          const combats: CombatResult[] = res.result.damageJudge.combats;
          let combatIdx = 1;
          for (const combat of combats) {
            const atkPlayerName = getPlayerName(combat.attackerPlayerKey);
            const atkCard = formatCardCodeDisplay(combat.attackerCardCode);
            const atkLabel = `${atkPlayerName} の一般兵 [${atkCard}]`;

            if (combat.combatType === "unblocked") {
              logs.push({
                message: `[DAMAGE_JUDGE] ${combats.length > 1 ? `(${combatIdx}) ` : ""}${atkLabel} は未ブロック`,
                level: "action",
              });
              logs.push({
                message: `[DAMAGE] ${getPlayerName(combat.targetPlayerKey || "")} に ${combat.directDamageAmount ?? combat.attackerInitialSize} ダメージ`,
                level: "event",
              });
            } else if (combat.combatType === "soldierVsSoldiers") {
              const blkPlayerName = getPlayerName(combat.blockerPlayerKey || "");
              const blkLabels = (combat.blockerCardCodes || []).map(
                (code) => `${blkPlayerName} の一般兵 [${formatCardCodeDisplay(code)}]`
              );
              logs.push({
                message: `[DAMAGE_JUDGE] ${combats.length > 1 ? `(${combatIdx}) ` : ""}${atkLabel} vs ${blkLabels.join(" + ")}`,
                level: "action",
              });
              logs.push({
                message: `[JUDGE_DETAIL] サイズ比較: attacker ${combat.attackerInitialSize} vs blockers ${combat.blockerInitialTotalSize ?? 0}`,
                level: "info",
              });

              if (combat.attackerMovedToGrave && combat.blockersMovedToGrave.length > 0) {
                logs.push({
                  message: `[DEFEATED] 結果: 両者死亡 (相打ち)`,
                  level: "event",
                });
              } else if (combat.attackerMovedToGrave) {
                logs.push({
                  message: `[DEFEATED] 結果: アタッカー死亡 / ブロッカー生存`,
                  level: "event",
                });
              } else if (combat.blockersMovedToGrave.length > 0) {
                logs.push({
                  message: `[DEFEATED] 結果: ブロッカー死亡 / アタッカー生存`,
                  level: "event",
                });
              }
            } else if (combat.combatType === "soldierVsBulwark") {
              const blkPlayerName = getPlayerName(combat.blockerPlayerKey || "");
              const bulwarkCode = formatCardCodeDisplay(combat.blockerCardCodes?.[0]);
              logs.push({
                message: `[DAMAGE_JUDGE] ${combats.length > 1 ? `(${combatIdx}) ` : ""}${atkLabel} vs ${blkPlayerName} の防壁 [${bulwarkCode}]`,
                level: "action",
              });
              logs.push({
                message: `[BULWARK_JUDGE] 防壁判定: printed rank ${combat.bulwarkRank || "?"} ${combat.bulwarkMatched ? "一致" : "不一致"}`,
                level: "info",
              });

              if (combat.attackerMovedToGrave) {
                logs.push({
                  message: `[DEFEATED] 結果: アタッカー死亡 / 防壁死亡`,
                  level: "event",
                });
              } else {
                logs.push({
                  message: `[DEFEATED] 結果: 防壁死亡 / アタッカー生存`,
                  level: "event",
                });
              }
            }
            combatIdx++;
          }
        }
      }
    }

    // 3. ユニット状態トグル (ツイスト等) の検知 (同ターン内)
    if (prevState.turnPlayer === nextState.turnPlayer) {
      for (const pKey of ["p1", "p2"]) {
        const prevUnits = prevState.players?.[pKey]?.field || [];
        const nextUnits = nextState.players?.[pKey]?.field || [];
        const pName = getPlayerName(pKey);

        for (const nu of nextUnits) {
          const pu = prevUnits.find((u: any) => u.unitId === nu.unitId);
          if (pu && pu.state !== nu.state) {
            const unitLabel = getUnitDisplayName(nu, nextUnits);
            logs.push({
              message: `[STATE] ${pName} の ${unitLabel} (#${nu.unitId.slice(-4)}) が ${pu.state} → ${nu.state} に切り替わりました`,
              level: "event",
            });
          }
        }
      }
    }

    // 4. ライフ変化 (ダメージ / ドロー) の検知
    for (const pKey of ["p1", "p2"]) {
      const prevLife = Array.isArray(prevState.players?.[pKey]?.life) ? prevState.players[pKey].life.length : 0;
      const nextLife = Array.isArray(nextState.players?.[pKey]?.life) ? nextState.players[pKey].life.length : 0;
      const pName = getPlayerName(pKey);

      if (prevLife > nextLife) {
        let diff = prevLife - nextLife;
        if (paidLifePlayerKey === pKey) {
          diff = Math.max(0, diff - paidLifeCount);
        }
        if (diff > 0) {
          // 手札が増えている場合はドロー、手札が増えていない場合はダメージ被弾
          const prevHand = Array.isArray(prevState.players?.[pKey]?.hand) ? prevState.players[pKey].hand.length : 0;
          const nextHand = Array.isArray(nextState.players?.[pKey]?.hand) ? nextState.players[pKey].hand.length : 0;

          if (nextHand > prevHand) {
            const drawCount = nextHand - prevHand;
            logs.push({
              message: `[DRAW] ${pName} がライフから ${drawCount}枚 ドローしました (残りライフ: ${nextLife}枚)`,
              level: "event",
            });
          } else {
            logs.push({
              message: `[DAMAGE] ${pName} に ${diff} ダメージ！ (残りライフ: ${nextLife}枚)`,
              level: "event",
            });
          }
        }
      }
    }

    // 5. フィールド -> 墓地移動の検知 (ユニット破壊/相打ち)
    for (const pKey of ["p1", "p2"]) {
      const prevGrave = Array.isArray(prevState.players?.[pKey]?.grave) ? prevState.players[pKey].grave.length : 0;
      const nextGrave = Array.isArray(nextState.players?.[pKey]?.grave) ? nextState.players[pKey].grave.length : 0;
      const pName = getPlayerName(pKey);

      if (nextGrave > prevGrave) {
        // 新しく墓地に入ったユニット
        const nextFieldIds = new Set(nextState.players?.[pKey]?.field?.map((u: any) => u.unitId) || []);

        for (const u of prevState.players?.[pKey]?.field || []) {
          if (!nextFieldIds.has(u.unitId)) {
            const unitLabel = getUnitDisplayName(u, prevState.players?.[pKey]?.field);
            logs.push({
              message: `[DEFEATED] ${pName} の ${unitLabel} (#${u.unitId.slice(-4)}) が墓地へ送られました`,
              level: "event",
            });
          }
        }
      }
    }

    // 6. チャージ状態への復帰検知 (ターン開始時)
    for (const pKey of ["p1", "p2"]) {
      const prevUnits = prevState.players?.[pKey]?.field || [];
      const nextUnits = nextState.players?.[pKey]?.field || [];
      const pName = getPlayerName(pKey);

      const chargedCount = nextUnits.filter((nu: any) => {
        const pu = prevUnits.find((u: any) => u.unitId === nu.unitId);
        return pu && pu.state === "drive" && nu.state === "charge";
      }).length;

      if (chargedCount > 0 && prevState.turnPlayer !== nextState.turnPlayer) {
        logs.push({
          message: `[CHARGE] ${pName} のユニット ${chargedCount}体が CHARGE (縦向き) に復帰しました`,
          level: "info",
        });
      }
    }

    return logs;
  }
}

