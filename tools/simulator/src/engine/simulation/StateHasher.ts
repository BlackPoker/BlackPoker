/**
 * 決定論的 Logical State Hash 生成ユーティリティ (State Hash v2)。
 * ゲームの進行に影響する論理状態のみを抽出し、オブジェクトキーの順序や実行時タイムスタンプ・ランタイムIDに依存しない
 * 安定した fingerprint (State Hash) を算出します。
 *
 * v2 の改善点:
 * 1. BlackPoker に存在しない phase フィールドの完全削除
 * 2. 単一文字列への潰しを廃止し、entity identity と参照関係を完全に保持する決定論的 ID Canonicalization
 * 3. ActionRequest 正式構造 (keyCards 配列、targets 等) の完全反映
 * 4. Request Buffer の Stage との明確な分離と正式構造反映
 * 5. 標準 FNV-1a 64-bit ハッシュ (BigInt による正確な実装、ブラウザ/Node両対応)
 */

export interface StateHashResult {
  readonly stateHashVersion: number;
  readonly stateHash: string;
}

export class StateHasher {
  public static readonly VERSION = 2;

  /**
   * 与えられた GameState から論理状態のハッシュ文字列 (例: "sh2-0123456789abcdef") を算出
   */
  static hash(state: any): string {
    return this.computeHash(state).stateHash;
  }

  /**
   * 与えられた GameState から StateHashResult を算出
   */
  static computeHash(state: any): StateHashResult {
    if (!state) {
      return {
        stateHashVersion: this.VERSION,
        stateHash: `sh${this.VERSION}-null`,
      };
    }

    const logical = this.extractLogicalState(state);
    const canonicalJson = this.canonicalStringify(logical);
    const hashHex = this.fnv1a64(canonicalJson);

    return {
      stateHashVersion: this.VERSION,
      stateHash: `sh${this.VERSION}-${hashHex}`,
    };
  }

  /**
   * 与えられた文字列 ID がランタイム動的生成 ID かどうか判定
   */
  private static isDynamicId(id: any): boolean {
    if (!id || typeof id !== "string") return false;
    return /\d{10,}/.test(id) || id.includes("runtime-") || (id.startsWith("dec-") && /\d+/.test(id));
  }

  /**
   * 動的 ID のプレフィックスを抽出 (例: "unit-cost-1788..." -> "unit-cost", "req-trg-1788..." -> "req-trg")
   */
  private static extractPrefix(id: string, defaultPrefix = "entity"): string {
    const match = id.match(/^([a-zA-Z_-]+?)(?:-\d{10,}|-\d{5,}|$)/);
    return match ? match[1] : defaultPrefix;
  }

  /**
   * GameState からゲーム結果・進行に影響する論理状態のみを抽出。
   * ※ タイムスタンプ、UI状態、React状態、MatchLog内部状態は除外します。
   */
  static extractLogicalState(state: any): any {
    if (!state || typeof state !== "object") return state;

    // 決定論的 ID マッピングテーブル
    const idMap = new Map<string, string>();
    const prefixCounters = new Map<string, number>();

    const registerId = (rawId: any, defaultPrefix = "entity") => {
      if (!rawId || typeof rawId !== "string") return;
      if (this.isDynamicId(rawId) && !idMap.has(rawId)) {
        const prefix = this.extractPrefix(rawId, defaultPrefix);
        const count = (prefixCounters.get(prefix) || 0) + 1;
        prefixCounters.set(prefix, count);
        idMap.set(rawId, `${prefix}#${count}`);
      }
    };

    const resolveId = (rawId: any): string | undefined => {
      if (!rawId || typeof rawId !== "string") return undefined;
      return idMap.get(rawId) || rawId;
    };

    // ------------------------------------------------------------------------
    // Pass 1: 決定論的 Traversal 順序で全エンティティの ID を登録
    // ------------------------------------------------------------------------
    // 1. Players
    if (state.players && typeof state.players === "object") {
      const pKeys = Object.keys(state.players).sort();
      for (const pKey of pKeys) {
        const p = state.players[pKey];
        if (!p) continue;

        // Cards (Hand / Life)
        if (Array.isArray(p.hand)) {
          p.hand.forEach((c: any) => registerId(c?.id, "card"));
        }
        if (Array.isArray(p.life)) {
          p.life.forEach((c: any) => registerId(c?.id, "card"));
        }

        // Units (Field)
        if (Array.isArray(p.field)) {
          p.field.forEach((u: any) => {
            registerId(u?.unitId, "unit");
            if (Array.isArray(u?.cards)) {
              u.cards.forEach((c: any) => registerId(c?.id, "card"));
            }
          });
        }

        // Fog
        if (Array.isArray(p.fog)) {
          p.fog.forEach((f: any) => {
            registerId(f?.fogId, "fog");
            registerId(f?.card?.id, "card");
          });
        }

        // Grave
        if (Array.isArray(p.grave)) {
          p.grave.forEach((item: any) => {
            if (item?.unitId) {
              registerId(item.unitId, "unit");
              if (Array.isArray(item.cards)) {
                item.cards.forEach((c: any) => registerId(c?.id, "card"));
              }
            } else {
              registerId(item?.id, "card");
            }
          });
        }

        // Trumps
        const trumps = p.trumps || p.trump;
        if (Array.isArray(trumps)) {
          trumps.forEach((t: any) => {
            registerId(t?.unitId, "unit");
            if (Array.isArray(t?.cards)) {
              t.cards.forEach((c: any) => registerId(c?.id, "card"));
            }
          });
        }
      }
    }

    // 2. Stage Requests (LIFO 配列順を維持)
    if (state.stage?.requests && Array.isArray(state.stage.requests)) {
      state.stage.requests.forEach((r: any) => {
        registerId(r?.id, "req");
        if (Array.isArray(r?.keyCards)) {
          r.keyCards.forEach((c: any) => registerId(c?.id, "card"));
        } else if (r?.keyCard) {
          registerId(r.keyCard.id, "card");
        }
      });
    }

    // 3. Request Buffer Requests
    if (state.requestBuffer?.requests && Array.isArray(state.requestBuffer.requests)) {
      state.requestBuffer.requests.forEach((r: any) => {
        registerId(r?.id, "buf-req");
        if (Array.isArray(r?.keyCards)) {
          r.keyCards.forEach((c: any) => registerId(c?.id, "card"));
        } else if (r?.keyCard) {
          registerId(r.keyCard.id, "card");
        }
      });
    }

    // ------------------------------------------------------------------------
    // Pass 2: 論理構造の抽出 & Canonical ID / 参照の置換 (Lookup のみ)
    // ------------------------------------------------------------------------
    const normalizeCard = (card: any): any => {
      if (!card) return undefined;
      if (typeof card === "string" || typeof card === "number") return card;
      return {
        id: resolveId(card.id),
        suit: card.suit,
        rank: card.rank,
        value: card.value ?? 0,
        code: card.code,
      };
    };

    const normalizeCardList = (list: any): any => {
      if (!list) return [];
      if (typeof list === "number") return list;
      if (!Array.isArray(list)) return [];
      return list.map((c) => normalizeCard(c));
    };

    const normalizeUnit = (unit: any): any => {
      if (!unit) return undefined;
      return {
        unitId: resolveId(unit.unitId),
        componentId: unit.componentId,
        kind: unit.kind,
        state: unit.state,
        face: unit.face,
        cards: normalizeCardList(unit.cards),
        labels: Array.isArray(unit.labels) ? [...unit.labels].sort() : [],
        battle: unit.battle
          ? {
              role: unit.battle.role,
              targetPlayerKey: unit.battle.targetPlayerKey,
              blocksUnitId: resolveId(unit.battle.blocksUnitId),
            }
          : undefined,
      };
    };

    const normalizeUnitList = (list: any): any => {
      if (!Array.isArray(list)) return [];
      return list.map((u) => normalizeUnit(u));
    };

    const normalizeFogList = (list: any): any => {
      if (!Array.isArray(list)) return [];
      return list.map((f) => ({
        fogId: resolveId(f.fogId),
        componentId: f.componentId,
        card: normalizeCard(f.card),
        bindings: f.bindings ? this.canonicalizeBindings(f.bindings, resolveId) : undefined,
      }));
    };

    const normalizeCardOrUnitList = (list: any): any => {
      if (!Array.isArray(list)) return [];
      return list.map((item) => {
        if (item?.unitId) {
          return normalizeUnit(item);
        }
        return normalizeCard(item);
      });
    };

    const logical: Record<string, any> = {
      presetId: state.presetId,
      turnCount: state.turnCount ?? 1,
      turnPlayer: state.turnPlayer,
      chancePlayer: state.chancePlayer,
      stateVersion: state.stateVersion ?? 0,
    };

    // 1. Players
    if (state.players && typeof state.players === "object") {
      const players: Record<string, any> = {};
      const pKeys = Object.keys(state.players).sort();

      for (const pKey of pKeys) {
        const p = state.players[pKey];
        if (!p) continue;

        players[pKey] = {
          name: p.name,
          life: normalizeCardList(p.life),
          hand: normalizeCardList(p.hand),
          field: normalizeUnitList(p.field),
          fog: normalizeFogList(p.fog),
          grave: normalizeCardOrUnitList(p.grave),
          trumps: normalizeUnitList(p.trumps || p.trump),
        };
      }
      logical.players = players;
    }

    // 2. Stage Requests (Action processing structure として LIFO 配列順を厳格保持)
    if (state.stage?.requests && Array.isArray(state.stage.requests)) {
      logical.stageRequests = state.stage.requests.map((r: any) => {
        const keyCards = Array.isArray(r.keyCards)
          ? r.keyCards.map((c: any) => normalizeCard(c))
          : r.keyCard
          ? [normalizeCard(r.keyCard)]
          : [];

        return {
          id: resolveId(r.id),
          actionId: r.actionId,
          controller: r.controller,
          status: r.status,
          sequence: r.sequence,
          definitionOwner: r.definitionOwner,
          keyCards,
          targets: r.targets
            ? r.targets.map((t: any) => ({
                kind: t.kind,
                unitId: resolveId(t.unitId),
                playerId: t.playerId,
                requestId: resolveId(t.requestId),
              }))
            : undefined,
          targetComponentId: resolveId(r.targetComponent?.unitId || r.targetComponent?.componentId),
          targetRequestId: resolveId(r.targetRequest?.id),
          cost: r.cost,
          selectedCostPayment: r.selectedCostPayment,
          sourcePatternId: r.sourcePatternId
            ? r.sourcePatternId.replace(/unit-\d{10,}-[a-zA-Z0-9]+/g, (match: string) => resolveId(match) || match)
            : undefined,
        };
      });
    }

    // 3. Request Buffer (Stage とは明確に分離された保留中誘発キュー)
    if (state.requestBuffer?.requests && Array.isArray(state.requestBuffer.requests)) {
      logical.bufferRequests = state.requestBuffer.requests.map((r: any) => {
        const keyCards = Array.isArray(r.keyCards)
          ? r.keyCards.map((c: any) => normalizeCard(c))
          : r.keyCard
          ? [normalizeCard(r.keyCard)]
          : [];

        return {
          id: resolveId(r.id),
          actionId: r.actionId,
          controller: r.controller,
          sequence: r.sequence,
          definitionOwner: r.definitionOwner,
          keyCards,
          triggerBindings: r.triggerBindings
            ? this.canonicalizeBindings(r.triggerBindings, resolveId)
            : undefined,
          sourceEvent: r.sourceEvent
            ? {
                type: r.sourceEvent.type,
                name: r.sourceEvent.name,
                payload: r.sourceEvent.payload,
              }
            : undefined,
        };
      });
    }

    return logical;
  }

  private static canonicalizeBindings(
    bindings: Record<string, any>,
    resolveId: (id: any) => string | undefined
  ): Record<string, any> {
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(bindings).sort()) {
      const val = bindings[key];
      if (typeof val === "string") {
        sorted[key] = resolveId(val) || val;
      } else {
        sorted[key] = val;
      }
    }
    return sorted;
  }

  /**
   * オブジェクトのキーを再帰的にアルファベット順にソートして canonical な JSON 文字列を生成
   */
  static canonicalStringify(obj: any): string {
    if (obj === null || obj === undefined) {
      return "null";
    }
    if (typeof obj !== "object") {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return `[${obj.map((item) => this.canonicalStringify(item)).join(",")}]`;
    }

    const sortedKeys = Object.keys(obj).sort();
    const entries = sortedKeys
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${this.canonicalStringify(obj[k])}`);

    return `{${entries.join(",")}}`;
  }

  /**
   * 標準 64-bit FNV-1a ハッシュ (BigInt による正確な実装、16進数文字列を返却)
   * Offset Basis: 0xcbf29ce484222325n
   * Prime: 0x100000001b3n
   */
  private static fnv1a64(str: string): string {
    const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
    const FNV_PRIME_64 = 0x100000001b3n;
    const MASK_64 = 0xffffffffffffffffn;

    let hash = FNV_OFFSET_BASIS_64;

    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      // UTF-16 / ASCII バイト処理
      if (code < 128) {
        hash ^= BigInt(code);
        hash = (hash * FNV_PRIME_64) & MASK_64;
      } else {
        // マルチバイト UTF-8
        const bytes = new TextEncoder().encode(str[i]);
        for (let b = 0; b < bytes.length; b++) {
          hash ^= BigInt(bytes[b]);
          hash = (hash * FNV_PRIME_64) & MASK_64;
        }
      }
    }

    return hash.toString(16).padStart(16, "0");
  }
}
