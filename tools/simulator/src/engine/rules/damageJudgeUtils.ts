import { CommandContext } from "./CommandRegistry";
import { AbilityEvaluator } from "./AbilityEvaluator";
import type { EffectInterpreter } from "./EffectInterpreter";
import { isSoldierType, isBulwarkType, getCharacterType } from "./characterUtils";
import { isJokerCard, matchesPrintedRank } from "./cardUtils";
import { getOpponentPlayerKey } from "./playerUtils";
import { moveUnitToGraveyard } from "./unitMovementUtils";
import type { MoveUnitMetadata } from "./unitMovementUtils";
import type { CombatResult, DamageJudgeResult } from "../../domain/rules/DamageJudgeResult";

export type { CombatResult, DamageJudgeResult } from "../../domain/rules/DamageJudgeResult";

/**
 * 1. 未ブロック戦闘（ブロッカー不在）の計算
 */
export function resolveUnblockedCombat(
  attacker: any,
  attackerPlayerKey: string,
  context: CommandContext,
  abilityEvaluator: AbilityEvaluator
): CombatResult {
  const attackerSize = abilityEvaluator.calculateUnitSize(attacker, context.state.players[attackerPlayerKey]);
  const targetPlayerKey = attacker.battle?.targetPlayerKey || getOpponentPlayerKey(attackerPlayerKey, context.state);
  const attackerCharacterType = getCharacterType(attacker, context.components) || (isSoldierType(attacker, context.components) ? "soldier" : undefined);

  const attackerCardCode = Array.isArray(attacker.cards) ? attacker.cards.map((c: any) => `${c.suit || ""}${c.rank || ""}`).join("+") : "";

  return {
    attackerUnitId: attacker.unitId,
    attackerPlayerKey,
    combatType: "unblocked",
    blockerUnitIds: [],
    attackerInitialSize: attackerSize,
    attackerMovedToGrave: false,
    blockersMovedToGrave: [],
    directDamageAmount: attackerSize,
    directDamageDealt: attackerSize,
    targetPlayerKey,
    attackerCharacterType,
    attackerCardCode,
  };
}

/**
 * 2. 兵士アタッカー vs 複数兵士ブロッカーの戦闘計算（サイズ比較 / 革命対応）
 */
export function resolveSoldierVsSoldiersCombat(
  attacker: any,
  attackerPlayerKey: string,
  blockers: readonly any[],
  blockerPlayerKey: string,
  context: CommandContext,
  abilityEvaluator: AbilityEvaluator
): CombatResult {
  const attackerCharacterType = getCharacterType(attacker, context.components) || (isSoldierType(attacker, context.components) ? "soldier" : undefined);
  const attackerSize = abilityEvaluator.calculateUnitSize(attacker, context.state.players[attackerPlayerKey]);
  const blockerSizes = blockers.map((b) =>
    abilityEvaluator.calculateUnitSize(b, context.state.players[blockerPlayerKey])
  );
  const blockerTotalSize = blockerSizes.reduce((sum, s) => sum + s, 0);

  const isRevolution = abilityEvaluator.hasDamageJudgeModifier(
    "soldierVsSoldiers",
    "revolution",
    context.state,
    context.components
  );

  let attackerMovedToGrave = false;
  let blockersMovedToGrave: string[] = [];
  let differenceDamage: { amount: number; targetPlayerKey: string } | undefined = undefined;

  if (isRevolution) {
    // 革命ルール: 大きい方が墓地へ、差分ダメージを墓地へ送ったプレイヤーに与える。同値なら両方墓地へ（差分0）。
    if (attackerSize > blockerTotalSize) {
      attackerMovedToGrave = true;
      blockersMovedToGrave = [];
      const diff = attackerSize - blockerTotalSize;
      if (diff > 0) {
        differenceDamage = { amount: diff, targetPlayerKey: attackerPlayerKey };
      }
    } else if (attackerSize < blockerTotalSize) {
      attackerMovedToGrave = false;
      blockersMovedToGrave = blockers.map((b) => b.unitId);
      const diff = blockerTotalSize - attackerSize;
      if (diff > 0) {
        differenceDamage = { amount: diff, targetPlayerKey: blockerPlayerKey };
      }
    } else {
      // 同値: 両方墓地へ
      attackerMovedToGrave = true;
      blockersMovedToGrave = blockers.map((b) => b.unitId);
      differenceDamage = undefined;
    }
  } else {
    // 通常ルール: 小さい方が墓地へ。
    if (attackerSize > blockerTotalSize) {
      attackerMovedToGrave = false;
      blockersMovedToGrave = blockers.map((b) => b.unitId);
    } else if (attackerSize < blockerTotalSize) {
      attackerMovedToGrave = true;
      blockersMovedToGrave = [];
    } else {
      attackerMovedToGrave = true;
      blockersMovedToGrave = blockers.map((b) => b.unitId);
    }
  }

  const attackerCardCode = Array.isArray(attacker.cards) ? attacker.cards.map((c: any) => `${c.suit || ""}${c.rank || ""}`).join("+") : "";
  const blockerCardCodes = blockers.map((b) => Array.isArray(b.cards) ? b.cards.map((c: any) => `${c.suit || ""}${c.rank || ""}`).join("+") : "");

  return {
    attackerUnitId: attacker.unitId,
    attackerPlayerKey,
    combatType: "soldierVsSoldiers",
    blockerUnitIds: blockers.map((b) => b.unitId),
    blockerPlayerKey,
    attackerInitialSize: attackerSize,
    blockerInitialTotalSize: blockerTotalSize,
    attackerMovedToGrave,
    blockersMovedToGrave,
    ruleVariant: isRevolution ? "revolution" : "normal",
    differenceDamage,
    attackerCharacterType,
    attackerCardCode,
    blockerCardCodes,
  };
}

/**
 * 3. 兵士アタッカー vs 防壁ブロッカーの戦闘計算（記載数字照合）
 */
export function resolveSoldierVsBulwarkCombat(
  attacker: any,
  attackerPlayerKey: string,
  bulwark: any,
  blockerPlayerKey: string,
  context: CommandContext,
  abilityEvaluator: AbilityEvaluator
): CombatResult {
  const attackerCharacterType = getCharacterType(attacker, context.components) || (isSoldierType(attacker, context.components) ? "soldier" : undefined);
  const attackerSize = abilityEvaluator.calculateUnitSize(attacker, context.state.players[attackerPlayerKey]);
  const bulwarkCard = bulwark.cards?.[0];

  const isJoker = isJokerCard(bulwarkCard);
  const isMatched = isJoker || matchesPrintedRank(attacker.cards || [], bulwarkCard);

  // ユニット固有の防壁耐性能力（例: 巨人）を評価
  const preserveAttacker = isMatched && abilityEvaluator.hasUnitDamageJudgeModifier(
    attacker,
    "soldierVsBulwark",
    "preserveAttackerOnMatchedBulwark",
    context.components
  );

  // 防壁は判定結果に関わらず必ず墓地へ移動する
  const blockersMovedToGrave = [bulwark.unitId];
  const attackerMovedToGrave = isMatched && !preserveAttacker;
  const attackerGravePrevented = isMatched && preserveAttacker ? true : undefined;

  const attackerCardCode = Array.isArray(attacker.cards) ? attacker.cards.map((c: any) => `${c.suit || ""}${c.rank || ""}`).join("+") : "";
  const bulwarkCardCode = bulwarkCard ? `${bulwarkCard.suit || ""}${bulwarkCard.rank || ""}` : "";

  return {
    attackerUnitId: attacker.unitId,
    attackerPlayerKey,
    combatType: "soldierVsBulwark",
    blockerUnitIds: [bulwark.unitId],
    blockerPlayerKey,
    attackerInitialSize: attackerSize,
    attackerMovedToGrave,
    blockersMovedToGrave,
    bulwarkRevealed: true,
    bulwarkMatched: isMatched,
    bulwarkRank: bulwarkCard?.rank || (isJoker ? "Joker" : undefined),
    attackerGravePrevented,
    attackerCharacterType,
    attackerCardCode,
    blockerCardCodes: [bulwarkCardCode],
  };
}

/**
 * Calculate Phase:
 * effect-time の盤面状態を基準に全戦闘の判定結果を確定し、DamageJudgeResult を生成します。
 * （盤面変更・墓地移動などの副作用はまだ発生させません）
 */
export function calculateDamageJudge(
  context: CommandContext,
  abilityEvaluator: AbilityEvaluator
): DamageJudgeResult {
  const state = context.state;
  const combats: CombatResult[] = [];
  const handledAttackerIds = new Set<string>();
  const handledBlockerIds = new Set<string>();

  // 1. ターンプレイヤー（アタッカー側）の決定とアタッカー収集（他プレイヤーのstale attackerは走査しない）
  const attackerPlayerKey = context.playerKey || state.turnPlayer;
  const attackerPlayer = state.players?.[attackerPlayerKey];
  const attackers: any[] = [];
  if (attackerPlayer?.field) {
    for (const unit of attackerPlayer.field) {
      if (unit.battle?.role === "attacker") {
        attackers.push(unit);
      }
    }
  }

  // 2. 各アタッカーについての戦闘計算
  for (const attacker of attackers) {
    handledAttackerIds.add(attacker.unitId);

    // 防御側プレイヤーの決定 (attacker.battle.targetPlayerKey を優先し、fallback として getOpponentPlayerKey)
    const blockerPlayerKey =
      attacker.battle?.targetPlayerKey || getOpponentPlayerKey(attackerPlayerKey, state);
    const blockerPlayer = state.players?.[blockerPlayerKey];

    // 当該アタッカーをブロックしている盤面上のブロッカー群を防御側フィールドから収集
    const blockers: any[] = [];
    if (blockerPlayer?.field) {
      for (const u of blockerPlayer.field) {
        if (u.battle?.role === "blocker" && u.battle?.blocksUnitId === attacker.unitId) {
          blockers.push(u);
          handledBlockerIds.add(u.unitId);
        }
      }
    }

    if (blockers.length === 0) {
      // 未ブロック戦闘
      const result = resolveUnblockedCombat(attacker, attackerPlayerKey, context, abilityEvaluator);
      combats.push(result);
    } else {
      const blockerUnits = blockers;

      const isSingleBulwark =
        blockerUnits.length === 1 && isBulwarkType(blockerUnits[0], context.components);

      if (isSingleBulwark) {
        // 防壁ブロック戦闘
        const result = resolveSoldierVsBulwarkCombat(
          attacker,
          attackerPlayerKey,
          blockerUnits[0],
          blockerPlayerKey,
          context,
          abilityEvaluator
        );
        combats.push(result);
      } else {
        const allSoldiers = blockerUnits.every((b) => isSoldierType(b, context.components));
        if (allSoldiers) {
          // 兵士 vs 複数兵士戦闘
          const result = resolveSoldierVsSoldiersCombat(
            attacker,
            attackerPlayerKey,
            blockerUnits,
            blockerPlayerKey,
            context,
            abilityEvaluator
          );
          combats.push(result);
        } else {
          // 将来の未定義 characterType に対する防御的処理
          combats.push({
            attackerUnitId: attacker.unitId,
            attackerPlayerKey,
            combatType: "unsupported",
            blockerUnitIds: blockerUnits.map((b: any) => b.unitId),
            blockerPlayerKey,
            attackerInitialSize: abilityEvaluator.calculateUnitSize(attacker, state.players[attackerPlayerKey]),
            attackerMovedToGrave: false,
            blockersMovedToGrave: [],
          });
        }
      }
    }
  }

  // 3. Orphan Blockers（今回の戦闘対象の相手プレイヤーのフィールドで、対応アタッカーが存在しないブロッカー）
  const opponentPlayerKey = getOpponentPlayerKey(attackerPlayerKey, state);
  const opponentPlayer = state.players?.[opponentPlayerKey];
  const orphanBlockers: { blockerUnitId: string; blockerPlayerKey: string }[] = [];
  if (opponentPlayer?.field) {
    for (const u of opponentPlayer.field) {
      if (u.battle?.role === "blocker" && !handledBlockerIds.has(u.unitId)) {
        orphanBlockers.push({ blockerUnitId: u.unitId, blockerPlayerKey: opponentPlayerKey });
      }
    }
  }

  return {
    combats,
    orphanBlockerUnitIds: orphanBlockers,
  };
}

/**
 * Apply Phase:
 * 確定した DamageJudgeResult を盤面に適用し、墓地移動・直接ダメージ・battle cleanup を実行します。
 */
export function applyDamageJudgeResult(
  result: DamageJudgeResult,
  context: CommandContext,
  effectInterpreter: EffectInterpreter
): void {
  const state = context.state;

  // 1. 各戦闘結果の適用
  for (const combat of result.combats) {
    const attackerPlayer = state.players[combat.attackerPlayerKey];
    const attackerUnit = attackerPlayer?.field?.find((u: any) => u.unitId === combat.attackerUnitId);

    // 1-1. 防壁の表面化
    if (combat.bulwarkRevealed && combat.blockerPlayerKey) {
      const blockerPlayer = state.players[combat.blockerPlayerKey];
      for (const bId of combat.blockerUnitIds) {
        const blockerUnit = blockerPlayer?.field?.find((u: any) => u.unitId === bId);
        if (blockerUnit) {
          blockerUnit.face = "up";
        }
      }
    }

    // 1-2. 未ブロック時の直接ダメージ
    const damageAmount = combat.directDamageAmount ?? combat.directDamageDealt;
    if (damageAmount !== undefined && damageAmount > 0) {
      const targetPlayerKey = combat.targetPlayerKey || getOpponentPlayerKey(combat.attackerPlayerKey, state);
      const damageContext: CommandContext = {
        ...context,
        playerKey: combat.attackerPlayerKey,
        targetPlayerKey,
      };

      // dealDamage コマンドの実行 (life -> grave 移動と cardMoved イベント発行)
      ((effectInterpreter as any).registry).execute(
        "dealDamage",
        { target: "targetPlayer", amount: damageAmount },
        damageContext
      );
    }

    // 1-3. アタッカーの墓地移動
    if (combat.attackerMovedToGrave) {
      if (attackerUnit) {
        const metadata: MoveUnitMetadata = {
          cause: { type: "effect", command: "judgeDamage", actionId: "action.damageJudge" },
          combatSnapshot: { role: "attacker" },
          characterType: isSoldierType(attackerUnit, context.components) ? "soldier" : undefined,
        };
        moveUnitToGraveyard(
          attackerUnit,
          combat.attackerPlayerKey,
          state,
          effectInterpreter,
          context,
          metadata
        );
      }
    } else {
      // 生存アタッカーの battle cleanup
      if (attackerUnit && attackerUnit.battle) {
        delete attackerUnit.battle;
      }
    }

    // 1-4. ブロッカーの墓地移動
    if (combat.blockersMovedToGrave.length > 0 && combat.blockerPlayerKey) {
      const blockerPlayer = state.players[combat.blockerPlayerKey];
      for (const blockerId of combat.blockersMovedToGrave) {
        const blockerUnit = blockerPlayer?.field?.find((u: any) => u.unitId === blockerId);
        if (blockerUnit) {
          const isBulwark = isBulwarkType(blockerUnit, context.components);
          const metadata: MoveUnitMetadata = {
            cause: { type: "effect", command: "judgeDamage", actionId: "action.damageJudge" },
            combatSnapshot: {
              role: "blocker",
              blocksUnitId: combat.attackerUnitId,
              attackerPlayerKey: combat.attackerPlayerKey,
            },
            characterType: isBulwark ? "bulwark" : "soldier",
          };
          moveUnitToGraveyard(
            blockerUnit,
            combat.blockerPlayerKey,
            state,
            effectInterpreter,
            context,
            metadata
          );
        }
      }
    }

    // 1-5. 革命時の差分ダメージ (兵士の墓地移動後に適用)
    if (combat.differenceDamage && combat.differenceDamage.amount > 0) {
      const diffDamageContext: CommandContext = {
        ...context,
        targetPlayerKey: combat.differenceDamage.targetPlayerKey,
      };

      ((effectInterpreter as any).registry).execute(
        "dealDamage",
        { target: "targetPlayer", amount: combat.differenceDamage.amount },
        diffDamageContext
      );
    }

    // 1-6. 生存ブロッカーの battle cleanup
    if (combat.blockerPlayerKey) {
      const blockerPlayer = state.players[combat.blockerPlayerKey];
      for (const blockerId of combat.blockerUnitIds) {
        if (!combat.blockersMovedToGrave.includes(blockerId)) {
          const survivorBlocker = blockerPlayer?.field?.find((u: any) => u.unitId === blockerId);
          if (survivorBlocker && survivorBlocker.battle) {
            delete survivorBlocker.battle;
          }
        }
      }
    }
  }

  // 2. Orphan Blockers の battle cleanup
  for (const orphan of result.orphanBlockerUnitIds) {
    const player = state.players[orphan.blockerPlayerKey];
    const unit = player?.field?.find((u: any) => u.unitId === orphan.blockerUnitId);
    if (unit && unit.battle) {
      delete unit.battle;
    }
  }
}
