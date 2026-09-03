/**
 * 決定論的 Logical State Hash 生成ユーティリティ。
 * ゲームの進行に影響する論理状態のみを抽出し、オブジェクトキーの順序や実行時タイムスタンプに依存しない
 * 安定した fingerprint (State Hash) を算出します。
 */

export interface StateHashResult {
  readonly stateHashVersion: number;
  readonly stateHash: string;
}

export class StateHasher {
  public static readonly VERSION = 1;

  /**
   * 与えられた GameState から論理状態のハッシュ文字列 (例: "sh1-0123456789abcdef") を算出
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
   * GameState からゲーム結果・進行に影響する論理状態のみを抽出。
   * ※ タイムスタンプ、UI状態、React状態、ランタイム生成された動的ID、MatchLog内部状態は除外・正規化します。
   */
  static extractLogicalState(state: any): any {
    if (!state || typeof state !== "object") return state;

    const logical: Record<string, any> = {
      presetId: state.presetId,
      turnCount: state.turnCount ?? 1,
      turnPlayer: state.turnPlayer,
      chancePlayer: state.chancePlayer,
      stateVersion: state.stateVersion ?? 0,
      phase: state.phase, // 互換用
    };

    // 1. プレイヤー状態
    if (state.players && typeof state.players === "object") {
      const players: Record<string, any> = {};
      const pKeys = Object.keys(state.players).sort();

      for (const pKey of pKeys) {
        const p = state.players[pKey];
        if (!p) continue;

        players[pKey] = {
          name: p.name,
          life: this.normalizeCardList(p.life),
          hand: this.normalizeCardList(p.hand),
          field: this.normalizeUnitList(p.field),
          fog: this.normalizeFogList(p.fog),
          grave: this.normalizeCardOrUnitList(p.grave),
          trumps: this.normalizeUnitList(p.trumps || p.trump),
        };
      }
      logical.players = players;
    }

    // 2. ステージリクエスト
    if (state.stage?.requests && Array.isArray(state.stage.requests)) {
      logical.stageRequests = state.stage.requests.map((r: any) => ({
        id: this.normalizeId(r.id),
        actionId: r.actionId,
        controller: r.controller,
        status: r.status,
        sequence: r.sequence,
        definitionOwner: r.definitionOwner,
        keyCard: this.normalizeCard(r.keyCard),
        targetComponentId: this.normalizeId(r.targetComponent?.unitId || r.targetComponent?.componentId),
        targetRequestId: this.normalizeId(r.targetRequest?.id),
      }));
    }

    // 3. リクエストバッファ
    if (state.requestBuffer?.requests && Array.isArray(state.requestBuffer.requests)) {
      logical.bufferRequests = state.requestBuffer.requests.map((r: any) => ({
        id: this.normalizeId(r.id),
        actionId: r.actionId,
        controller: r.controller,
        sequence: r.sequence,
        keyCard: this.normalizeCard(r.keyCard),
      }));
    }

    return logical;
  }

  /**
   * ランタイム動的ID (タイムスタンプ・乱数サフィックスを含むもの) を正規化
   */
  private static normalizeId(id: any): string | undefined {
    if (!id || typeof id !== "string") return undefined;
    // タイムスタンプを含む動的ID (例: "unit-cost-1788364073685-xxx", "fog-1788364073685-xxx", "req-1788364073685-xxx")
    if (/\d{10,}/.test(id)) {
      const match = id.match(/^([a-zA-Z_-]+?)-\d{10,}/);
      if (match) {
        return `${match[1]}-dynamic`;
      }
    }
    return id;
  }

  private static normalizeCard(card: any): any {
    if (!card) return undefined;
    if (typeof card === "string" || typeof card === "number") return card;
    return {
      id: this.normalizeId(card.id),
      suit: card.suit,
      rank: card.rank,
      value: card.value ?? 0,
      code: card.code,
    };
  }

  private static normalizeCardList(list: any): any {
    if (!list) return [];
    if (typeof list === "number") return list;
    if (!Array.isArray(list)) return [];
    return list.map((c) => this.normalizeCard(c));
  }

  private static normalizeUnit(unit: any): any {
    if (!unit) return undefined;
    return {
      unitId: this.normalizeId(unit.unitId),
      componentId: unit.componentId,
      kind: unit.kind,
      state: unit.state,
      face: unit.face,
      cards: this.normalizeCardList(unit.cards),
      labels: Array.isArray(unit.labels) ? [...unit.labels].sort() : [],
      battle: unit.battle
        ? {
            role: unit.battle.role,
            targetPlayerKey: unit.battle.targetPlayerKey,
            blocksUnitId: this.normalizeId(unit.battle.blocksUnitId),
          }
        : undefined,
    };
  }

  private static normalizeUnitList(list: any): any {
    if (!Array.isArray(list)) return [];
    return list.map((u) => this.normalizeUnit(u));
  }

  private static normalizeFogList(list: any): any {
    if (!Array.isArray(list)) return [];
    return list.map((f) => ({
      fogId: this.normalizeId(f.fogId),
      componentId: f.componentId,
      card: this.normalizeCard(f.card),
      bindings: f.bindings ? this.sortObjectKeys(f.bindings) : undefined,
    }));
  }

  private static normalizeCardOrUnitList(list: any): any {
    if (!Array.isArray(list)) return [];
    return list.map((item) => {
      if (item?.unitId) {
        return this.normalizeUnit(item);
      }
      return this.normalizeCard(item);
    });
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

  private static sortObjectKeys(obj: Record<string, any>): Record<string, any> {
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(obj).sort()) {
      const val = obj[key];
      sorted[key] = typeof val === "string" ? this.normalizeId(val) : val;
    }
    return sorted;
  }

  /**
   * 64-bit FNV-1a ハッシュ (16進数文字列を返却)
   */
  private static fnv1a64(str: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0xcbf29ce4;

    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      h1 ^= code & 0xff;
      h1 = Math.imul(h1, 0x01000193);

      h2 ^= (code >>> 8) & 0xff;
      h2 = Math.imul(h2, 0x01000193);
    }

    const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
    const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
    return `${hex1}${hex2}`;
  }
}
