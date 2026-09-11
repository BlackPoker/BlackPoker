import { describe, it, expect } from "vitest";
import {
  buildPlaytestDiagnosticBundleV1,
  generateDiagnosticFilename,
  captureDiagnosticRawState,
  assemblePlaytestDiagnosticBundleParams,
  PlaytestDiagnosticBundleV1,
  ActivePlaytestSettings,
} from "../../ui/playtest/PlaytestDiagnosticBundle";
import { createSeatControllers } from "../../engine/playtest/PlaytestSeatController";

describe("Playtest Diagnostic Bundle v1 Tests", () => {
  const dummyBuild = { sha: "abc1234def", ref: "refs/heads/main" };
  const dummyGeneratedAt = "2026-09-11T23:14:00.000Z";

  const dummyActiveMatch = {
    environmentId: "core-battle",
    environmentName: "Core Battle",
    regulationId: "reg-core-01",
    seed: 42,
    rulePackage: {
      id: "pkg-core",
      version: "1.0.0",
    } as any,
  };

  const dummyActiveSettings: ActivePlaytestSettings = {
    matchMode: "humanVsAi",
    humanSeat: "p1",
    policyId: "firstLegal",
  };

  const dummySeatControllers = createSeatControllers("humanVsAi", "p1", "firstLegal");

  const dummyRawState = {
    matchId: "match-test-001",
    stateVersion: 10,
    turnPlayer: "p1",
    chancePlayer: "p1",
    players: {
      p1: {
        hand: [{ id: "c1", suit: "S", rank: 10 }],
        life: [{ id: "l1", suit: "H", rank: 5 }],
      },
      p2: {
        hand: [{ id: "c2", suit: "D", rank: 7 }],
        life: [{ id: "l2", suit: "C", rank: 2 }],
      },
    },
  };

  it("Test A, B, C: Schemaルートプロパティ (kind, schemaVersion, containsHiddenInformation, generatedAt) の完全性", () => {
    const bundle = buildPlaytestDiagnosticBundleV1({
      build: dummyBuild,
      generatedAt: dummyGeneratedAt,
      activeMatch: dummyActiveMatch,
      activePlaytestSettings: dummyActiveSettings,
      seatControllers: dummySeatControllers,
      rawState: dummyRawState,
    });

    expect(bundle.kind).toBe("blackpoker-playtest-diagnostic");
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.containsHiddenInformation).toBe(true);
    expect(bundle.generatedAt).toBe("2026-09-11T23:14:00.000Z");
  });

  it("Test D: build 情報 (sha, ref) が必須として反映され、完全Pureに決定論的であること", () => {
    const bundle1 = buildPlaytestDiagnosticBundleV1({
      build: dummyBuild,
      generatedAt: dummyGeneratedAt,
      activeMatch: dummyActiveMatch,
    });
    const bundle2 = buildPlaytestDiagnosticBundleV1({
      build: dummyBuild,
      generatedAt: dummyGeneratedAt,
      activeMatch: dummyActiveMatch,
    });

    expect(bundle1.build.sha).toBe("abc1234def");
    expect(bundle1.build.ref).toBe("refs/heads/main");
    // 完全Pure: 同一入力なら完全に同一
    expect(bundle1).toEqual(bundle2);
  });

  it("Test E: match メタデータ (environmentId, environmentName, regulationId, seed, rulePackage) が反映されること", () => {
    const bundle = buildPlaytestDiagnosticBundleV1({
      build: dummyBuild,
      generatedAt: dummyGeneratedAt,
      activeMatch: dummyActiveMatch,
      activePlaytestSettings: dummyActiveSettings,
      seatControllers: dummySeatControllers,
      rawState: dummyRawState,
    });

    expect(bundle.match.matchId).toBe("match-test-001");
    expect(bundle.match.environmentId).toBe("core-battle");
    expect(bundle.match.environmentName).toBe("Core Battle");
    expect(bundle.match.regulationId).toBe("reg-core-01");
    expect(bundle.match.seed).toBe(42);
    expect(bundle.match.rulePackageId).toBe("pkg-core");
    expect(bundle.match.rulePackageVersion).toBe("1.0.0");
  });

  it("Test F: Human vs AI の設定 (humanSeat, policyId, seatControllers) が Active 設定から入ること", () => {
    const bundle = buildPlaytestDiagnosticBundleV1({
      build: dummyBuild,
      generatedAt: dummyGeneratedAt,
      activeMatch: dummyActiveMatch,
      activePlaytestSettings: dummyActiveSettings,
      seatControllers: dummySeatControllers,
    });

    expect(bundle.match.matchMode).toBe("humanVsAi");
    expect(bundle.match.humanSeat).toBe("p1");
    expect(bundle.match.policyId).toBe("firstLegal");
    expect(bundle.match.seatControllers).toEqual(dummySeatControllers);
  });

  it("Test G: Pending 設定の変更が Active 設定に混入しないこと (Pending 汚染防止契約)", () => {
    // Active 設定は firstLegal で固定されている
    const currentActiveSettings: ActivePlaytestSettings = {
      matchMode: "humanVsAi",
      humanSeat: "p1",
      policyId: "firstLegal",
    };

    // UI 上で次戦用に pendingPolicyId が manualGenericGenome へ変更されていても、
    // Bundle Builder には activePlaytestSettings を渡すため、Bundle には firstLegal が記録される
    const bundle = buildPlaytestDiagnosticBundleV1({
      build: dummyBuild,
      generatedAt: dummyGeneratedAt,
      activeMatch: dummyActiveMatch,
      activePlaytestSettings: currentActiveSettings,
      seatControllers: dummySeatControllers,
    });

    expect(bundle.match.policyId).toBe("firstLegal");
    expect(bundle.match.policyId).not.toBe("manualGenericGenome");
  });

  it("Test H: snapshot.rawState に両者の非公開手札・ライフが含まれること", () => {
    const rawStateSnapshot = captureDiagnosticRawState(dummyRawState);
    const bundle = buildPlaytestDiagnosticBundleV1({
      build: dummyBuild,
      generatedAt: dummyGeneratedAt,
      activeMatch: dummyActiveMatch,
      rawState: rawStateSnapshot,
    });

    expect(bundle.snapshot.stateVersion).toBe(10);
    expect(bundle.snapshot.rawState).toEqual(dummyRawState);
    const raw = bundle.snapshot.rawState as any;
    expect(raw.players.p1.hand[0].suit).toBe("S");
    expect(raw.players.p2.hand[0].suit).toBe("D");
    expect(raw.players.p1.life[0].suit).toBe("H");
    expect(raw.players.p2.life[0].suit).toBe("C");
  });

  it("Test I: CanonicalMatchLog が存在する場合に完全な形で格納されること", () => {
    const mockMatchLog = {
      meta: { matchId: "canonical-match-123" },
      events: [{ seq: 1, type: "TURN_START" }],
    } as any;

    const bundle = buildPlaytestDiagnosticBundleV1({
      build: dummyBuild,
      generatedAt: dummyGeneratedAt,
      activeMatch: dummyActiveMatch,
      canonicalMatchLog: mockMatchLog,
    });

    expect(bundle.canonicalMatchLog).toEqual(mockMatchLog);
  });

  it("Test J: runtimeNotice および setupNotice が notices に格納されること", () => {
    const mockNotice = {
      type: "TECHNICAL_ERROR" as const,
      title: "AI Policy 実行時エラー",
      message: "AI timed out",
      environmentName: "Core Battle",
    };

    const bundle = buildPlaytestDiagnosticBundleV1({
      build: dummyBuild,
      generatedAt: dummyGeneratedAt,
      activeMatch: dummyActiveMatch,
      runtimeNotice: mockNotice,
    });

    expect(bundle.notices?.runtime).toEqual(mockNotice);
    expect(bundle.notices?.setup).toBeUndefined();
  });

  it("Test C-ext: formatId / frameId は rawState にない場合は undefined であり、推測されないこと", () => {
    const bundleWithoutFormat = buildPlaytestDiagnosticBundleV1({
      build: dummyBuild,
      generatedAt: dummyGeneratedAt,
      activeMatch: dummyActiveMatch,
      rawState: dummyRawState, // formatId, frameId なし
    });

    expect(bundleWithoutFormat.match.formatId).toBeUndefined();
    expect(bundleWithoutFormat.match.frameId).toBeUndefined();

    const bundleWithFormat = buildPlaytestDiagnosticBundleV1({
      build: dummyBuild,
      generatedAt: dummyGeneratedAt,
      activeMatch: dummyActiveMatch,
      rawState: {
        ...dummyRawState,
        formatId: "format-official",
        frameId: "frame-2026",
      },
    });

    expect(bundleWithFormat.match.formatId).toBe("format-official");
    expect(bundleWithFormat.match.frameId).toBe("frame-2026");
  });

  it("Test K: generateDiagnosticFilename での安全なファイル名生成とサニタイズ", () => {
    const filename1 = generateDiagnosticFilename({
      matchId: "match:test/001",
      seed: 42,
      buildSha: "4dda9d48b",
      timestamp: "2026-09-11T23:14:00.000Z",
    });
    // : や / が _ に置換され、ISO timestamp のコロンも置換されていること
    expect(filename1).toBe("blackpoker-diagnostic-v1-match_test_001-4dda9d4-2026-09-11T23-14-00-000Z.json");

    const filename2 = generateDiagnosticFilename({
      seed: 99,
      buildSha: "4dda9d48b",
      timestamp: "2026-09-11T23:14:00.000Z",
    });
    expect(filename2).toBe("blackpoker-diagnostic-v1-seed99-4dda9d4-2026-09-11T23-14-00-000Z.json");
  });

  it("Test A-log: normalLogs に 2 件渡した場合、Bundle 内も同一の 2 件・同一の順序（古い→新しい順、reverse なし）であること", () => {
    const log1 = { id: "log-1", message: "ゲーム開始準備完了", timestamp: "10:00:00", seq: 1 };
    const log2 = { id: "log-2", message: "Player A の行動完了", timestamp: "10:00:05", seq: 2 };

    const bundle = buildPlaytestDiagnosticBundleV1({
      build: dummyBuild,
      generatedAt: dummyGeneratedAt,
      activeMatch: dummyActiveMatch,
      normalLogs: [log1, log2],
    });

    expect(bundle.normalLogs).toHaveLength(2);
    expect(bundle.normalLogs[0]).toEqual(log1);
    expect(bundle.normalLogs[1]).toEqual(log2);
  });

  it("Test D-log: normalLogs 未指定時、Builder 単体 default [] として格納されること", () => {
    const bundle = buildPlaytestDiagnosticBundleV1({
      build: dummyBuild,
      generatedAt: dummyGeneratedAt,
      activeMatch: dummyActiveMatch,
    });

    expect(bundle.normalLogs).toBeDefined();
    expect(Array.isArray(bundle.normalLogs)).toBe(true);
    expect(bundle.normalLogs).toEqual([]);
  });

  it("Test E-ui: UI Adapter (assemblePlaytestDiagnosticBundleParams) 経由で生成した場合、normalLogs と seatControllers が両方欠落しないこと", () => {
    const testLogs = [
      { id: "log-1", message: "準備完了", timestamp: "10:00:00" },
      { id: "log-2", message: "戦闘開始", timestamp: "10:00:02" },
    ];

    const params = assemblePlaytestDiagnosticBundleParams({
      build: dummyBuild,
      generatedAt: dummyGeneratedAt,
      activeMatch: dummyActiveMatch,
      activePlaytestSettings: dummyActiveSettings,
      activeSeatControllers: dummySeatControllers,
      rawState: dummyRawState,
      logs: testLogs,
    });

    const bundle = buildPlaytestDiagnosticBundleV1(params);

    // normalLogs が渡した testLogs と完全一致し欠落しないこと
    expect(bundle.normalLogs).toHaveLength(2);
    expect(bundle.normalLogs).toEqual(testLogs);

    // match.seatControllers が渡した activeSeatControllers と完全一致し欠落しないこと
    expect(bundle.match.seatControllers).toBeDefined();
    expect(bundle.match.seatControllers).toEqual(dummySeatControllers);
  });
});

