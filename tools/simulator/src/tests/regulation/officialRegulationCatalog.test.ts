import { describe, it, expect, beforeAll } from "vitest";
import {
  loadRegulationCatalog,
  getRegulation,
  getFormat,
  getFrame,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import {
  UnknownRegulationError,
  UnknownFormatError,
  UnknownFrameError,
  SimulatorNotImplementedError,
} from "../../domain/regulation/RegulationDefinition";

describe("Official Regulation Catalog & Validation Tests (AO 1-7)", () => {
  beforeAll(() => {
    clearRegulationCache();
  });

  it("1. light + entry16 should be ruleLegal=true, recommended=true, simulatorImplemented=true", async () => {
    const catalog = await loadRegulationCatalog();
    const result = RegulationValidator.validateRegulation(catalog, "light-entry16");

    expect(result.ruleLegal).toBe(true);
    expect(result.recommended).toBe(true);
    expect(result.simulatorImplemented).toBe(true);
    expect(result.regulation?.id).toBe("light-entry16");
    expect(result.format?.id).toBe("light");
    expect(result.frame?.id).toBe("entry16");
  });

  it("2. standard + entry16 should be ruleLegal=true, recommended=false, simulatorImplemented=false", async () => {
    const catalog = await loadRegulationCatalog();
    // 仮想的に standard format を定義して検証
    const mockCatalog = {
      ...catalog,
      formats: new Map([
        ...catalog.formats.entries(),
        ["standard", { id: "standard", name: "スタンダード", actions: [], components: [] }],
      ]),
    };

    const result = RegulationValidator.validateCombination(mockCatalog as any, "standard", "entry16");
    expect(result.ruleLegal).toBe(true);
    expect(result.recommended).toBe(false);
    expect(result.simulatorImplemented).toBe(false);

    // assertImplemented: true で SimulatorNotImplementedError を送出
    expect(() =>
      RegulationValidator.validateCombination(mockCatalog as any, "standard", "entry16", {
        assertImplemented: true,
      })
    ).toThrow(SimulatorNotImplementedError);
  });

  it("3. pro + entry16 should be ruleLegal=true, recommended=false, simulatorImplemented=false", async () => {
    const catalog = await loadRegulationCatalog();
    const mockCatalog = {
      ...catalog,
      formats: new Map([
        ...catalog.formats.entries(),
        ["pro", { id: "pro", name: "プロ", actions: [], components: [] }],
      ]),
    };

    const result = RegulationValidator.validateCombination(mockCatalog as any, "pro", "entry16");
    expect(result.ruleLegal).toBe(true);
    expect(result.recommended).toBe(false);
    expect(result.simulatorImplemented).toBe(false);

    expect(() =>
      RegulationValidator.validateCombination(mockCatalog as any, "pro", "entry16", {
        assertImplemented: true,
      })
    ).toThrow(SimulatorNotImplementedError);
  });

  it("4. master + entry16 should be ruleLegal=true, recommended=false, simulatorImplemented=false", async () => {
    const catalog = await loadRegulationCatalog();
    const mockCatalog = {
      ...catalog,
      formats: new Map([
        ...catalog.formats.entries(),
        ["master", { id: "master", name: "マスター", actions: [], components: [] }],
      ]),
    };

    const result = RegulationValidator.validateCombination(mockCatalog as any, "master", "entry16");
    expect(result.ruleLegal).toBe(true);
    expect(result.recommended).toBe(false);
    expect(result.simulatorImplemented).toBe(false);

    expect(() =>
      RegulationValidator.validateCombination(mockCatalog as any, "master", "entry16", {
        assertImplemented: true,
      })
    ).toThrow(SimulatorNotImplementedError);
  });

  it("5. Unknown Regulation ID should throw UnknownRegulationError", async () => {
    const catalog = await loadRegulationCatalog();
    expect(() => RegulationValidator.validateRegulation(catalog, "unknown-reg")).toThrow(
      UnknownRegulationError
    );
    await expect(getRegulation("unknown-reg")).rejects.toThrow(UnknownRegulationError);
  });

  it("6. Unknown Format ID should throw UnknownFormatError", async () => {
    const catalog = await loadRegulationCatalog();
    expect(() => RegulationValidator.validateCombination(catalog, "unknown-fmt", "entry16")).toThrow(
      UnknownFormatError
    );
    await expect(getFormat("unknown-fmt")).rejects.toThrow(UnknownFormatError);
  });

  it("7. Unknown Frame ID should throw UnknownFrameError", async () => {
    const catalog = await loadRegulationCatalog();
    expect(() => RegulationValidator.validateCombination(catalog, "light", "unknown-frm")).toThrow(
      UnknownFrameError
    );
    await expect(getFrame("unknown-frm")).rejects.toThrow(UnknownFrameError);
  });
});
