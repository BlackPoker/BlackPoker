import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import {
  loadRegulationCatalog,
  getRegulation,
  getFormat,
  getFrame,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import {
  RegulationRulePackageSelector,
  RulePackageIntegrityError,
} from "../../engine/regulation/RegulationRulePackageSelector";
import {
  SimulatorNotImplementedError,
} from "../../domain/regulation/RegulationDefinition";
import { RulePackage, ActionDefinition, ComponentDefinition } from "../../domain/rules/RulePackage";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";

describe("マスター＋ストラテジー カタログ＆レギュレーション検証テスト (作業2)", () => {
  beforeAll(() => {
    clearRegulationCache();
  });

  it("1. mast フォーマットが正しく読み込まれ、37アクション・9コンポーネントが定義されていること", async () => {
    const catalog = await loadRegulationCatalog();
    const mastFormat = catalog.formats.get("mast");
    expect(mastFormat).toBeDefined();
    expect(mastFormat!.id).toBe("mast");
    expect(mastFormat!.name).toBe("マスター");

    // アクション数の検証 (プロ31 + マスター専用6 = 37)
    expect(mastFormat!.actions.length).toBe(37);

    // マスター専用6アクションが含まれていること
    const masterActions = [
      "action.swordRain",
      "action.force",
      "action.recruit",
      "action.surprise",
      "action.bj",
      "action.rsf",
    ];
    for (const actId of masterActions) {
      expect(mastFormat!.actions).toContain(actId);
    }

    // コンポーネントの検証 (プロ8 + fog.force = 9)
    expect(mastFormat!.components.length).toBe(9);
    expect(mastFormat!.components).toContain("fog.force");
  });

  it("2. mast-strategy レギュレーションが正しく読み込まれること", async () => {
    const catalog = await loadRegulationCatalog();
    const reg = catalog.regulations.get("mast-strategy");
    expect(reg).toBeDefined();
    expect(reg!.id).toBe("mast-strategy");
    expect(reg!.formatId).toBe("mast");
    expect(reg!.frameId).toBe("strategy");
    expect(reg!.sourceRulesVersion).toBe("9.1.2");
  });

  it("3. RegulationValidator で mast-strategy は ruleLegal=true, recommended=true, simulatorImplemented=false であること", async () => {
    const catalog = await loadRegulationCatalog();
    const result = RegulationValidator.validateRegulation(catalog, "mast-strategy");

    expect(result.ruleLegal).toBe(true);
    // strategy.yaml の recommendedFormatIds に mast が含まれるため recommended は true
    expect(result.recommended).toBe(true);
    // 作業2の段階ではまだ実装完了前のため simulatorImplemented は必ず false (fail-closed)
    expect(result.simulatorImplemented).toBe(false);

    // assertImplemented: true で SimulatorNotImplementedError が投げられること
    expect(() =>
      RegulationValidator.validateRegulation(catalog, "mast-strategy", {
        assertImplemented: true,
      })
    ).toThrow(SimulatorNotImplementedError);
  });

  it("4. RegulationRulePackageSelector: カタログ要求41アクションと、現行実YAML解決アクション(35件)の区別を検証", async () => {
    const catalog = await loadRegulationCatalog();
    const format = catalog.formats.get("mast")!;
    const frame = catalog.frames.get("strategy")!;
    const regulation = catalog.regulations.get("mast-strategy")!;

    // A. カタログ・フォーマット定義上の要求アクションID数 (重複なし41件)
    const combinedActionIds = Array.from(new Set([...format.actions, ...frame.actions]));
    expect(combinedActionIds.length).toBe(41);

    // B. 全アクション（41種）が実装された将来のFullRulePackageを想定したモック検証
    const mockFullActions: ActionDefinition[] = combinedActionIds.map((id) => ({
      id,
      name: id,
      type: "magic" as const,
      request: { trigger: "direct" as const, speed: "normal" as const, timing: "main" as const },
      effect: [],
    }));
    const mockFullComponents: ComponentDefinition[] = format.components.map((id) => ({
      id,
      name: id,
      type: id.startsWith("fog.") ? "fog" as const : "character" as const,
      zone: id.startsWith("fog.") ? "fog" as const : "field" as const,
    }));
    const mockFullPackage: RulePackage = {
      id: "full-package",
      version: "9.1.2",
      actions: mockFullActions,
      components: mockFullComponents,
    };
    const fullyDerivedPackage = RegulationRulePackageSelector.selectRulePackage(
      mockFullPackage,
      format,
      regulation,
      frame
    );
    expect(fullyDerivedPackage.actions.length).toBe(41);
    expect(fullyDerivedPackage.components.length).toBe(9);

    // C. 実際の rules-vnext ディレクトリから解決した場合の検証
    // 作業3B時点でマスター専用4アクション（swordRain, force, surprise, rsf）のYAMLが追加されたため、
    // 作業3C完了により、全41アクション（プロ31 + ストラテジー4 + マスター6）がすべて実YAML解決される。
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const actualBasePackage = await loadRulePackageFromDirectory(rulesDir);
    const actualDerivedPackage = RegulationRulePackageSelector.selectRulePackage(
      actualBasePackage,
      format,
      regulation,
      frame
    );
    expect(actualDerivedPackage.actions.length).toBe(41);

    // 未解決のアクションIDが 0 件（すべて実解決）であることを確認
    const resolvedActionIds = new Set(actualDerivedPackage.actions.map((a) => a.id));
    const unresolvedActionIds = combinedActionIds.filter((id) => !resolvedActionIds.has(id));
    expect(unresolvedActionIds).toEqual([]);
  });

  it("5. Fail-Closed: 欠落定義が存在する場合に RulePackageIntegrityError がスローされ、全レギュレーションで整合性が取れていること", async () => {
    const catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const actualBasePackage = await loadRulePackageFromDirectory(rulesDir);

    const mastFormat = catalog.formats.get("mast")!;
    const strategyFrame = catalog.frames.get("strategy")!;
    const mastReg = catalog.regulations.get("mast-strategy")!;

    // A. アクションが欠落している場合 -> RulePackageIntegrityError
    const deficientActionsPackage: RulePackage = {
      ...actualBasePackage,
      actions: actualBasePackage.actions.filter((a) => a.id !== "action.recruit"),
    };
    expect(() =>
      RegulationRulePackageSelector.selectRulePackage(
        deficientActionsPackage,
        mastFormat,
        mastReg,
        strategyFrame
      )
    ).toThrow(RulePackageIntegrityError);

    // B. コンポーネントが欠落している場合 -> RulePackageIntegrityError
    const deficientComponentsPackage: RulePackage = {
      ...actualBasePackage,
      components: actualBasePackage.components.filter((c) => c.id !== "fog.force"),
    };
    expect(() =>
      RegulationRulePackageSelector.selectRulePackage(
        deficientComponentsPackage,
        mastFormat,
        mastReg,
        strategyFrame
      )
    ).toThrow(RulePackageIntegrityError);

    // C. 既存全6レギュレーション（＋mast-strategy）において欠落なく完全生成されること
    for (const [regId, reg] of catalog.regulations.entries()) {
      const format = catalog.formats.get(reg.formatId);
      const frame = reg.frameId ? catalog.frames.get(reg.frameId) : undefined;
      expect(format).toBeDefined();

      expect(() => {
        const pkg = RegulationRulePackageSelector.selectRulePackage(
          actualBasePackage,
          format!,
          reg,
          frame
        );
        expect(pkg.actions.length).toBeGreaterThan(0);
        expect(pkg.components.length).toBeGreaterThan(0);
      }).not.toThrow();
    }
  });
});
