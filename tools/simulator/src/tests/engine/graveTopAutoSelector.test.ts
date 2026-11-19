import { describe, it, expect } from "vitest";
import {
  selectAutoGraveTopCandidate,
  hashFnv1a32,
  mix32,
  extractCandidateCardIds,
} from "../../engine/playtest/GraveTopAutoSelector";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";

/**
 * テスト用 ZONE_TOP_SELECTION DecisionRequest ビルダー
 */
function createMockZoneTopRequest(
  candidateCardIds: string[],
  options?: {
    playerId?: "p1" | "p2";
    stateVersion?: number;
    decisionId?: string;
  }
): DecisionRequest {
  const playerId = options?.playerId ?? "p2";
  const stateVersion = options?.stateVersion ?? 3;
  const decisionId = options?.decisionId ?? "dec-mock-12345";

  const effectSelections = candidateCardIds.map((cId) => ({
    selectionType: "card",
    selectedValues: [cId],
    summary: `墓地TOPを選択: [${cId}]`,
  }));

  const patterns = candidateCardIds.map((cId, idx) => ({
    patternId: `grave-top-select-${idx}-${cId}`,
    kind: "EFFECT_SELECTION" as const,
    effectSelectionRef: idx,
  }));

  return {
    protocolVersion: "1.0.0",
    decisionId,
    stateVersion,
    matchId: "match-test-1",
    playerId,
    source: {
      type: "ZONE_TOP_SELECTION",
      zone: "grave",
      playerId,
      reason: "MULTI_CARD_GRAVE_MOVE",
    },
    observation: {} as any,
    catalog: {
      actions: [],
      cardSelections: [],
      unitSelections: [],
      costPayments: [],
      targetSelections: [],
      effectSelections,
      orderSelections: [],
    },
    patterns,
  };
}

describe("GraveTopAutoSelector (Phase 5A)", () => {
  describe("1. 基本機能とカード抽出", () => {
    it("extractCandidateCardIds で候補カードIDと patternRef が正しく抽出されること", () => {
      const req = createMockZoneTopRequest(["card-A", "card-B", "card-C"]);
      const { candidateCardIds, patternRefMap } = extractCandidateCardIds(req);

      expect(candidateCardIds).toEqual(["card-A", "card-B", "card-C"]);
      expect(patternRefMap.get("card-A")).toBe(0);
      expect(patternRefMap.get("card-B")).toBe(1);
      expect(patternRefMap.get("card-C")).toBe(2);
    });

    it("候補が1枚のみの場合、無条件でその1枚が selectedPatternRef: 0 で返されること", () => {
      const req = createMockZoneTopRequest(["card-sole"]);
      const result = selectAutoGraveTopCandidate({
        request: req,
        matchSeed: 99999,
        stateVersion: 1,
      });

      expect(result.selectedCardId).toBe("card-sole");
      expect(result.selectedPatternRef).toBe(0);
      expect(result.candidateCardIds).toEqual(["card-sole"]);
    });
  });

  describe("2. 同一局面での再現性と決定論（Deterministic Guarantee）", () => {
    it("同一の request, matchSeed, stateVersion で何度実行しても完全に同一のカードが選ばれること", () => {
      const req = createMockZoneTopRequest(["card-X", "card-Y", "card-Z"]);
      const matchSeed = 20261119;
      const stateVersion = 5;

      const firstResult = selectAutoGraveTopCandidate({
        request: req,
        matchSeed,
        stateVersion,
      });

      // 100回連続で実行しても同一結果
      for (let i = 0; i < 100; i++) {
        const nextResult = selectAutoGraveTopCandidate({
          request: req,
          matchSeed,
          stateVersion,
        });
        expect(nextResult.selectedCardId).toBe(firstResult.selectedCardId);
        expect(nextResult.selectedPatternRef).toBe(firstResult.selectedPatternRef);
      }
    });

    it("decisionId がランダム文字列等で変化しても、選択結果に一切影響を与えないこと", () => {
      const req1 = createMockZoneTopRequest(["c-1", "c-2", "c-3"], {
        decisionId: "dec-random-AAA-111",
      });
      const req2 = createMockZoneTopRequest(["c-1", "c-2", "c-3"], {
        decisionId: "dec-random-BBB-222",
      });

      const res1 = selectAutoGraveTopCandidate({
        request: req1,
        matchSeed: 12345,
        stateVersion: 2,
      });
      const res2 = selectAutoGraveTopCandidate({
        request: req2,
        matchSeed: 12345,
        stateVersion: 2,
      });

      expect(res1.selectedCardId).toBe(res2.selectedCardId);
      expect(res1.selectedPatternRef).toBe(res2.selectedPatternRef);
    });

    it("request.patterns の出現順序が異なっていても、同一の selectedCardId が選ばれ正しい patternRef を指すこと", () => {
      // 順序A: [card-A, card-B, card-C]
      const reqA = createMockZoneTopRequest(["card-A", "card-B", "card-C"]);
      // 順序B: [card-C, card-A, card-B]
      const reqB = createMockZoneTopRequest(["card-C", "card-A", "card-B"]);

      const resA = selectAutoGraveTopCandidate({
        request: reqA,
        matchSeed: 777,
        stateVersion: 1,
      });
      const resB = selectAutoGraveTopCandidate({
        request: reqB,
        matchSeed: 777,
        stateVersion: 1,
      });

      // 選択されるカード自体は同一
      expect(resA.selectedCardId).toBe(resB.selectedCardId);
      // それぞれの request 内のインデックスを正確に指している
      expect(reqA.catalog.effectSelections[reqA.patterns[resA.selectedPatternRef].effectSelectionRef!].selectedValues[0]).toBe(resA.selectedCardId);
      expect(reqB.catalog.effectSelections[reqB.patterns[resB.selectedPatternRef].effectSelectionRef!].selectedValues[0]).toBe(resB.selectedCardId);
    });
  });

  describe("3. 複数Seedに対する選択分布（Distribution Test）", () => {
    it("3枚の候補カードに対して1200種類の異なる matchSeed を与えた場合、各カードの選択比率が均等に分散すること", () => {
      const candidates = ["card-1", "card-2", "card-3"];
      const req = createMockZoneTopRequest(candidates, { stateVersion: 1 });
      const counts: Record<string, number> = {
        "card-1": 0,
        "card-2": 0,
        "card-3": 0,
      };

      const totalRuns = 1200;
      for (let seed = 1; seed <= totalRuns; seed++) {
        const result = selectAutoGraveTopCandidate({
          request: req,
          matchSeed: seed,
          stateVersion: 1,
        });
        counts[result.selectedCardId]++;
      }

      const expectedCount = totalRuns / candidates.length; // 400回
      const tolerance = 60; // ±15% (340〜460回) の許容範囲

      for (const cId of candidates) {
        expect(counts[cId]).toBeGreaterThan(expectedCount - tolerance);
        expect(counts[cId]).toBeLessThan(expectedCount + tolerance);
      }
    });

    it("5枚の候補カード（5点ダメージ時など）に対しても全候補が選ばれ均等に分散すること", () => {
      const candidates = ["card-A", "card-B", "card-C", "card-D", "card-E"];
      const req = createMockZoneTopRequest(candidates, { stateVersion: 4 });
      const counts: Record<string, number> = {};
      for (const c of candidates) counts[c] = 0;

      const totalRuns = 1500;
      for (let seed = 1; seed <= totalRuns; seed++) {
        const result = selectAutoGraveTopCandidate({
          request: req,
          matchSeed: seed * 37 + 11,
          stateVersion: 4,
        });
        counts[result.selectedCardId]++;
      }

      // 全候補が選ばれていること
      for (const c of candidates) {
        expect(counts[c]).toBeGreaterThan(200); // 期待値300に対し最低200回以上
      }
    });
  });

  describe("4. 状態変化と防御的エラーハンドリング", () => {
    it("stateVersion が進むと同一 matchSeed でも異なる判断になり得ること", () => {
      const req = createMockZoneTopRequest(["card-A", "card-B", "card-C", "card-D"]);
      const matchSeed = 42;

      const results = new Set<string>();
      for (let sv = 1; sv <= 10; sv++) {
        const res = selectAutoGraveTopCandidate({
          request: req,
          matchSeed,
          stateVersion: sv,
        });
        results.add(res.selectedCardId);
      }

      // 異なるバージョン番号で複数の異なるカードが選ばれる
      expect(results.size).toBeGreaterThan(1);
    });

    it("source.type が ZONE_TOP_SELECTION 以外の場合は安全にエラーを投げること", () => {
      const invalidReq: any = {
        source: { type: "ACTION_REQUEST" },
        patterns: [],
        catalog: {},
      };

      expect(() => {
        selectAutoGraveTopCandidate({
          request: invalidReq,
          matchSeed: 123,
        });
      }).toThrow(/ZONE_TOP_SELECTION/);
    });

    it("候補カードが空の場合はエラーを投げること", () => {
      const emptyReq = createMockZoneTopRequest([]);
      expect(() => {
        selectAutoGraveTopCandidate({
          request: emptyReq,
          matchSeed: 123,
        });
      }).toThrow(/見つかりません/);
    });
  });
});
