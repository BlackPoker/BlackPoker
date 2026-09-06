import { CYCLE_STATE_FINGERPRINT_VERSION } from "../../domain/ai/OfficialBaselineDiagnosticsTypes";

/**
 * 周期診断専用の論理ゲーム状態フィンガープリント生成器 (Cycle State Fingerprint v1)。
 *
 * 【設計原則】
 * 1. 単調増加カウンタの排除:
 *    stateVersion, nextRequestSeq, sequence, runtime decisionId, runtime requestId 等の
 *    毎ステップ無条件に増加するメタデータを除外し、ゲーム盤面および未解決リクエストの実質的再帰を検知する。
 * 2. 解決順序・ゲームプレイ配列順の完全保持:
 *    Stage（LIFO 解決順）および Request Buffer（キュー順）の配列順序を厳格に保持する。
 *    順序をソート等で破壊してはならず、単調カウンタである sequence プロパティのみを除外する。
 * 3. 意味論的差分の厳密な検知:
 *    turnPlayer, chancePlayer, turnCount, turnUsage, players (Life, Hand, Field, Fog, Grave, Trumps),
 *    Stage requests, Request Buffer requests の差異は確実にフィンガープリントへ反映する。
 * 4. 決定論的 64-bit FNV-1a ハッシュ:
 *    キー順序を正規化した canonical JSON に対し、"csf1-<16-hex>" 形式を算出する。
 */
export class CycleStateFingerprint {
  public static readonly VERSION = CYCLE_STATE_FINGERPRINT_VERSION;

  /**
   * 与えられた GameState から Cycle State Fingerprint 文字列 (例: "csf1-0123456789abcdef") を算出
   */
  public static compute(state: any): string {
    if (!state) {
      return `csf${this.VERSION}-null`;
    }

    const logical = this.extractCycleLogicalState(state);
    const canonicalJson = this.canonicalStringify(logical);
    const hashHex = this.fnv1a64(canonicalJson);

    return `csf${this.VERSION}-${hashHex}`;
  }

  /**
   * 周期判定用の論理状態を抽出（単調カウンタを除外し、順序と論理情報を保持）
   */
  public static extractCycleLogicalState(state: any): any {
    if (!state || typeof state !== "object") return state;

    // 決定論的 ID マッピング
    const idMap = new Map<string, string>();
    const prefixCounters = new Map<string, number>();

    const registerId = (rawId: any, defaultPrefix = "entity") => {
      if (!rawId || typeof rawId !== "string") return;
      if (!idMap.has(rawId)) {
        const count = (prefixCounters.get(defaultPrefix) || 0) + 1;
        prefixCounters.set(defaultPrefix, count);
        idMap.set(rawId, `${defaultPrefix}#${count}`);
      }
    };

    const resolveId = (rawId: any): string | undefined => {
      if (!rawId || typeof rawId !== "string") return undefined;
      return idMap.get(rawId) || rawId;
    };

    // Stage リクエスト ID の相対スロット予約 (例: req-xxx -> stage#0, stage#1)
    if (state.stage?.requests && Array.isArray(state.stage.requests)) {
      state.stage.requests.forEach((r: any, idx: number) => {
        const reqId = r?.id || r?.requestId;
        if (reqId && typeof reqId === "string") {
          idMap.set(reqId, `stage#${idx}`);
        }
      });
    }

    // Request Buffer リクエスト ID の相対スロット予約 (例: req-xxx -> buffer#0, buffer#1)
    if (state.requestBuffer?.requests && Array.isArray(state.requestBuffer.requests)) {
      state.requestBuffer.requests.forEach((r: any, idx: number) => {
        const reqId = r?.id || r?.requestId;
        if (reqId && typeof reqId === "string") {
          idMap.set(reqId, `buffer#${idx}`);
        }
      });
    }

    // 1. Players Traversal
    if (state.players && typeof state.players === "object") {
      const pKeys = Object.keys(state.players).sort();
      for (const pKey of pKeys) {
        const p = state.players[pKey];
        if (!p) continue;

        if (Array.isArray(p.hand)) {
          p.hand.forEach((c: any) => registerId(c?.id, "card"));
        }
        if (Array.isArray(p.life)) {
          p.life.forEach((c: any) => registerId(c?.id, "card"));
        }
        if (Array.isArray(p.field)) {
          p.field.forEach((u: any) => {
            registerId(u?.unitId, "unit");
            if (Array.isArray(u?.cards)) {
              u.cards.forEach((c: any) => registerId(c?.id, "card"));
            }
          });
        }
        if (Array.isArray(p.fog)) {
          p.fog.forEach((f: any) => {
            registerId(f?.fogId, "fog");
            registerId(f?.card?.id, "card");
          });
        }
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

    // 2. Normalization Functions
    const normalizeCard = (card: any): any => {
      if (!card) return undefined;
      if (typeof card === "string" || typeof card === "number") return card;
      return {
        id: card.code || resolveId(card.id),
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
        bindings: f.bindings ? this.canonicalizeReferences(f.bindings, resolveId) : undefined,
      }));
    };

    const normalizeCardOrUnitList = (list: any): any => {
      if (!Array.isArray(list)) return [];
      return list.map((item) => {
        if (item?.unitId) return normalizeUnit(item);
        return normalizeCard(item);
      });
    };

    const normalizeCostPayment = (costPayment: any): any => {
      if (!costPayment || typeof costPayment !== "object") return undefined;
      return {
        lifeCount: costPayment.lifeCount ?? 0,
        discardedCardIds: Array.isArray(costPayment.discardedCardIds)
          ? costPayment.discardedCardIds.map((id: string) => resolveId(id)).sort()
          : [],
        drivenBulwarkUnitIds: Array.isArray(costPayment.drivenBulwarkUnitIds)
          ? costPayment.drivenBulwarkUnitIds.map((id: string) => resolveId(id)).sort()
          : [],
        sacrificedUnitIds: Array.isArray(costPayment.sacrificedUnitIds)
          ? costPayment.sacrificedUnitIds.map((id: string) => resolveId(id)).sort()
          : [],
      };
    };

    const normalizeTarget = (target: any): any => {
      if (!target || typeof target !== "object") return target;
      if (target.type === "player") {
        return { type: "player", targetPlayerKey: target.targetPlayerKey };
      }
      if (target.type === "request") {
        return {
          type: "request",
          requestId: resolveId(target.requestId),
          actionId: target.actionId,
        };
      }
      if (target.type === "unit") {
        return {
          type: "unit",
          unitId: resolveId(target.unitId),
          kind: target.kind,
          componentId: target.componentId,
        };
      }
      return this.canonicalizeReferences(target, resolveId);
    };

    const normalizeTurnUsage = (turnUsage: any): any => {
      if (!turnUsage || typeof turnUsage !== "object") return undefined;
      const normalized: Record<string, any> = {};
      for (const pKey of Object.keys(turnUsage).sort()) {
        const userUsage = turnUsage[pKey];
        if (userUsage && typeof userUsage === "object") {
          const actionUsage: Record<string, number> = {};
          for (const actId of Object.keys(userUsage).sort()) {
            if (typeof userUsage[actId] === "number") {
              actionUsage[actId] = userUsage[actId];
            }
          }
          normalized[pKey] = actionUsage;
        }
      }
      return normalized;
    };

    // 3. Assemble Logical Cycle Container
    // ※ stateVersion, nextRequestSeq, sequence, timestamp, history, matchLog は完全に除外
    const logical: Record<string, any> = {
      presetId: state.presetId,
      turnCount: state.turnCount ?? 1,
      turnPlayer: state.turnPlayer,
      chancePlayer: state.chancePlayer,
      turnUsage: normalizeTurnUsage(state.turnUsage),
    };

    // Players
    if (state.players && typeof state.players === "object") {
      const players: Record<string, any> = {};
      const pKeys = Object.keys(state.players).sort();

      for (const pKey of pKeys) {
        const p = state.players[pKey];
        if (!p) continue;

        players[pKey] = {
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

    // Stage Requests (LIFO 配列順を厳格保持。単調 sequence のみ除外)
    if (state.stage?.requests && Array.isArray(state.stage.requests)) {
      logical.stageRequests = state.stage.requests.map((r: any, idx: number) => {
        const keyCards = Array.isArray(r.keyCards)
          ? r.keyCards.map((c: any) => normalizeCard(c))
          : r.keyCard
          ? [normalizeCard(r.keyCard)]
          : [];

        const targets = Array.isArray(r.targets)
          ? r.targets.map((t: any) => normalizeTarget(t))
          : r.targetComponent
          ? [normalizeTarget({ type: "unit", unitId: r.targetComponent.unitId, kind: r.targetComponent.kind, componentId: r.targetComponent.componentId })]
          : r.targetRequest
          ? [normalizeTarget({ type: "request", requestId: r.targetRequest.id, actionId: r.targetRequest.actionId })]
          : undefined;

        return {
          slot: idx, // 相対位置順序
          actionId: r.actionId,
          controller: r.controller,
          status: r.status,
          definitionOwner: r.definitionOwner,
          keyCards,
          targets,
          cost: r.cost,
          selectedCostPayment: normalizeCostPayment(r.selectedCostPayment),
        };
      });
    }

    // Request Buffer Requests (キュー配列順を厳格保持。単調 sequence のみ除外)
    if (state.requestBuffer?.requests && Array.isArray(state.requestBuffer.requests)) {
      logical.bufferRequests = state.requestBuffer.requests.map((r: any, idx: number) => {
        const keyCards = Array.isArray(r.keyCards)
          ? r.keyCards.map((c: any) => normalizeCard(c))
          : r.keyCard
          ? [normalizeCard(r.keyCard)]
          : [];

        return {
          slot: idx, // 相対位置順序
          actionId: r.actionId,
          controller: r.controller,
          definitionOwner: r.definitionOwner,
          keyCards,
          triggerBindings: r.triggerBindings
            ? this.canonicalizeReferences(r.triggerBindings, resolveId)
            : undefined,
          sourceEvent: r.sourceEvent
            ? {
                type: r.sourceEvent.type,
                name: r.sourceEvent.name,
                payload: r.sourceEvent.payload
                  ? this.canonicalizeReferences(r.sourceEvent.payload, resolveId)
                  : undefined,
              }
            : undefined,
        };
      });
    }

    return logical;
  }

  /**
   * オブジェクト/配列内の ID 参照を再帰的に canonical ID へ置換
   */
  public static canonicalizeReferences(
    value: any,
    resolveId: (id: any) => string | undefined
  ): any {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
      return resolveId(value) || value;
    }
    if (typeof value !== "object") return value;

    if (Array.isArray(value)) {
      return value.map((item) => this.canonicalizeReferences(item, resolveId));
    }

    const sorted: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) {
      if (
        key === "timestamp" ||
        key === "createdAt" ||
        key === "sequence" ||
        key === "seq" ||
        key === "stateVersion" ||
        key === "nextRequestSeq"
      ) {
        continue;
      }
      sorted[key] = this.canonicalizeReferences(value[key], resolveId);
    }
    return sorted;
  }

  /**
   * キー順序をソートした決定論的 JSON 文字列化
   */
  public static canonicalStringify(obj: any): string {
    if (obj === null || typeof obj !== "object") {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return "[" + obj.map((item) => this.canonicalStringify(item)).join(",") + "]";
    }
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((k) => `${JSON.stringify(k)}:${this.canonicalStringify(obj[k])}`);
    return "{" + pairs.join(",") + "}";
  }

  /**
   * 標準 FNV-1a 64-bit ハッシュ算出
   */
  private static fnv1a64(str: string): string {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < str.length; i++) {
      hash ^= BigInt(str.charCodeAt(i));
      hash = (hash * prime) & 0xffffffffffffffffn;
    }
    return hash.toString(16).padStart(16, "0");
  }
}
