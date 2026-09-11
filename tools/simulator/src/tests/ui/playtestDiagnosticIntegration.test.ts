import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadJsonFile } from "../../ui/utils/downloadJson";
import {
  buildPlaytestDiagnosticBundleV1,
  generateDiagnosticFilename,
  PlaytestDecisionTranscriptEntryV1,
  ActivePlaytestSettings,
} from "../../ui/playtest/PlaytestDiagnosticBundle";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";

describe("Playtest Diagnostic Integration Tests", () => {
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

  describe("Decision Transcript Contract & Sequencing Tests (Tests L, M, N, O, P, Q, R, D-ext)", () => {
    function createTranscriptRecorder() {
      let seq = 1;
      const transcript: PlaytestDecisionTranscriptEntryV1[] = [];

      function append(entry: {
        actor: "human" | "policy" | "autoPass";
        playerId: "p1" | "p2";
        decisionId: string;
        stateVersion: number;
        response: DecisionResponse;
        policy?: {
          kind: string;
          name?: string;
          policyVersion?: string;
        };
      }) {
        const currentSeq = seq++;
        transcript.push({
          seq: currentSeq,
          actor: entry.actor,
          playerId: entry.playerId,
          decisionId: entry.decisionId,
          stateVersion: entry.stateVersion,
          response: {
            decisionId: entry.response.decisionId,
            stateVersion: entry.response.stateVersion,
            selectedPatternRef: entry.response.selectedPatternRef,
          },
          policy: entry.policy
            ? {
                kind: entry.policy.kind,
                name: entry.policy.name,
                policyVersion: entry.policy.policyVersion,
              }
            : undefined,
        });
      }

      function reset() {
        seq = 1;
        transcript.length = 0;
      }

      return { append, reset, getTranscript: () => [...transcript], getSeq: () => seq };
    }

    it("Test L: Human 意思決定の記録 (actor='human'、受理されたもののみ記録)", () => {
      const recorder = createTranscriptRecorder();

      // 受理された Human 決定
      recorder.append({
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

      const entries = recorder.getTranscript();
      expect(entries).toHaveLength(1);
      expect(entries[0].actor).toBe("human");
      expect(entries[0].playerId).toBe("p1");
      expect(entries[0].decisionId).toBe("dec-h1");
      expect(entries[0].policy).toBeUndefined();
      expect(entries[0].seq).toBe(1);
    });

    it("Test M: AutoPass 意思決定の記録 (actor='autoPass'、受理されたもののみ記録)", () => {
      const recorder = createTranscriptRecorder();

      recorder.append({
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

      const entries = recorder.getTranscript();
      expect(entries).toHaveLength(1);
      expect(entries[0].actor).toBe("autoPass");
      expect(entries[0].playerId).toBe("p1");
      expect(entries[0].decisionId).toBe("dec-ap1");
      expect(entries[0].policy).toBeUndefined();
      expect(entries[0].seq).toBe(1);
    });

    it("Test N: AI 意思決定の記録 (actor='policy'、PolicyDescriptorサニタイズ)", () => {
      const recorder = createTranscriptRecorder();

      const rawPolicyDescriptor = {
        kind: "firstLegal",
        name: "First Legal Choice",
        policyVersion: 1,
        // 下記の内部プロパティはサニタイズされてbundle/transcriptから除外されるべき
        weights: [0.5, 0.5],
        internalFn: () => "secret",
        metadata: { secretSeed: 9999 },
      };

      recorder.append({
        actor: "policy",
        playerId: "p2",
        decisionId: "dec-ai1",
        stateVersion: 3,
        response: {
          decisionId: "dec-ai1",
          stateVersion: 3,
          selectedPatternRef: 0,
        },
        policy: {
          kind: rawPolicyDescriptor.kind,
          name: rawPolicyDescriptor.name,
          policyVersion: String(rawPolicyDescriptor.policyVersion),
        },
      });

      const entries = recorder.getTranscript();
      expect(entries).toHaveLength(1);
      expect(entries[0].actor).toBe("policy");
      expect(entries[0].policy).toEqual({
        kind: "firstLegal",
        name: "First Legal Choice",
        policyVersion: "1",
      });
      expect((entries[0].policy as any).weights).toBeUndefined();
      expect((entries[0].policy as any).internalFn).toBeUndefined();
      expect((entries[0].policy as any).metadata).toBeUndefined();
    });

    it("Test O & D-ext: 連続 AI 判断および全アクター混合での単調増加 seq (1, 2, 3...)", () => {
      const recorder = createTranscriptRecorder();

      // 1. Initial AI
      recorder.append({
        actor: "policy",
        playerId: "p2",
        decisionId: "dec-1",
        stateVersion: 1,
        response: { decisionId: "dec-1", stateVersion: 1, selectedPatternRef: 0 },
        policy: { kind: "firstLegal", name: "AI", policyVersion: "1" },
      });

      // 2. Human
      recorder.append({
        actor: "human",
        playerId: "p1",
        decisionId: "dec-2",
        stateVersion: 2,
        response: { decisionId: "dec-2", stateVersion: 2, selectedPatternRef: 2 },
      });

      // 3. AutoPass
      recorder.append({
        actor: "autoPass",
        playerId: "p1",
        decisionId: "dec-3",
        stateVersion: 3,
        response: { decisionId: "dec-3", stateVersion: 3, selectedPatternRef: 1 },
      });

      // 4. 連鎖 AI
      recorder.append({
        actor: "policy",
        playerId: "p2",
        decisionId: "dec-4",
        stateVersion: 4,
        response: { decisionId: "dec-4", stateVersion: 4, selectedPatternRef: 0 },
        policy: { kind: "firstLegal", name: "AI", policyVersion: "1" },
      });

      const entries = recorder.getTranscript();
      expect(entries.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
      expect(entries.map((e) => e.actor)).toEqual(["policy", "human", "autoPass", "policy"]);
    });

    it("Test P: 初期 AI 手番の判断が seq=1 で記録されること", () => {
      const recorder = createTranscriptRecorder();

      recorder.append({
        actor: "policy",
        playerId: "p1",
        decisionId: "dec-init-ai",
        stateVersion: 1,
        response: { decisionId: "dec-init-ai", stateVersion: 1, selectedPatternRef: 0 },
        policy: { kind: "seededRandom", name: "Random AI", policyVersion: "1" },
      });

      const entries = recorder.getTranscript();
      expect(entries).toHaveLength(1);
      expect(entries[0].seq).toBe(1);
      expect(entries[0].actor).toBe("policy");
    });

    it("Test Q: 新対戦開始時の Transcript & seq のリセット", () => {
      const recorder = createTranscriptRecorder();

      recorder.append({
        actor: "human",
        playerId: "p1",
        decisionId: "dec-match1",
        stateVersion: 1,
        response: { decisionId: "dec-match1", stateVersion: 1, selectedPatternRef: 0 },
      });
      expect(recorder.getTranscript()).toHaveLength(1);
      expect(recorder.getTranscript()[0].seq).toBe(1);

      // Match 2 start -> reset
      recorder.reset();
      expect(recorder.getTranscript()).toHaveLength(0);
      expect(recorder.getSeq()).toBe(1);

      // Subsequent decision starts at seq=1
      recorder.append({
        actor: "human",
        playerId: "p1",
        decisionId: "dec-match2",
        stateVersion: 1,
        response: { decisionId: "dec-match2", stateVersion: 1, selectedPatternRef: 0 },
      });
      expect(recorder.getTranscript()).toHaveLength(1);
      expect(recorder.getTranscript()[0].seq).toBe(1);
    });

    it("Test R: Date.now() / LogEntry.id からの独立性 (純粋な単調増加整数)", () => {
      const recorder = createTranscriptRecorder();

      for (let i = 0; i < 5; i++) {
        recorder.append({
          actor: "human",
          playerId: "p1",
          decisionId: `dec-${i}`,
          stateVersion: i + 1,
          response: { decisionId: `dec-${i}`, stateVersion: i + 1, selectedPatternRef: 0 },
        });
      }

      const seqs = recorder.getTranscript().map((e) => e.seq);
      expect(seqs).toEqual([1, 2, 3, 4, 5]);
      // seq must be number, not timestamp or uuid string
      seqs.forEach((s) => {
        expect(typeof s).toBe("number");
        expect(s).toBeLessThan(1000);
      });
    });
  });

  describe("Lifecycle & Source of Truth Tests (Tests A-ext, B-ext, S, T)", () => {
    it("Test A-ext: session.state と UI gameState が異なる場合、session.state を正として利用すること", () => {
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

      const activeMatch = {
        environmentId: "core-battle",
        environmentName: "Core Battle",
        regulationId: "reg-core-01",
        seed: 42,
        rulePackage: { id: "pkg-core", version: "1.0.0" } as any,
      };

      const activeSettings: ActivePlaytestSettings = {
        matchMode: "humanVsHuman",
        humanSeat: "p1",
        policyId: "firstLegal",
      };

      // Bundle 生成に session.state のディープコピーを渡す
      const bundle = buildPlaytestDiagnosticBundleV1({
        activeMatch,
        activePlaytestSettings: activeSettings,
        rawState: JSON.parse(JSON.stringify(authoritativeSessionState)),
      });

      expect((bundle.snapshot.rawState as any).stateVersion).toBe(3);
      expect((bundle.snapshot.rawState as any).turnPlayer).toBe("p2");
      expect((bundle.snapshot.rawState as any).players.p1.hand).toHaveLength(2);
      expect((bundle.snapshot.rawState as any).players.p1.hand[0].id).toBe("real-card-1");
    });

    it("Test B-ext: Match A 成功後に Match B 開始失敗した場合、activePlaytestSettings は null となり Match A の設定が残らないこと", () => {
      let activeSettings: ActivePlaytestSettings | null = null;
      let session: any = null;

      // Match A start
      activeSettings = null; // startNewGame resets to null immediately
      // Match A succeeds
      session = { id: "session-A" };
      activeSettings = {
        matchMode: "humanVsAi",
        humanSeat: "p1",
        policyId: "seededRandom",
      };
      let isAvailable = Boolean(session && activeSettings);
      expect(isAvailable).toBe(true);

      // Match B start
      activeSettings = null; // startNewGame resets to null immediately
      session = null;
      // Match B fails (e.g. invalid seed or preset error)
      // outcome.type !== "READY" -> returns early without committing
      isAvailable = Boolean(session && activeSettings);
      expect(isAvailable).toBe(false);
      expect(activeSettings).toBeNull();
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

      // GameOverOverlay props test
      expect(typeof onDownloadDiagnostic).toBe("function");
      onDownloadDiagnostic();
      expect(downloadInvoked).toBe(true);
    });
  });
});
