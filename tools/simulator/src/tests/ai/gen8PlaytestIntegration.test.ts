import { describe, it, expect } from "vitest";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import {
  PLAYTEST_POLICY_OPTIONS,
  PlaytestPolicyOption,
} from "../../engine/playtest/PlaytestSeatController";
import {
  GEN8_CHAMPION_CANDIDATE_POLICY_ID,
  GEN8_CHAMPION_CANDIDATE_GENOME_ID,
  GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST,
  GEN8_CHAMPION_CANDIDATE_SUPPORTED_REGULATION_ID,
  loadAndValidateGen8ChampionCandidateDNA,
  createGen8ChampionCandidatePolicy,
} from "../../engine/ai/Gen8DNALoader";
import { PlaytestPerspectiveResolver } from "../../ui/playtest/PlaytestPerspectiveResolver";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter";
import { PlayerObservation } from "../../domain/decision/PlayerObservation";
import {
  createHumanFeedbackEntry,
  exportSanitizedPlaytestFeedbackBundle,
  HumanFeedbackCategory,
} from "../../ui/playtest/PlaytestFeedbackTypes";
import { PlaytestDiagnosticBundleV1 } from "../../ui/playtest/PlaytestDiagnosticBundle";
import { PlaytestDecisionTranscriptEntryV1 } from "../../ui/playtest/PlaytestDecisionTranscript";

describe("Gen 8 Playtest Integration Tests", () => {
  describe("1. Gen 8 DNA Authenticity & Factory Integration", () => {
    it("should load the authentic Gen 8 candidate DNA matching the registered digest", () => {
      const dna = loadAndValidateGen8ChampionCandidateDNA();
      expect(dna).toBeDefined();
      expect(dna.metadata?.id).toBe("dna-gen8-prod-g0-ind7-cross7");
    });

    it("should instantiate GenomePolicy for Gen 8 candidate in standard-pack regulation", () => {
      const policy = PlaytestPolicyFactory.createPolicy(
        GEN8_CHAMPION_CANDIDATE_POLICY_ID,
        12345,
        "p2",
        GEN8_CHAMPION_CANDIDATE_SUPPORTED_REGULATION_ID
      );
      expect(policy).toBeDefined();
      expect(policy.descriptor.kind).toBe("genome");
      expect(policy.descriptor.name).toBe("Gen 8 Champion Candidate");
    });

    it("should fail-closed if Gen 8 candidate is requested for an unsupported regulation", () => {
      expect(() => {
        PlaytestPolicyFactory.createPolicy(
          GEN8_CHAMPION_CANDIDATE_POLICY_ID,
          12345,
          "p2",
          "light-entry16"
        );
      }).toThrowError(/Gen 8 Champion Candidate AI は公式レギュレーション standard-pack 専用です/);

      expect(() => {
        PlaytestPolicyFactory.createPolicy(
          GEN8_CHAMPION_CANDIDATE_POLICY_ID,
          12345,
          "p2",
          undefined
        );
      }).toThrowError(/Gen 8 Champion Candidate AI は公式レギュレーション standard-pack 専用です/);
    });

    it("should register Gen 8 Candidate in PLAYTEST_POLICY_OPTIONS with standard-pack regulation filter", () => {
      const option = PLAYTEST_POLICY_OPTIONS.find(
        (opt) => opt.id === GEN8_CHAMPION_CANDIDATE_POLICY_ID
      );
      expect(option).toBeDefined();
      expect(option?.label).toBe("Gen 8 Champion Candidate（正式Holdout検証済み）");
      expect(option?.description).toContain("スタンダード＋パック向け進化AI");
      expect(option?.description).toContain("Gen 7との正式Holdout 240試合で147勝93敗");
      expect(option?.supportedRegulationIds).toEqual(["standard-pack"]);
      expect(option?.evolutionDetails).toBeDefined();
      expect(option?.evolutionDetails?.generation).toBe("Gen 8 (g0-ind7-cross7)");
      expect(option?.evolutionDetails?.dnaSchema).toBe("v6");
    });
  });

  describe("2. Human vs AI Perspective & Hidden Information Protection", () => {
    it("should always position the active human seat at the bottom (front) in Human vs AI mode", () => {
      // Human is P1
      const p1Perspective = PlaytestPerspectiveResolver.resolvePerspective({
        matchMode: "humanVsAi",
        activeHumanSeat: "p1",
      });
      expect(p1Perspective.bottomPlayerKey).toBe("p1");
      expect(p1Perspective.topPlayerKey).toBe("p2");

      // Human is P2
      const p2Perspective = PlaytestPerspectiveResolver.resolvePerspective({
        matchMode: "humanVsAi",
        activeHumanSeat: "p2",
      });
      expect(p2Perspective.bottomPlayerKey).toBe("p2");
      expect(p2Perspective.topPlayerKey).toBe("p1");
    });

    it("should conceal AI opponent hand cards in player ViewModel when viewed by human", () => {
      // Mock boardObservation with opponent cards concealed
      const mockObservation: PlayerObservation = {
        rulePackageId: "standard-pack",
        regulationId: "standard-pack",
        viewerPlayerId: "p1",
        players: [
          {
            playerId: "p1",
            name: "Player A",
            isViewer: true,
            lifeDisplay: "15",
            lifeCount: 15,
            handCount: 5,
            handCards: [{ instanceId: "c1", cardId: "card-1" }],
            field: [],
            fog: [],
            graveCount: 0,
            grave: [],
          },
          {
            playerId: "p2",
            name: "Gen 8 AI",
            isViewer: false,
            lifeDisplay: "15",
            lifeCount: 15,
            handCount: 5,
            handCards: [], // Opponent cards masked
            field: [],
            fog: [],
            graveCount: 0,
            grave: [],
          },
        ],
      } as any;

      const mockGameState: any = {
        players: {
          p1: { name: "Player A" },
          p2: { name: "Gen 8 AI" },
        },
        turnPlayer: "p1",
        chancePlayer: "p1",
      };

      // ViewModel for opponent P2 seen by human P1
      const opponentViewModel = PlayerObservationPresenter.buildPlayerViewModel(
        "p2",
        mockObservation,
        mockGameState,
        "p1" // viewer is human
      );

      expect(opponentViewModel.isViewer).toBe(false);
      expect(opponentViewModel.handCount).toBe(5);
      expect(opponentViewModel.handCards).toEqual([]); // Non-public hand cards are NOT exposed!
    });
  });

  describe("3. Feedback System & Sanitized Share Bundle", () => {
    const sampleTranscriptEntry: PlaytestDecisionTranscriptEntryV1 = {
      seq: 12,
      actor: "policy",
      playerId: "p2",
      decisionId: "dec-test-9999",
      stateVersion: 45,
      response: {
        decisionId: "dec-test-9999",
        stateVersion: 45,
        selectedPatternRef: 3,
      },
      policy: {
        kind: "genome",
        name: "Gen 8 Champion Candidate",
        policyVersion: 1,
      },
    };

    it("should create human feedback entry linked with decision ID, pattern, seed, and DNA digest", () => {
      const feedback = createHumanFeedbackEntry({
        category: "WHY_NO_ATTACK",
        note: "敵ライフが1なのに直接攻撃せずPASSした",
        transcriptEntry: sampleTranscriptEntry,
        matchSeed: 350050,
        aiGenomeId: GEN8_CHAMPION_CANDIDATE_GENOME_ID,
        aiDnaDigest: GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST,
      });

      expect(feedback.feedbackId).toMatch(/^fb-/);
      expect(feedback.category).toBe("WHY_NO_ATTACK");
      expect(feedback.categoryLabel).toBe("なぜ攻撃しなかった？");
      expect(feedback.note).toBe("敵ライフが1なのに直接攻撃せずPASSした");
      expect(feedback.decisionId).toBe("dec-test-9999");
      expect(feedback.selectedPatternRef).toBe(3);
      expect(feedback.stateVersion).toBe(45);
      expect(feedback.matchSeed).toBe(350050);
      expect(feedback.aiGenomeId).toBe(GEN8_CHAMPION_CANDIDATE_GENOME_ID);
      expect(feedback.aiDnaDigest).toBe(GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST);
    });

    it("should export sanitized feedback bundle stripping all private / raw secret information", () => {
      const mockDiagnosticBundle: PlaytestDiagnosticBundleV1 = {
        kind: "blackpoker-playtest-diagnostic",
        schemaVersion: 1,
        generatedAt: "2026-11-07T21:00:00.000Z",
        containsHiddenInformation: true, // Original contains secrets!
        build: { sha: "abc1234", ref: "test-ref" },
        match: {
          matchId: "match-001",
          environmentId: "env-sp",
          environmentName: "Standard Pack",
          regulationId: "standard-pack",
          formatId: "standard",
          frameId: "pack",
          seed: 350050,
          matchMode: "humanVsAi",
          humanSeat: "p1",
          policyId: GEN8_CHAMPION_CANDIDATE_POLICY_ID,
          policyMetadata: {
            genomeId: GEN8_CHAMPION_CANDIDATE_GENOME_ID,
            schemaVersion: 6,
            fullDnaDigest: GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST,
          },
          seatControllers: {},
          status: "FINISHED",
          winner: "p1",
          finishReason: "Opponent life reached 0",
        },
        normalLogs: ["log1", "log2 with secret card details"],
        traces: ["trace with full hidden deck cards"],
        canonicalMatchLog: { meta: {}, events: [] } as any,
        decisionTranscript: [sampleTranscriptEntry],
        snapshot: {
          stateVersion: 45,
          rawState: { secretFullDeck: ["secretCardA", "secretCardB"] }, // Sensitive data!
        },
      };

      const feedback = createHumanFeedbackEntry({
        category: "WHY_PASS",
        note: "不自然なPASS",
        transcriptEntry: sampleTranscriptEntry,
        matchSeed: 350050,
        aiGenomeId: GEN8_CHAMPION_CANDIDATE_GENOME_ID,
        aiDnaDigest: GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST,
      });

      const sanitized = exportSanitizedPlaytestFeedbackBundle(mockDiagnosticBundle, [feedback]);

      expect(sanitized.kind).toBe("blackpoker-playtest-feedback-share");
      expect(sanitized.containsHiddenInformation).toBe(false); // Secrets stripped!
      expect((sanitized as any).normalLogs).toBeUndefined();
      expect((sanitized as any).traces).toBeUndefined();
      expect((sanitized as any).canonicalMatchLog).toBeUndefined();
      expect((sanitized as any).snapshot).toBeUndefined();
      expect((sanitized as any).rawState).toBeUndefined();

      // Verified safe public info
      expect(sanitized.match.environmentName).toBe("Standard Pack");
      expect(sanitized.match.policyId).toBe("gen8-champion-candidate");
      expect(sanitized.match.policyMetadata?.genomeId).toBe(GEN8_CHAMPION_CANDIDATE_GENOME_ID);
      expect(sanitized.feedbacks.length).toBe(1);
      expect(sanitized.feedbacks[0].categoryLabel).toBe("なぜPASSした？");
      expect(sanitized.sanitizedTranscript.length).toBe(1);
      expect(sanitized.sanitizedTranscript[0].decisionId).toBe("dec-test-9999");
    });
  });
});
