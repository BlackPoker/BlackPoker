import { describe, it, expect } from "vitest";
import {
  generateAutoSeed,
  generateNextAutoSeed,
  UINT32_MAX,
} from "../../ui/playtest/PlaytestSeed";
import { validateSeed } from "../../engine/playtest/PlaytestEnvironmentController";

describe("PlaytestSeed Unit Tests (Phase 4.0-A)", () => {
  describe("generateAutoSeed input handling and boundary constraints", () => {
    it("source が 0 を返す場合に 0 を返すこと", () => {
      const seed = generateAutoSeed(() => 0);
      expect(seed).toBe(0);
    });

    it("source が 0.5 を返す場合に 2147483648 を返すこと", () => {
      const seed = generateAutoSeed(() => 0.5);
      expect(seed).toBe(2147483648);
    });

    it("source が 1 を返す場合に UINT32_MAX (4294967295) を返すこと", () => {
      const seed = generateAutoSeed(() => 1);
      expect(seed).toBe(UINT32_MAX);
      expect(seed).toBe(4294967295);
    });

    it("source が 0.9999999999 を返す場合に UINT32_MAX 以下の非負整数を返すこと", () => {
      const seed = generateAutoSeed(() => 0.9999999999);
      expect(seed).toBeGreaterThan(0);
      expect(seed).toBeLessThanOrEqual(UINT32_MAX);
      expect(Number.isSafeInteger(seed)).toBe(true);
    });

    it("source が NaN を返す場合に fail-closed (例外スロー) すること", () => {
      expect(() => generateAutoSeed(() => NaN)).toThrow(/Invalid random source value/);
    });

    it("source が Infinity を返す場合に fail-closed (例外スロー) すること", () => {
      expect(() => generateAutoSeed(() => Infinity)).toThrow(/Invalid random source value/);
    });

    it("source が -Infinity を返す場合に fail-closed (例外スロー) すること", () => {
      expect(() => generateAutoSeed(() => -Infinity)).toThrow(/Invalid random source value/);
    });

    it("source が負数 (-1) を返す場合に fail-closed (例外スロー) すること", () => {
      expect(() => generateAutoSeed(() => -1)).toThrow(/Invalid random source value/);
    });

    it("source が 1 を超える値 (1.5) を返す場合に fail-closed (例外スロー) すること", () => {
      expect(() => generateAutoSeed(() => 1.5)).toThrow(/Invalid random source value/);
    });

    it("デフォルト呼び出し（source未指定）で 0..UINT32_MAX の安全な整数を生成し、validateSeed を通過すること", () => {
      for (let i = 0; i < 20; i++) {
        const seed = generateAutoSeed();
        expect(Number.isSafeInteger(seed)).toBe(true);
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(seed).toBeLessThanOrEqual(UINT32_MAX);

        const validation = validateSeed(String(seed));
        expect(validation.valid).toBe(true);
        if (validation.valid) {
          expect(validation.seed).toBe(seed);
        }
      }
    });
  });

  describe("generateNextAutoSeed uniqueness contract", () => {
    it("candidate が previousSeed と異なる場合はそのまま candidate を返すこと", () => {
      const next = generateNextAutoSeed(42, () => 0.5); // candidate = 2147483648
      expect(next).toBe(2147483648);
      expect(next).not.toBe(42);
    });

    it("candidate が previousSeed (42) と同一の場合でも、nextSeed !== 42 (43) を決定論的に保証すること", () => {
      // 42 / 4294967296 => 0.000000009778887033462524
      const sourceFor42 = () => 42 / 4294967296;
      expect(generateAutoSeed(sourceFor42)).toBe(42);

      const next = generateNextAutoSeed(42, sourceFor42);
      expect(next).not.toBe(42);
      expect(next).toBe(43);
    });

    it("previousSeed が UINT32_MAX で candidate も UINT32_MAX の場合、0 にラップアラウンドして衝突を回避すること", () => {
      const sourceForMax = () => 1;
      expect(generateAutoSeed(sourceForMax)).toBe(UINT32_MAX);

      const next = generateNextAutoSeed(UINT32_MAX, sourceForMax);
      expect(next).not.toBe(UINT32_MAX);
      expect(next).toBe(0);
    });

    it("デフォルト呼び出しで previousSeed と異なる値が生成されること", () => {
      const prev = 12345;
      const next = generateNextAutoSeed(prev);
      expect(next).not.toBe(prev);
      expect(Number.isSafeInteger(next)).toBe(true);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(UINT32_MAX);
    });
  });
});
