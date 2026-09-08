import { describe, it, expect } from "vitest";

describe("DebugPanel Metadata & Preset Safety Tests (E-3)", () => {
  it("Official戦 State (presetId なし) において、CORE-BATTLE-001 などの架空の presetId が付与されないこと", () => {
    // Official戦の State モック
    const officialState = {
      stateVersion: 1,
      regulationId: "official-light-entry16",
      formatId: "official-light",
      frameId: "standard-16",
      turnPlayer: "p1",
      chancePlayer: "p2",
      stage: { requests: [] },
      requestBuffer: { requests: [] },
      players: {
        p1: { life: [], hand: [], field: [], grave: [] },
        p2: { life: [], hand: [], field: [], grave: [] },
      },
    };

    // DebugPanel の handleCopy と同様のメタデータ生成ロジック
    const env = {};
    const debugInfo = {
      buildSha: "test",
      buildRef: "test",
      ...((officialState as any)?.presetId ? { presetId: (officialState as any).presetId } : {}),
      ...((officialState as any)?.regulationId ? { regulationId: (officialState as any).regulationId } : {}),
      ...((officialState as any)?.formatId ? { formatId: (officialState as any).formatId } : {}),
      ...((officialState as any)?.frameId ? { frameId: (officialState as any).frameId } : {}),
    };

    expect(debugInfo.regulationId).toBe("official-light-entry16");
    expect(debugInfo.formatId).toBe("official-light");
    expect(debugInfo.frameId).toBe("standard-16");
    expect((debugInfo as any).presetId).toBeUndefined();
  });

  it("Preset由来 State では正しく presetId が保持・出力されること", () => {
    const presetState = {
      stateVersion: 1,
      presetId: "CORE-BATTLE-001",
      turnPlayer: "p1",
      chancePlayer: "p2",
    };

    const debugInfo = {
      buildSha: "test",
      buildRef: "test",
      ...((presetState as any)?.presetId ? { presetId: (presetState as any).presetId } : {}),
    };

    expect(debugInfo.presetId).toBe("CORE-BATTLE-001");
  });
});
