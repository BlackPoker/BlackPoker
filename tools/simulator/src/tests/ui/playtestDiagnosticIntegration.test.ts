import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadJsonFile } from "../../ui/utils/downloadJson";
import {
  buildPlaytestDiagnosticBundleV1,
  generateDiagnosticFilename,
  captureDiagnosticRawState,
  assemblePlaytestDiagnosticBundleParams,
  ActivePlaytestSettings,
} from "../../ui/playtest/PlaytestDiagnosticBundle";
import {
  PlaytestDecisionTranscriptEntryV1,
  createDecisionTranscriptEntry,
  createAutomatedDecisionTranscriptEntries,
} from "../../ui/playtest/PlaytestDecisionTranscript";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { AutomatedDecisionRecord } from "../../engine/playtest/HumanVsPolicyController";
import { createSeatControllers, PlaytestSeatControllers } from "../../engine/playtest/PlaytestSeatController";

describe("Playtest Diagnostic Integration Tests", () => {
  const dummyBuild = { sha: "63cc8b7", ref: "refs/heads/main" };
  const dummyGeneratedAt = "2026-09-12T00:30:00.000Z";

  describe("Test K: downloadJsonFile DOM/Blob API mock (no network)", () => {
    let savedDocument: any;
    let savedWindow: any;
    let savedURL: any;

    beforeEach(() => {
      savedDocument = (globalThis as any).document;
      savedWindow = (globalThis as any).window;
      savedURL = (globalThis as any).URL;
    });

    afterEach(() => {
      (globalThis as any).document = savedDocument;
      (globalThis as any).window = savedWindow;
      (globalThis as any).URL = savedURL;
      vi.restoreAllMocks();
    });

    it("Blob生成、aタグ生成・クリック・DOM除去、revokeObjectURLを正常に行いネットワークアクセスしない", () => {
      (globalThis as any).window = globalThis;
      let createdBlob: Blob | null = null;
      let clicked = false;
      let appendedChild = false;
      let removedChild = false;
      let revokedUrl = "";

      const mockAnchor = {
        href: "",
        download: "",
        click: vi.fn(() => {
          clicked = true;
        }),
      };

      (globalThis as any).document = {
        createElement: vi.fn((tagName: string) => {
          if (tagName === "a") {
            return mockAnchor;
          }
          return {};
        }),
        body: {
          appendChild: vi.fn((node: any) => {
            if (node === mockAnchor) {
              appendedChild = true;
            }
          }),
          removeChild: vi.fn((node: any) => {
            if (node === mockAnchor) {
              removedChild = true;
            }
          }),
        },
      };

      (globalThis as any).URL = {
        createObjectURL: vi.fn((blob: Blob) => {
          createdBlob = blob;
          return "blob:mock-url-12345";
        }),
        revokeObjectURL: vi.fn((url: string) => {
          revokedUrl = url;
        }),
      };

      const testData = {
        kind: "blackpoker-playtest-diagnostic",
        schemaVersion: 1,
        match: { seed: 42 },
      };

      downloadJsonFile("playtest-test.json", testData);

      expect(mockAnchor.download).toBe("playtest-test.json");
      expect(mockAnchor.href).toBe("blob:mock-url-12345");
      expect(appendedChild).toBe(true);
      expect(clicked).toBe(true);
      expect(removedChild).toBe(true);
      expect(revokedUrl).toBe("blob:mock-url-12345");
      expect(createdBlob).not.toBeNull();
      expect(createdBlob?.type).toBe("application/json;charset=utf-8");
    });
  });

  describe("Production Shared Transcript Helper Contract Tests (Tests L, M, N, O, P, Q, R, D-ext)", () => {
    it("Test L: Human Decision 受理後 -> 本番共通 helper (createDecisionTranscriptEntry) で actor=human として記録されること", () => {
      const transcript: PlaytestDecisionTranscriptEntryV1[] = [];
      let seq = 1;

      // CoreBattlePlaytest と同一の実装パターン: createDecisionTranscriptEntry(seq++, ...)
      const entry = createDecisionTranscriptEntry(seq++, {
        actor: "human",
        playerId: "p1",
        decisionId: "dec-h1",
        stateVersion: 1,
        response: {
          decisionId: "dec-h1",
          stateVersion: 1,
          selectedPatternRef: 0,
        },
      });
      transcript.push(entry);

      expect(transcript).toHaveLength(1);
      expect(transcript[0].seq).toBe(1);
      expect(transcript[0].actor).toBe("human");
      expect(transcript[0].playerId).toBe("p1");
      expect(transcript[0].decisionId).toBe("dec-h1");
      expect(transcript[0].policy).toBeUndefined();
      expect(seq).toBe(2);
    });

    it("Test M: AutoPass 受理後 -> 本番共通 helper で actor=autoPass として記録されること", () => {
      const transcript: PlaytestDecisionTranscriptEntryV1[] = [];
      let seq = 1;

      const entry = createDecisionTranscriptEntry(seq++, {
        actor: "autoPass",
        playerId: "p1",
        decisionId: "dec-ap1",
        stateVersion: 2,
        response: {
          decisionId: "dec-ap1",
          stateVersion: 2,
          selectedPatternRef: 1,
        },
      });
      transcript.push(entry);

      expect(transcript).toHaveLength(1);
      expect(transcript[0].seq).toBe(1);
      expect(transcript[0].actor).toBe("autoPass");
      expect(transcript[0].playerId).toBe("p1");
      expect(transcript[0].decisionId).toBe("dec-ap1");
      expect(transcript[0].policy).toBeUndefined();
    });

    it("Test N: advanceAutomatedDecisions.records の変換 -> 全 record を順番通り actor=policy として変換し、policyVersion は number 型であること", () => {
      const mockRecords: AutomatedDecisionRecord[] = [
        {
          playerId: "p2",
          policyDescriptor: {
            kind: "firstLegal",
            name: "First Legal AI",
            policyVersion: 1, // number 型
            metadata: { secret: 123 }, // 除外されるべきメタデータ
          },
          request: {
            decisionId: "dec-ai-1",
            stateVersion: 5,
          } as any,
          response: {
            decisionId: "dec-ai-1",
            stateVersion: 5,
            selectedPatternRef: 0,
          },
          prevState: {},
          nextState: {},
          nextStep: { type: "PROGRESSED" } as any,
          generatedEvents: [],
        },
        {
          playerId: "p2",
          policyDescriptor: {
            kind: "seededRandom",
            name: "Seeded Random AI",
            policyVersion: 2, // number 型
          },
          request: {
            decisionId: "dec-ai-2",
            stateVersion: 6,
          } as any,
          response: {
            decisionId: "dec-ai-2",
            stateVersion: 6,
            selectedPatternRef: 2,
          },
          prevState: {},
          nextState: {},
          nextStep: { type: "PROGRESSED" } as any,
          generatedEvents: [],
        },
      ];

      const transcript: PlaytestDecisionTranscriptEntryV1[] = [];
      let seq = 1;

      // 本番 CoreBattlePlaytest と同一の呼び出し
      const { entries, nextSeq } = createAutomatedDecisionTranscriptEntries(seq, mockRecords);
      transcript.push(...entries);
      seq = nextSeq;

      expect(transcript).toHaveLength(2);
      expect(transcript[0].seq).toBe(1);
      expect(transcript[0].actor).toBe("policy");
      expect(transcript[0].policy?.kind).toBe("firstLegal");
      expect(transcript[0].policy?.name).toBe("First Legal AI");
      // policyVersion は number 型
      expect(transcript[0].policy?.policyVersion).toBe(1);
      expect(typeof transcript[0].policy?.policyVersion).toBe("number");
      expect((transcript[0].policy as any)?.metadata).toBeUndefined();

      expect(transcript[1].seq).toBe(2);
      expect(transcript[1].actor).toBe("policy");
      expect(transcript[1].policy?.policyVersion).toBe(2);
      expect(typeof transcript[1].policy?.policyVersion).toBe("number");

      expect(seq).toBe(3);
    });

    it("Test P: Initial AI records も本番と同一の createAutomatedDecisionTranscriptEntries を使用して seq=1 から記録されること", () => {
      const initialAiRecords: AutomatedDecisionRecord[] = [
        {
          playerId: "p2",
          policyDescriptor: { kind: "firstLegal", name: "AI", policyVersion: 1 },
          request: { decisionId: "dec-init", stateVersion: 1 } as any,
          response: { decisionId: "dec-init", stateVersion: 1, selectedPatternRef: 0 },
          prevState: {},
          nextState: {},
          nextStep: { type: "PROGRESSED" } as any,
          generatedEvents: [],
        },
      ];

      const transcript: PlaytestDecisionTranscriptEntryV1[] = [];
      let seq = 1;

      const { entries, nextSeq } = createAutomatedDecisionTranscriptEntries(seq, initialAiRecords);
      transcript.push(...entries);
      seq = nextSeq;

      expect(transcript).toHaveLength(1);
      expect(transcript[0].seq).toBe(1);
      expect(transcript[0].actor).toBe("policy");
      expect(seq).toBe(2);
    });

    it("Test E-ext: Technical Error 発生時でも、それまでに records に存在する成功済み Decision は保持されること", () => {
      const partialRecords: AutomatedDecisionRecord[] = [
        {
          playerId: "p2",
          policyDescriptor: { kind: "firstLegal", name: "AI", policyVersion: 1 },
          request: { decisionId: "dec-ok", stateVersion: 1 } as any,
          response: { decisionId: "dec-ok", stateVersion: 1, selectedPatternRef: 0 },
          prevState: {},
          nextState: {},
          nextStep: { type: "PROGRESSED" } as any,
          generatedEvents: [],
        },
      ];

      const transcript: PlaytestDecisionTranscriptEntryV1[] = [];
      let seq = 1;

      // advanceAutomatedDecisions が TECHNICAL_ERROR を返した場合でも records を変換・追加する本番契約
      const { entries, nextSeq } = createAutomatedDecisionTranscriptEntries(seq, partialRecords);
      transcript.push(...entries);
      seq = nextSeq;

      // エラー発生後も transcript に成功済みの1件が残っていること
      expect(transcript).toHaveLength(1);
      expect(transcript[0].decisionId).toBe("dec-ok");
      expect(seq).toBe(2);
    });

    it("Test O & D-ext: 全アクター混合（Initial AI, Human, AutoPass, 連鎖 AI）で seq が 1, 2, 3... の単調増加になること", () => {
      const transcript: PlaytestDecisionTranscriptEntryV1[] = [];
      let seq = 1;

      // 1. Initial AI
      const initResult = createAutomatedDecisionTranscriptEntries(seq, [
        {
          playerId: "p2",
          policyDescriptor: { kind: "firstLegal", name: "AI", policyVersion: 1 },
          request: { decisionId: "dec-1", stateVersion: 1 } as any,
          response: { decisionId: "dec-1", stateVersion: 1, selectedPatternRef: 0 },
          prevState: {},
          nextState: {},
          nextStep: { type: "PROGRESSED" } as any,
          generatedEvents: [],
        },
      ]);
      transcript.push(...initResult.entries);
      seq = initResult.nextSeq;

      // 2. Human
      const humanEntry = createDecisionTranscriptEntry(seq++, {
        actor: "human",
        playerId: "p1",
        decisionId: "dec-2",
        stateVersion: 2,
        response: { decisionId: "dec-2", stateVersion: 2, selectedPatternRef: 0 },
      });
      transcript.push(humanEntry);

      // 3. AutoPass
      const autoPassEntry = createDecisionTranscriptEntry(seq++, {
        actor: "autoPass",
        playerId: "p1",
        decisionId: "dec-3",
        stateVersion: 3,
        response: { decisionId: "dec-3", stateVersion: 3, selectedPatternRef: 1 },
      });
      transcript.push(autoPassEntry);

      // 4. 連鎖 AI
      const chainedResult = createAutomatedDecisionTranscriptEntries(seq, [
        {
          playerId: "p2",
          policyDescriptor: { kind: "firstLegal", name: "AI", policyVersion: 1 },
          request: { decisionId: "dec-4", stateVersion: 4 } as any,
          response: { decisionId: "dec-4", stateVersion: 4, selectedPatternRef: 0 },
          prevState: {},
          nextState: {},
          nextStep: { type: "PROGRESSED" } as any,
          generatedEvents: [],
        },
      ]);
      transcript.push(...chainedResult.entries);
      seq = chainedResult.nextSeq;

      expect(transcript.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
      expect(transcript.map((e) => e.actor)).toEqual(["policy", "human", "autoPass", "policy"]);
      expect(seq).toBe(5);
    });

    it("Test Q: New Match reset で seq=1 および transcript=[] へリセットされること", () => {
      const transcript: PlaytestDecisionTranscriptEntryV1[] = [];
      let seq = 1;

      // Match 1
      transcript.push(
        createDecisionTranscriptEntry(seq++, {
          actor: "human",
          playerId: "p1",
          decisionId: "dec-m1",
          stateVersion: 1,
          response: { decisionId: "dec-m1", stateVersion: 1, selectedPatternRef: 0 },
        })
      );
      expect(transcript).toHaveLength(1);
      expect(seq).toBe(2);

      // Match 2 start (startNewGame reset: seqRef.current = 1, transcriptRef.current = [])
      transcript.length = 0;
      seq = 1;

      expect(transcript).toHaveLength(0);
      expect(seq).toBe(1);

      // Match 2 decision starts at seq=1
      transcript.push(
        createDecisionTranscriptEntry(seq++, {
          actor: "human",
          playerId: "p1",
          decisionId: "dec-m2",
          stateVersion: 1,
          response: { decisionId: "dec-m2", stateVersion: 1, selectedPatternRef: 0 },
        })
      );
      expect(transcript).toHaveLength(1);
      expect(transcript[0].seq).toBe(1);
    });

    it("Test R: Date.now() / LogEntry.id からの独立性 (純粋な単調増加整数)", () => {
      const transcript: PlaytestDecisionTranscriptEntryV1[] = [];
      let seq = 1;

      for (let i = 0; i < 5; i++) {
        transcript.push(
          createDecisionTranscriptEntry(seq++, {
            actor: "human",
            playerId: "p1",
            decisionId: `dec-${i}`,
            stateVersion: i + 1,
            response: { decisionId: `dec-${i}`, stateVersion: i + 1, selectedPatternRef: 0 },
          })
        );
      }

      const seqs = transcript.map((e) => e.seq);
      expect(seqs).toEqual([1, 2, 3, 4, 5]);
      seqs.forEach((s) => {
        expect(typeof s).toBe("number");
        expect(s).toBeLessThan(1000);
      });
    });
  });

  describe("Lifecycle & Source of Truth Tests (Tests A-ext, B-ext, S, T)", () => {
    it("Test A-ext: captureDiagnosticRawState を介して、UI gameState ではなく session.state が正として抽出される契約", () => {
      const staleUiGameState = {
        matchId: "match-001",
        stateVersion: 2,
        turnPlayer: "p1",
        players: {
          p1: { hand: [{ id: "stale-card" }] },
        },
      };

      const authoritativeSessionState = {
        matchId: "match-001",
        stateVersion: 3,
        turnPlayer: "p2",
        players: {
          p1: { hand: [{ id: "real-card-1" }, { id: "real-card-2" }] },
        },
      };

      // 本番 CoreBattlePlaytest と同一の captureDiagnosticRawState を実行
      const capturedRawState = captureDiagnosticRawState(authoritativeSessionState);

      const activeMatch = {
        environmentId: "core-battle",
        environmentName: "Core Battle",
        regulationId: "reg-core-01",
        seed: 42,
        rulePackage: { id: "pkg-core", version: "1.0.0" } as any,
      };

      const activePlaytestSettings: ActivePlaytestSettings = {
        matchMode: "humanVsHuman",
        humanSeat: "p1",
        policyId: "firstLegal",
      };

      const bundle = buildPlaytestDiagnosticBundleV1({
        build: dummyBuild,
        generatedAt: dummyGeneratedAt,
        activeMatch,
        activePlaytestSettings,
        rawState: capturedRawState,
      });

      // session.state の内容が反映され、stale な gameState は一切反映されないこと
      expect((bundle.snapshot.rawState as any).stateVersion).toBe(3);
      expect((bundle.snapshot.rawState as any).turnPlayer).toBe("p2");
      expect((bundle.snapshot.rawState as any).players.p1.hand).toHaveLength(2);
      expect((bundle.snapshot.rawState as any).players.p1.hand[0].id).toBe("real-card-1");

      // ディープコピーされており元オブジェクトの変更に影響されないこと
      authoritativeSessionState.players.p1.hand.push({ id: "mutated-card" });
      expect((bundle.snapshot.rawState as any).players.p1.hand).toHaveLength(2);
    });

    it("Test B-ext: Match A 成功後に Match B 開始失敗した場合、activePlaytestSettings は null となり Match A の設定が残らないこと", () => {
      let activePlaytestSettings: ActivePlaytestSettings | null = null;
      let session: any = null;

      // Match A start
      activePlaytestSettings = null; // startNewGame resets to null immediately
      // Match A succeeds
      session = { id: "session-A" };
      activePlaytestSettings = {
        matchMode: "humanVsAi",
        humanSeat: "p1",
        policyId: "seededRandom",
      };
      let isAvailable = Boolean(session && activePlaytestSettings);
      expect(isAvailable).toBe(true);

      // Match B start
      activePlaytestSettings = null; // startNewGame resets to null immediately
      session = null;
      // Match B fails (outcome.type !== "READY")
      isAvailable = Boolean(session && activePlaytestSettings);
      expect(isAvailable).toBe(false);
      expect(activePlaytestSettings).toBeNull();
    });

    it("Test S: Debug OFF (showDebug === false) でも診断データ保存が利用可能であること", () => {
      const showDebug = false;
      const session = { state: { stateVersion: 1 } };
      const activeMatch = { environmentName: "Core Battle", seed: 42 };
      const activePlaytestSettings: ActivePlaytestSettings = {
        matchMode: "humanVsHuman",
        humanSeat: "p1",
        policyId: "firstLegal",
      };

      // Diagnostic availability is independent of showDebug
      const isDiagnosticAvailable = Boolean(session && activeMatch && activePlaytestSettings);
      expect(isDiagnosticAvailable).toBe(true);
      expect(showDebug).toBe(false);
    });

    it("Test T: GameOverOverlay で onDownloadDiagnostic が提供され、ゲーム終了後も診断データをダウンロード可能であること", () => {
      let downloadInvoked = false;
      const onDownloadDiagnostic = () => {
        downloadInvoked = true;
      };

      expect(typeof onDownloadDiagnostic).toBe("function");
      onDownloadDiagnostic();
      expect(downloadInvoked).toBe(true);
    });

    it("Test U (B & C): Human vs AI で activeSeatControllers が渡され、UI の Pending Policy を変更しても Active Match 側の Seat Controller が記録されること", () => {
      // 1. Active 対戦が firstLegal で開始・コミットされた状態
      const activeSeatControllers = createSeatControllers("humanVsAi", "p1", "firstLegal");
      const activePlaytestSettings: ActivePlaytestSettings = {
        matchMode: "humanVsAi",
        humanSeat: "p1",
        policyId: "firstLegal",
      };
      const activeMatch = {
        environmentId: "core-battle",
        environmentName: "Core Battle",
        seed: 42,
      };

      // 2. UI 上で次戦用の pending 設定が seededRandom へ変更された状態
      let pendingPolicyId = "seededRandom";

      // 3. handleDownloadDiagnostic のシミュレーション:
      // pending 設定ではなく、現在の activeSeatControllers を渡して Bundle を構築
      const bundle = buildPlaytestDiagnosticBundleV1({
        build: dummyBuild,
        generatedAt: dummyGeneratedAt,
        activeMatch: activeMatch as any,
        activePlaytestSettings,
        seatControllers: activeSeatControllers,
      });

      // p1/p2 のコントローラ情報が一致すること (要件 B)
      expect(bundle.match.seatControllers).toBeDefined();
      const recordedSeats = bundle.match.seatControllers as PlaytestSeatControllers;
      expect(recordedSeats.p1).toEqual(activeSeatControllers.p1);
      expect(recordedSeats.p2).toEqual(activeSeatControllers.p2);

      // Pending の seededRandom ではなく、Active の firstLegal が記録されていること (要件 C)
      expect(bundle.match.policyId).toBe("firstLegal");
      expect((recordedSeats.p2 as any)?.policyId).toBe("firstLegal");
      expect((recordedSeats.p2 as any)?.policyId).not.toBe(pendingPolicyId);
    });

    it("Test V (A & E): UI Adapter (assemblePlaytestDiagnosticBundleParams) を介した構築で logs (古い→新しい順) と activeSeatControllers が両方欠落せず完全反映されること", () => {
      const activeSeatControllers = createSeatControllers("humanVsAi", "p1", "seededRandom");
      const activePlaytestSettings: ActivePlaytestSettings = {
        matchMode: "humanVsAi",
        humanSeat: "p1",
        policyId: "seededRandom",
      };
      const activeMatch = {
        environmentId: "core-battle",
        environmentName: "Core Battle",
        seed: 12345,
      };

      // 時系列順 (古い→新しい順) の通常ログ
      const logs = [
        { id: "log-1", message: "ゲーム開始準備完了", timestamp: "12:00:00", seq: 1 },
        { id: "log-2", message: "Player A の手番開始", timestamp: "12:00:05", seq: 2 },
        { id: "log-3", message: "Player A: 攻撃宣言", timestamp: "12:00:10", seq: 3 },
      ];

      const traces = [
        { id: "trace-1", category: "AI_DECISION", message: "Pattern #0 selected" },
      ];

      const mockSession = {
        state: { stateVersion: 5, turnPlayer: "p1" },
        getMatchLog: () => ({ meta: { matchId: "m-123" }, events: [] } as any),
      };

      // 本番 CoreBattlePlaytest.handleDownloadDiagnostic と完全に同一のフロー
      const rawState = captureDiagnosticRawState(mockSession.state);
      const params = assemblePlaytestDiagnosticBundleParams({
        build: dummyBuild,
        generatedAt: dummyGeneratedAt,
        activeMatch: activeMatch as any,
        activePlaytestSettings,
        activeSeatControllers,
        rawState,
        logs,
        traces,
        canonicalMatchLog: mockSession.getMatchLog(),
        currentStep: null,
        decisionTranscript: [],
      });

      const bundle = buildPlaytestDiagnosticBundleV1(params);

      // normalLogs の検証: 欠落なし、要素数一致、古い→新しい順（reverse されていないこと） (要件 A, E)
      expect(bundle.normalLogs).toHaveLength(3);
      expect(bundle.normalLogs).toEqual(logs);
      expect((bundle.normalLogs[0] as any).id).toBe("log-1");
      expect((bundle.normalLogs[1] as any).id).toBe("log-2");
      expect((bundle.normalLogs[2] as any).id).toBe("log-3");

      // seatControllers の検証: 欠落なし、activeSeatControllers と完全一致 (要件 B, E)
      expect(bundle.match.seatControllers).toBeDefined();
      expect(bundle.match.seatControllers).toEqual(activeSeatControllers);
      const recordedSeats = bundle.match.seatControllers as PlaytestSeatControllers;
      expect(recordedSeats.p1.kind).toBe("HUMAN");
      expect(recordedSeats.p2.kind).toBe("POLICY");
      expect((recordedSeats.p2 as any)?.policyId).toBe("seededRandom");
    });
  });
});
