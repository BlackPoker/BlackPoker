/**
 * Scenario Definition V1
 *
 * BlackPoker Scenario Builder の高レベル抽象シナリオ定義型およびランタイムバリデーター。
 * Raw GameState, stateVersion, 内部 unitId / cardId, raw stage.requests,
 * および「Phase」概念を一切含まず、ゲームとして意味のある概念のみで構成されます。
 */

export const SCENARIO_SCHEMA_VERSION = 1;

/**
 * 高レベルカード参照
 * Canonical Deck Profile の定義に準拠し、Joker は suit: "J", rank: "Joker" とします。
 */
export interface ScenarioCardRefV1 {
  readonly suit: "S" | "H" | "D" | "C" | "J";
  readonly rank: string;
  /**
   * 同一 (suit, rank) を持つ物理カードがデッキ内に複数存在する場合の 0-indexed occurrence。
   * 該当カードがデッキ内に1枚のみの場合は省略可能（自動的に 0 として解決）。
   */
  readonly occurrence?: number;
}

/**
 * Life や Pack などの Zone 設定。
 */
export interface ScenarioZoneConfigV1 {
  readonly cards?: readonly ScenarioCardRefV1[];
  readonly count?: number;
}

/**
 * フィールドユニット定義。
 * cards は複数カード構成に対応（1枚以上）。
 * kind や labels などの派生プロパティは含めず、componentId からコンパイラが自動導出します。
 */
export interface ScenarioUnitV1 {
  readonly componentId: string;
  readonly cards: readonly ScenarioCardRefV1[];
  readonly state: "charge" | "drive";
  readonly face: "up" | "down";
}

/**
 * プレイヤーごとの配置設定
 */
export interface ScenarioPlayerV1 {
  readonly hand?: readonly ScenarioCardRefV1[];
  readonly life?: ScenarioZoneConfigV1;
  readonly field?: readonly ScenarioUnitV1[];
  /**
   * 墓地カードリスト。
   * 配列の末尾（最後の要素）が墓地最上段 (graveTop) として決定論的に扱われます。
   */
  readonly grave?: readonly ScenarioCardRefV1[];
  readonly pack?: ScenarioZoneConfigV1;
}

/**
 * 高レベルシナリオ定義 V1
 */
export interface ScenarioDefinitionV1 {
  readonly version: 1;
  readonly name?: string;
  readonly description?: string;
  readonly environmentId: string; // official:<regulationId> のみ許可 (core-battle は V1 対象外)
  readonly seed: number;
  readonly turnPlayer: "p1" | "p2";
  readonly chancePlayer: "p1" | "p2";
  readonly turnCount?: number;
  readonly players: {
    readonly p1: ScenarioPlayerV1;
    readonly p2: ScenarioPlayerV1;
  };
}

export type ScenarioValidationErrorCode =
  | "UNSUPPORTED_VERSION"
  | "UNSUPPORTED_ENVIRONMENT"
  | "INVALID_SEED"
  | "INVALID_PLAYER"
  | "INVALID_CARD_REF"
  | "AMBIGUOUS_CARD_REFERENCE"
  | "DUPLICATE_CARD"
  | "UNSUPPORTED_COMPONENT"
  | "INVALID_UNIT_STATE"
  | "INVALID_UNIT_FACE"
  | "INVALID_ZONE_CONFIG"
  | "DECK_COMPLETION_IMPOSSIBLE"
  | "UNSUPPORTED_STAGE"
  | "SCHEMA_VIOLATION"
  | "VALIDATION_ERROR";

export interface ScenarioValidationError {
  readonly code: ScenarioValidationErrorCode;
  readonly path: string;
  readonly message: string;
}

export interface ScenarioValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ScenarioValidationError[];
}

export interface ScenarioParseResult {
  readonly success: boolean;
  readonly definition?: ScenarioDefinitionV1;
  readonly errors?: readonly ScenarioValidationError[];
}

const VALID_SUITS: readonly ("S" | "H" | "D" | "C" | "J")[] = ["S", "H", "D", "C", "J"];

const TOP_LEVEL_ALLOWED_KEYS = new Set([
  "version",
  "name",
  "description",
  "environmentId",
  "seed",
  "turnPlayer",
  "chancePlayer",
  "turnCount",
  "players",
]);

const PLAYER_ALLOWED_KEYS = new Set([
  "hand",
  "life",
  "field",
  "grave",
  "pack",
]);

const ZONE_CONFIG_ALLOWED_KEYS = new Set([
  "cards",
  "count",
]);

const UNIT_ALLOWED_KEYS = new Set([
  "componentId",
  "cards",
  "state",
  "face",
]);

const CARD_REF_ALLOWED_KEYS = new Set([
  "suit",
  "rank",
  "occurrence",
]);

function checkUnknownKeys(
  obj: Record<string, any>,
  allowedKeys: Set<string>,
  path: string,
  errors: ScenarioValidationError[]
): void {
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      const phaseNote = key.toLowerCase().includes("phase") ? " (BlackPoker にゲーム進行上の Phase は存在しません)" : "";
      errors.push({
        code: "SCHEMA_VIOLATION",
        path: path ? `${path}.${key}` : key,
        message: `未知または禁止されたプロパティ "${key}" が検出されました。${phaseNote}`,
      });
    }
  }
}

function validateCardRef(
  card: any,
  path: string,
  errors: ScenarioValidationError[]
): ScenarioCardRefV1 | null {
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    errors.push({
      code: "INVALID_CARD_REF",
      path,
      message: "カード参照がオブジェクトではありません。",
    });
    return null;
  }

  checkUnknownKeys(card, CARD_REF_ALLOWED_KEYS, path, errors);

  if (!card.suit || !VALID_SUITS.includes(card.suit)) {
    errors.push({
      code: "INVALID_CARD_REF",
      path: `${path}.suit`,
      message: `無効なスート記号です: "${card.suit}" (有効値: ${VALID_SUITS.join(", ")})。`,
    });
  }

  if (card.rank === undefined || typeof card.rank !== "string" || card.rank.length === 0) {
    errors.push({
      code: "INVALID_CARD_REF",
      path: `${path}.rank`,
      message: "カードランクが文字列として指定されていません。",
    });
  }

  if (card.occurrence !== undefined) {
    if (typeof card.occurrence !== "number" || !Number.isSafeInteger(card.occurrence) || card.occurrence < 0) {
      errors.push({
        code: "INVALID_CARD_REF",
        path: `${path}.occurrence`,
        message: `無効な occurrence です (${card.occurrence})。非負の安全な整数を指定してください。`,
      });
    }
  }

  return {
    suit: card.suit,
    rank: String(card.rank),
    ...(card.occurrence !== undefined ? { occurrence: card.occurrence } : {}),
  };
}

/**
 * 外部入力（URLパラメータ、JSON、ファイル等）から ScenarioDefinitionV1 を厳格パース・検証します。
 * 未知プロパティ、内部プロパティ、不正な型や数値をすべて fail-closed で弾きます。
 */
export function parseScenarioDefinitionV1(raw: unknown): ScenarioParseResult {
  const errors: ScenarioValidationError[] = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      success: false,
      errors: [
        {
          code: "SCHEMA_VIOLATION",
          path: "",
          message: "シナリオ定義はオブジェクトでなければなりません。",
        },
      ],
    };
  }

  const rawObj = raw as Record<string, any>;

  // トップレベル未知キーの拒絶
  checkUnknownKeys(rawObj, TOP_LEVEL_ALLOWED_KEYS, "", errors);

  // version 検証
  if (rawObj.version !== SCENARIO_SCHEMA_VERSION) {
    errors.push({
      code: "UNSUPPORTED_VERSION",
      path: "version",
      message: `サポートされていないScenarioバージョンです (${rawObj.version})。バージョン ${SCENARIO_SCHEMA_VERSION} を指定してください。`,
    });
  }

  // environmentId 検証
  if (!rawObj.environmentId || typeof rawObj.environmentId !== "string") {
    errors.push({
      code: "UNSUPPORTED_ENVIRONMENT",
      path: "environmentId",
      message: "environmentId が指定されていません。",
    });
  } else if (rawObj.environmentId === "core-battle") {
    errors.push({
      code: "UNSUPPORTED_ENVIRONMENT",
      path: "environmentId",
      message: "Core Battle は開発用プリセットのため Scenario Builder V1 の対象外です。公式レギュレーションを指定してください。",
    });
  } else if (!rawObj.environmentId.startsWith("official:")) {
    errors.push({
      code: "UNSUPPORTED_ENVIRONMENT",
      path: "environmentId",
      message: `不正な環境ID形式です: "${rawObj.environmentId}"。"official:<regulationId>" 形式で指定してください。`,
    });
  }

  // seed 検証
  if (
    typeof rawObj.seed !== "number" ||
    !Number.isSafeInteger(rawObj.seed) ||
    rawObj.seed < 0
  ) {
    errors.push({
      code: "INVALID_SEED",
      path: "seed",
      message: `無効なSeedです (${rawObj.seed})。非負の安全な整数を指定してください。`,
    });
  }

  // turnPlayer 検証
  if (rawObj.turnPlayer !== "p1" && rawObj.turnPlayer !== "p2") {
    errors.push({
      code: "INVALID_PLAYER",
      path: "turnPlayer",
      message: `無効なturnPlayerです ("${rawObj.turnPlayer}")。"p1" または "p2" を指定してください。`,
    });
  }

  // chancePlayer 検証
  if (rawObj.chancePlayer !== "p1" && rawObj.chancePlayer !== "p2") {
    errors.push({
      code: "INVALID_PLAYER",
      path: "chancePlayer",
      message: `無効なchancePlayerです ("${rawObj.chancePlayer}")。"p1" または "p2" を指定してください。`,
    });
  }

  // turnCount 検証 (省略可能。指定時は safe integer >= 1)
  if (rawObj.turnCount !== undefined) {
    if (
      typeof rawObj.turnCount !== "number" ||
      !Number.isSafeInteger(rawObj.turnCount) ||
      rawObj.turnCount < 1
    ) {
      errors.push({
        code: "SCHEMA_VIOLATION",
        path: "turnCount",
        message: `無効なturnCountです (${rawObj.turnCount})。1以上の安全な整数を指定してください。`,
      });
    }
  }

  // name, description 検証
  if (rawObj.name !== undefined && typeof rawObj.name !== "string") {
    errors.push({
      code: "SCHEMA_VIOLATION",
      path: "name",
      message: "name は文字列でなければなりません。",
    });
  }
  if (rawObj.description !== undefined && typeof rawObj.description !== "string") {
    errors.push({
      code: "SCHEMA_VIOLATION",
      path: "description",
      message: "description は文字列でなければなりません。",
    });
  }

  // players 検証
  if (!rawObj.players || typeof rawObj.players !== "object" || Array.isArray(rawObj.players)) {
    errors.push({
      code: "SCHEMA_VIOLATION",
      path: "players",
      message: "players オブジェクトが未定義または無効です。",
    });
  } else {
    const playersObj = rawObj.players as Record<string, any>;
    for (const pKey of Object.keys(playersObj)) {
      if (pKey !== "p1" && pKey !== "p2") {
        errors.push({
          code: "SCHEMA_VIOLATION",
          path: `players.${pKey}`,
          message: `無効なプレイヤーキー "${pKey}" です ("p1", "p2" のみ許可)。`,
        });
      }
    }

    if (!playersObj.p1) {
      errors.push({
        code: "SCHEMA_VIOLATION",
        path: "players.p1",
        message: "players.p1 が未定義です。",
      });
    }
    if (!playersObj.p2) {
      errors.push({
        code: "SCHEMA_VIOLATION",
        path: "players.p2",
        message: "players.p2 が未定義です。",
      });
    }

    for (const pKey of ["p1", "p2"] as const) {
      const p = playersObj[pKey];
      if (!p) continue;
      if (typeof p !== "object" || Array.isArray(p)) {
        errors.push({
          code: "SCHEMA_VIOLATION",
          path: `players.${pKey}`,
          message: `players.${pKey} はオブジェクトでなければなりません。`,
        });
        continue;
      }

      checkUnknownKeys(p, PLAYER_ALLOWED_KEYS, `players.${pKey}`, errors);

      // hand 検証
      if (p.hand !== undefined) {
        if (!Array.isArray(p.hand)) {
          errors.push({
            code: "SCHEMA_VIOLATION",
            path: `players.${pKey}.hand`,
            message: "hand は配列でなければなりません。",
          });
        } else {
          for (let i = 0; i < p.hand.length; i++) {
            validateCardRef(p.hand[i], `players.${pKey}.hand[${i}]`, errors);
          }
        }
      }

      // grave 検証
      if (p.grave !== undefined) {
        if (!Array.isArray(p.grave)) {
          errors.push({
            code: "SCHEMA_VIOLATION",
            path: `players.${pKey}.grave`,
            message: "grave は配列でなければなりません。",
          });
        } else {
          for (let i = 0; i < p.grave.length; i++) {
            validateCardRef(p.grave[i], `players.${pKey}.grave[${i}]`, errors);
          }
        }
      }

      // life 検証
      if (p.life !== undefined) {
        if (typeof p.life !== "object" || Array.isArray(p.life) || p.life === null) {
          errors.push({
            code: "SCHEMA_VIOLATION",
            path: `players.${pKey}.life`,
            message: "life はオブジェクト (ScenarioZoneConfigV1) でなければなりません。",
          });
        } else {
          checkUnknownKeys(p.life, ZONE_CONFIG_ALLOWED_KEYS, `players.${pKey}.life`, errors);
          let cardsLen = 0;
          if (p.life.cards !== undefined) {
            if (!Array.isArray(p.life.cards)) {
              errors.push({
                code: "SCHEMA_VIOLATION",
                path: `players.${pKey}.life.cards`,
                message: "life.cards は配列でなければなりません。",
              });
            } else {
              cardsLen = p.life.cards.length;
              for (let i = 0; i < p.life.cards.length; i++) {
                validateCardRef(p.life.cards[i], `players.${pKey}.life.cards[${i}]`, errors);
              }
            }
          }
          if (p.life.count !== undefined) {
            if (
              typeof p.life.count !== "number" ||
              !Number.isSafeInteger(p.life.count) ||
              p.life.count < 0
            ) {
              errors.push({
                code: "INVALID_ZONE_CONFIG",
                path: `players.${pKey}.life.count`,
                message: `無効な life.count です (${p.life.count})。非負の安全な整数を指定してください。`,
              });
            } else if (p.life.count < cardsLen) {
              errors.push({
                code: "INVALID_ZONE_CONFIG",
                path: `players.${pKey}.life.count`,
                message: `life の目標枚数 (${p.life.count}) は指定された固定カード枚数 (${cardsLen}) 以上でなければなりません。`,
              });
            }
          }
        }
      }

      // pack 検証
      if (p.pack !== undefined) {
        if (typeof p.pack !== "object" || Array.isArray(p.pack) || p.pack === null) {
          errors.push({
            code: "SCHEMA_VIOLATION",
            path: `players.${pKey}.pack`,
            message: "pack はオブジェクト (ScenarioZoneConfigV1) でなければなりません。",
          });
        } else {
          checkUnknownKeys(p.pack, ZONE_CONFIG_ALLOWED_KEYS, `players.${pKey}.pack`, errors);
          let cardsLen = 0;
          if (p.pack.cards !== undefined) {
            if (!Array.isArray(p.pack.cards)) {
              errors.push({
                code: "SCHEMA_VIOLATION",
                path: `players.${pKey}.pack.cards`,
                message: "pack.cards は配列でなければなりません。",
              });
            } else {
              cardsLen = p.pack.cards.length;
              for (let i = 0; i < p.pack.cards.length; i++) {
                validateCardRef(p.pack.cards[i], `players.${pKey}.pack.cards[${i}]`, errors);
              }
            }
          }
          if (p.pack.count !== undefined) {
            if (
              typeof p.pack.count !== "number" ||
              !Number.isSafeInteger(p.pack.count) ||
              p.pack.count < 0
            ) {
              errors.push({
                code: "INVALID_ZONE_CONFIG",
                path: `players.${pKey}.pack.count`,
                message: `無効な pack.count です (${p.pack.count})。非負の安全な整数を指定してください。`,
              });
            } else if (p.pack.count < cardsLen) {
              errors.push({
                code: "INVALID_ZONE_CONFIG",
                path: `players.${pKey}.pack.count`,
                message: `pack の目標枚数 (${p.pack.count}) は指定された固定カード枚数 (${cardsLen}) 以上でなければなりません。`,
              });
            }
          }
        }
      }

      // field 検証
      if (p.field !== undefined) {
        if (!Array.isArray(p.field)) {
          errors.push({
            code: "SCHEMA_VIOLATION",
            path: `players.${pKey}.field`,
            message: "field は配列でなければなりません。",
          });
        } else {
          for (let uIdx = 0; uIdx < p.field.length; uIdx++) {
            const u = p.field[uIdx];
            const uPath = `players.${pKey}.field[${uIdx}]`;
            if (!u || typeof u !== "object" || Array.isArray(u)) {
              errors.push({
                code: "SCHEMA_VIOLATION",
                path: uPath,
                message: "ユニット定義がオブジェクトではありません。",
              });
              continue;
            }

            checkUnknownKeys(u, UNIT_ALLOWED_KEYS, uPath, errors);

            if (!u.componentId || typeof u.componentId !== "string") {
              errors.push({
                code: "UNSUPPORTED_COMPONENT",
                path: `${uPath}.componentId`,
                message: "componentId が指定されていません。",
              });
            }

            // cards は必須で非空配列
            if (!u.cards || !Array.isArray(u.cards) || u.cards.length === 0) {
              errors.push({
                code: "SCHEMA_VIOLATION",
                path: `${uPath}.cards`,
                message: "cards は1枚以上のカード参照配列でなければなりません。",
              });
            } else {
              for (let cIdx = 0; cIdx < u.cards.length; cIdx++) {
                validateCardRef(u.cards[cIdx], `${uPath}.cards[${cIdx}]`, errors);
              }
            }

            if (u.state === undefined || (u.state !== "charge" && u.state !== "drive")) {
              errors.push({
                code: "INVALID_UNIT_STATE",
                path: `${uPath}.state`,
                message: `ユニットの state は必須であり、"charge" または "drive" を指定してください (現在: "${u.state}")。`,
              });
            }

            if (u.face === undefined || (u.face !== "up" && u.face !== "down")) {
              errors.push({
                code: "INVALID_UNIT_FACE",
                path: `${uPath}.face`,
                message: `ユニットの face は必須であり、"up" または "down" を指定してください (現在: "${u.face}")。`,
              });
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    definition: rawObj as unknown as ScenarioDefinitionV1,
  };
}

/**
 * ScenarioDefinitionV1 を決定論的な Canonical 形式へ正規化します。
 * turnCount 省略時の 1 補完や、省略可能プロパティの整理を行い、
 * Compiler / URL Codec / Hash 生成 / UI Round-Trip で同一の表現を保証します。
 */
export function normalizeScenarioDefinitionV1(def: ScenarioDefinitionV1): ScenarioDefinitionV1 {
  const normName = def.name?.trim() ? def.name.trim() : undefined;
  const normDesc = def.description?.trim() ? def.description.trim() : undefined;

  const normalizePlayer = (p: ScenarioPlayerV1): ScenarioPlayerV1 => {
    const hand = p.hand && p.hand.length > 0
      ? p.hand.map((c) => ({
          suit: c.suit,
          rank: c.rank,
          ...(c.occurrence !== undefined ? { occurrence: c.occurrence } : {}),
        }))
      : undefined;

    const grave = p.grave && p.grave.length > 0
      ? p.grave.map((c) => ({
          suit: c.suit,
          rank: c.rank,
          ...(c.occurrence !== undefined ? { occurrence: c.occurrence } : {}),
        }))
      : undefined;

    const field = p.field && p.field.length > 0
      ? p.field.map((u) => ({
          componentId: u.componentId,
          cards: u.cards.map((c) => ({
            suit: c.suit,
            rank: c.rank,
            ...(c.occurrence !== undefined ? { occurrence: c.occurrence } : {}),
          })),
          state: u.state,
          face: u.face,
        }))
      : undefined;

    let life: ScenarioZoneConfigV1 | undefined = undefined;
    if (p.life) {
      const lifeCards = p.life.cards && p.life.cards.length > 0
        ? p.life.cards.map((c) => ({
            suit: c.suit,
            rank: c.rank,
            ...(c.occurrence !== undefined ? { occurrence: c.occurrence } : {}),
          }))
        : undefined;
      const count = p.life.count;
      if (lifeCards !== undefined || count !== undefined) {
        life = {
          ...(lifeCards !== undefined ? { cards: lifeCards } : {}),
          ...(count !== undefined ? { count } : {}),
        };
      }
    }

    let pack: ScenarioZoneConfigV1 | undefined = undefined;
    if (p.pack) {
      const packCards = p.pack.cards && p.pack.cards.length > 0
        ? p.pack.cards.map((c) => ({
            suit: c.suit,
            rank: c.rank,
            ...(c.occurrence !== undefined ? { occurrence: c.occurrence } : {}),
          }))
        : undefined;
      const count = p.pack.count;
      if (packCards !== undefined || count !== undefined) {
        pack = {
          ...(packCards !== undefined ? { cards: packCards } : {}),
          ...(count !== undefined ? { count } : {}),
        };
      }
    }

    return {
      ...(hand !== undefined ? { hand } : {}),
      ...(life !== undefined ? { life } : {}),
      ...(field !== undefined ? { field } : {}),
      ...(grave !== undefined ? { grave } : {}),
      ...(pack !== undefined ? { pack } : {}),
    };
  };

  return {
    version: 1,
    environmentId: def.environmentId.trim(),
    seed: def.seed,
    turnPlayer: def.turnPlayer,
    chancePlayer: def.chancePlayer,
    turnCount: def.turnCount !== undefined ? def.turnCount : 1,
    ...(normName !== undefined ? { name: normName } : {}),
    ...(normDesc !== undefined ? { description: normDesc } : {}),
    players: {
      p1: normalizePlayer(def.players.p1),
      p2: normalizePlayer(def.players.p2),
    },
  };
}
