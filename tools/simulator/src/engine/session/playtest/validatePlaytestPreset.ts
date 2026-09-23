import { RulePackage, ComponentDefinition } from "../../../domain/rules/RulePackage";

export interface PresetValidationResult {
  valid: boolean;
  errors: string[];
}

// スーツの正規化 ("H", "heart", "hearts" -> "heart")
export function normalizeSuit(suit?: string): string {
  if (!suit) return "";
  const s = suit.toLowerCase();
  if (s === "h" || s === "heart" || s === "hearts") return "heart";
  if (s === "d" || s === "diamond" || s === "diamonds") return "diamond";
  if (s === "s" || s === "spade" || s === "spades") return "spade";
  if (s === "c" || s === "club" || s === "clubs") return "club";
  if (s === "j" || s === "joker") return "joker";
  return s;
}

// ランクが範囲内に含まれるかチェック
export function isRankInRange(rank: string, rangeStr: string): boolean {
  if (!rank || !rangeStr) return true;
  const standardRanks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const rankIndex = standardRanks.indexOf(rank.toUpperCase());
  if (rankIndex === -1) return false;

  if (rangeStr.includes("..")) {
    const [minStr, maxStr] = rangeStr.split("..");
    const minIdx = standardRanks.indexOf(minStr.trim().toUpperCase());
    const maxIdx = standardRanks.indexOf(maxStr.trim().toUpperCase());
    if (minIdx === -1 || maxIdx === -1) return false;
    return rankIndex >= minIdx && rankIndex <= maxIdx;
  }

  return rank.toUpperCase() === rangeStr.trim().toUpperCase();
}

export interface UnitValidationTarget {
  readonly unitId?: string;
  readonly componentId: string;
  readonly cards: readonly { readonly suit: string; readonly rank: string; [k: string]: any }[];
  readonly state?: string;
  readonly face?: string;
  readonly kind?: string;
}

/**
 * ユニット定義とコンポーネント定義の整合性を検証する純粋関数。
 * field 配置可能であること (compDef.zone === 'field')、カード条件、state、face、初期制約を検査します。
 */
export function validateUnitAgainstComponentDefinition(
  unit: UnitValidationTarget,
  compDef: ComponentDefinition,
  options?: { readonly playerKey?: string; readonly unitIndex?: number }
): string[] {
  const errors: string[] = [];
  const pKey = options?.playerKey ? `プレイヤー ${options.playerKey} の` : "";
  const unitLabel = unit.unitId || `ユニット[${options?.unitIndex ?? 0}]`;

  // 1. Zone 検証: field 配置可能であること (compDef.zone === "field" が必須)
  if (compDef.zone !== "field") {
    errors.push(
      `${pKey}ユニット ${unitLabel} (${compDef.id}) は field 配置可能なコンポーネントではありません (定義zone: '${compDef.zone}')`
    );
  }

  // 2. face 条件の検証 (YAML ComponentDefinition SSOT)
  const expectedFace = (compDef as any).unitCondition?.face;
  if (expectedFace !== undefined) {
    const actualFace = unit.face ?? "up";
    if (actualFace !== expectedFace) {
      errors.push(
        `${pKey}ユニット ${unitLabel} (${compDef.id}) の face (向き) '${actualFace}' がコンポーネント定義の条件 '${expectedFace}' と一致しません`
      );
    }
  }

  // 3. state 検証 (charge / drive)
  if (unit.state && unit.state !== "charge" && unit.state !== "drive") {
    errors.push(
      `${pKey}ユニット ${unitLabel} の state '${unit.state}' は無効です ('charge' または 'drive' を指定してください)`
    );
  }

  // 4. face 検証 (up / down)
  if (unit.face && unit.face !== "up" && unit.face !== "down") {
    errors.push(
      `${pKey}ユニット ${unitLabel} の face '${unit.face}' は無効です ('up' または 'down' を指定してください)`
    );
  }

  // 5. unitCondition.cards の検証
  const unitCards = Array.isArray(unit.cards) ? unit.cards : [];
  if (unitCards.length === 0) {
    errors.push(`${pKey}ユニット ${unitLabel} (${compDef.id}) にカードが設定されていません`);
  }

  const cardCond = (compDef as any).unitCondition?.cards;
  if (cardCond) {
    // 固定枚数
    if (cardCond.count !== undefined && unitCards.length !== cardCond.count) {
      errors.push(
        `${pKey}ユニット ${unitLabel} (${compDef.id}) のカード枚数は ${cardCond.count} 枚である必要があります (実際: ${unitCards.length}枚)`
      );
    }
    // 最小枚数
    if (cardCond.minCount !== undefined && unitCards.length < cardCond.minCount) {
      errors.push(
        `${pKey}ユニット ${unitLabel} (${compDef.id}) のカード枚数は最低 ${cardCond.minCount} 枚必要です (実際: ${unitCards.length}枚)`
      );
    }
    // 最大枚数
    if (cardCond.maxCount !== undefined && unitCards.length > cardCond.maxCount) {
      errors.push(
        `${pKey}ユニット ${unitLabel} (${compDef.id}) のカード枚数は最大 ${cardCond.maxCount} 枚までです (実際: ${unitCards.length}枚)`
      );
    }

    // スーツ検証
    if (cardCond.suit) {
      const allowedSuits: string[] = Array.isArray(cardCond.suit)
        ? cardCond.suit.map(normalizeSuit)
        : [normalizeSuit(cardCond.suit)];

      for (const c of unitCards) {
        const cardSuitNorm = normalizeSuit(c.suit);
        if (!allowedSuits.includes(cardSuitNorm)) {
          errors.push(
            `${pKey}ユニット ${unitLabel} (${compDef.id}) のカードスーツ '${c.suit}' は許可されていません (許可: ${allowedSuits.join(", ")})`
          );
        }
      }
    }

    // ランク検証
    if (cardCond.rank) {
      const rankRange = String(cardCond.rank);
      for (const c of unitCards) {
        if (!isRankInRange(c.rank, rankRange)) {
          errors.push(
            `${pKey}ユニット ${unitLabel} (${compDef.id}) のカードランク '${c.rank}' は範囲 '${rankRange}' に含まれていません`
          );
        }
      }
    }
  }

  return errors;
}

/**
 * Playtest 用のプリセット GameState が BlackPoker ルールおよび仕様に整合しているか検証します。
 */
export function validatePlaytestPreset(
  state: any,
  rulePackage: RulePackage
): PresetValidationResult {
  const errors: string[] = [];

  if (!state) {
    return { valid: false, errors: ["State が存在しません"] };
  }

  if (!state.players || typeof state.players !== "object") {
    return { valid: false, errors: ["state.players が不正です"] };
  }

  const playerKeys = ["p1", "p2"];
  for (const pKey of playerKeys) {
    const player = state.players[pKey];
    if (!player) {
      errors.push(`プレイヤー ${pKey} が存在しません`);
      continue;
    }

    // 1. Life の検証
    if (!Array.isArray(player.life)) {
      errors.push(`プレイヤー ${pKey} の life が Card[] 配列ではありません`);
    } else {
      for (let i = 0; i < player.life.length; i++) {
        const card = player.life[i];
        if (!card || !card.suit || card.rank === undefined) {
          errors.push(`プレイヤー ${pKey} の life[${i}] のカード情報が不正です`);
        }
      }
    }

    // 2. Hand の検証
    if (!Array.isArray(player.hand)) {
      errors.push(`プレイヤー ${pKey} の hand が Card[] 配列ではありません`);
    } else {
      for (let i = 0; i < player.hand.length; i++) {
        const card = player.hand[i];
        if (!card || !card.suit || card.rank === undefined) {
          errors.push(`プレイヤー ${pKey} の hand[${i}] のカード情報が不正です`);
        }
      }
    }

    // 3. 同一プレイヤー内でのカード（suit + rank）重複チェック
    const seenCards = new Map<string, string>(); // "suit:rank" -> zone

    const checkCardUnique = (card: any, zone: string) => {
      if (!card || !card.suit || card.rank === undefined) return;
      const key = `${normalizeSuit(card.suit)}:${card.rank}`;
      if (seenCards.has(key)) {
        const prevZone = seenCards.get(key);
        errors.push(
          `プレイヤー ${pKey} 内でカード ${card.suit}${card.rank} が重複しています (${prevZone} と ${zone})`
        );
      } else {
        seenCards.set(key, zone);
      }
    };

    if (Array.isArray(player.life)) {
      player.life.forEach((c: any) => checkCardUnique(c, "life"));
    }
    if (Array.isArray(player.hand)) {
      player.hand.forEach((c: any) => checkCardUnique(c, "hand"));
    }
    if (Array.isArray(player.field)) {
      player.field.forEach((u: any) => {
        if (Array.isArray(u.cards)) {
          u.cards.forEach((c: any) => checkCardUnique(c, `field unit ${u.unitId}`));
        }
      });
    }
    if (Array.isArray(player.fog)) {
      player.fog.forEach((f: any) => checkCardUnique(f.card, "fog"));
    }
    if (Array.isArray(player.grave)) {
      player.grave.forEach((g: any) => {
        if (Array.isArray(g.cards)) {
          g.cards.forEach((c: any) => checkCardUnique(c, "grave"));
        } else if (g.suit) {
          checkCardUnique(g, "grave");
        }
      });
    }

    // 4. Field ユニットの検証
    if (!Array.isArray(player.field)) {
      errors.push(`プレイヤー ${pKey} の field が配列ではありません`);
    } else {
      for (let uIdx = 0; uIdx < player.field.length; uIdx++) {
        const unit = player.field[uIdx];
        if (!unit.unitId) {
          errors.push(`プレイヤー ${pKey} のユニットに unitId がありません`);
          continue;
        }

        // componentId の存在確認
        const compDef = rulePackage.components.find((c) => c.id === unit.componentId);
        if (!compDef) {
          errors.push(
            `プレイヤー ${pKey} のユニット ${unit.unitId} の componentId '${unit.componentId}' が定義に存在しません`
          );
          continue;
        }

        // 共通 helper による適合性検証
        const unitErrors = validateUnitAgainstComponentDefinition(unit, compDef, {
          playerKey: pKey,
          unitIndex: uIdx,
        });
        errors.push(...unitErrors);
      }
    }
  }

  // 5. Stage / RequestBuffer 初期状態確認
  if (state.stage?.requests && state.stage.requests.length > 0) {
    errors.push("初期 state の stage.requests は空配列である必要があります");
  }
  if (state.requestBuffer?.requests && state.requestBuffer.requests.length > 0) {
    errors.push("初期 state の requestBuffer.requests は空配列である必要があります");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
