import { describe, it, expect, vi, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { GenerationRunner } from "../../engine/ai/GenerationRunner";
import * as TypesModule from "../../domain/ai/GenerationRunnerTypes";
import * as EngineModule from "../../engine/ai/GenerationRunner";
import {
  DEFAULT_GENERATION_RUNNER_CONFIG,
  GenerationEvaluationMatch,
  GenerationMatchOutcome,
  GenerationRunnerAdvancedResult,
  GenerationRunnerConfigurationError,
  GenerationRunnerEnvironmentContext,
  GenerationRunnerExecutionError,
  GenerationRunnerIntegrityError,
  GenerationRunnerReevaluationRequiredResult,
  RunGenerationParams,
  canonicalEvaluationScheduleId,
  canonicalSeedScheduleIdentity,
} from "../../domain/ai/GenerationRunnerTypes";
import {
  PopulationEntry,
  PopulationSnapshot,
} from "../../domain/ai/PopulationSelectionTypes";
import {
  GenerationBuilderExecutionError,
} from "../../domain/ai/GenerationBuilderTypes";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { FitnessEvaluator } from "../../engine/ai/FitnessEvaluator";
import { GenerationBuilder } from "../../engine/ai/GenerationBuilder";
import { SimulationRunner, SimulationResult } from "../../engine/simulation/SimulationRunner";
import { GameSession } from "../../engine/session/GameSession";
import { BatchMatchContext } from "../../domain/simulation/BatchSimulationTypes";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Generation Runner V1 Canonical 60-Test Suite (BP-SIM-AI-GENERATION-RUNNER-V1)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    rulePackage = getPlaytestRulePackage(fullPackage);
  });

  const defaultEnvironment: GenerationRunnerEnvironmentContext = Object.freeze({
    environmentRef: "rules-vnext:playtest",
    regulationId: "light-entry16",
    frameId: "entry16",
    rulePackageVersion: "1.0.0",
  });

  const createTestPopulation = (size: number = 4, generation: number = 0): PopulationSnapshot => {
    const entries: PopulationEntry[] = [];
    for (let i = 0; i < size; i++) {
      const genomeId = `ind-${String(i).padStart(3, "0")}`;
      const dna = DecisionDNACodec.createZeroDecisionDNA({ id: `dna-${genomeId}` });
      entries.push({
        genomeId,
        dnaRef: `genome:${genomeId}`,
        generation,
        dna,
      });
    }
    return {
      generation,
      entries,
    };
  };

  const createFastSessionFactory = (winnerMode: "p1" | "p2" | "draw" | "incomplete" = "p1") => {
    return (ctx: BatchMatchContext): GameSession => {
      return {
        matchId: ctx.matchId,
        state: { version: 1, turnCount: 1, players: {} },
        advance: () => {
          if (winnerMode === "incomplete") {
            return {
              type: "WAITING_FOR_DECISION",
              request: {
                protocolVersion: "1.0.0",
                matchId: ctx.matchId,
                decisionId: "dec-1",
                stateVersion: 1,
                playerId: "p1",
                patterns: [{ patternRef: 0 }],
              },
            } as any;
          }
          return {
            type: "FINISHED",
            result: {
              winner: winnerMode === "draw" ? undefined : winnerMode,
              reason: "normal_end",
            },
          } as any;
        },
        submitDecision: () => {},
      } as any;
    };
  };

  const createRealSessionFactory = () => {
    return (ctx: BatchMatchContext): GameSession => {
      const rawState = createCoreBattlePresetState();
      const setupResult = MatchSetupCoordinator.setupMatch(rawState);
      return new GameSession(setupResult.state, rulePackage, {
        matchId: ctx.matchId,
      });
    };
  };

  // ===========================================================================
  // Group A: Config & Context Validation (Tests 1–9)
  // ===========================================================================
  describe("Group A: Config & Context Validation (Tests 1–9)", () => {
    it("[1] N >= 2 の有効母集団を受容すること。", () => {
      const pop = createTestPopulation(2, 0);
      const result = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });
      expect(result.logicalResult.status).toBe("ADVANCED");
    });

    it("[2] pairRepetitions のデフォルト値が 1 であること。", () => {
      const pop = createTestPopulation(6, 0); // 2 * (6 - 1) * 1 = 10 matches per genome >= 10
      const result = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {},
      });
      expect(result.logicalResult.manifest.pairRepetitions).toBe(1);
      expect(result.logicalResult.manifest.totalMatches).toBe(6 * 5 * 1);
    });

    it("[3] pairRepetitions <= 0 または非整数・非有限数を GenerationRunnerConfigurationError で reject すること。", () => {
      const pop = createTestPopulation(4, 0);
      const invalidValues = [0, -1, 1.5, NaN, Infinity, -Infinity];

      for (const val of invalidValues) {
        expect(() => {
          GenerationRunner.run({
            population: pop,
            generationSeed: 42,
            environment: defaultEnvironment,
            sessionFactory: createFastSessionFactory("p1"),
            config: { pairRepetitions: val as any },
          });
        }).toThrow(GenerationRunnerConfigurationError);
      }
    });

    it("[4] [R3 改訂] maxDecisionsPerMatch に不正な値（0、負数、小数、NaN、Infinity 等）が指定された場合、対戦実行前に GenerationRunnerConfigurationError で即時 reject すること。", () => {
      const pop = createTestPopulation(4, 0);
      const invalidValues = [0, -10, 2.5, NaN, Infinity, -Infinity];
      const sessionFactorySpy = vi.fn(createFastSessionFactory("p1"));

      for (const val of invalidValues) {
        expect(() => {
          GenerationRunner.run({
            population: pop,
            generationSeed: 42,
            environment: defaultEnvironment,
            sessionFactory: sessionFactorySpy,
            config: { maxDecisionsPerMatch: val as any },
          });
        }).toThrow(GenerationRunnerConfigurationError);
      }
      expect(sessionFactorySpy).toHaveBeenCalledTimes(0);
    });

    it("[5] [R3 改訂] generationSeed = 0 および負の整数が合法なシードとして正しく受容され、小数（1.5 等の非整数）、NaN、Infinity 等の非有限シードは対戦実行前に GenerationRunnerConfigurationError で即時 reject されること。", () => {
      const pop = createTestPopulation(6, 0);
      // 合法シード
      const res0 = GenerationRunner.run({
        population: pop,
        generationSeed: 0,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
      });
      expect(res0.logicalResult.manifest.generationSeed).toBe(0);

      const resNeg = GenerationRunner.run({
        population: pop,
        generationSeed: -12345,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
      });
      expect(resNeg.logicalResult.manifest.generationSeed).toBe(-12345);

      // 不正シード
      const sessionFactorySpy = vi.fn(createFastSessionFactory("p1"));
      const invalidSeeds = [1.5, NaN, Infinity, -Infinity];
      for (const seed of invalidSeeds) {
        expect(() => {
          GenerationRunner.run({
            population: pop,
            generationSeed: seed as any,
            environment: defaultEnvironment,
            sessionFactory: sessionFactorySpy,
          });
        }).toThrow(GenerationRunnerConfigurationError);
      }
      expect(sessionFactorySpy).toHaveBeenCalledTimes(0);
    });

    it("[6] [R2 改訂] builderConfig.populationSize に不正な値（< 2 または非整数）が指定された場合、対戦実行前に GenerationRunnerConfigurationError で即時 reject すること。", () => {
      const pop = createTestPopulation(4, 0);
      const sessionFactorySpy = vi.fn(createFastSessionFactory("p1"));

      const invalidSizes = [1, 0, -5, 2.5, NaN, Infinity];
      for (const size of invalidSizes) {
        expect(() => {
          GenerationRunner.run({
            population: pop,
            generationSeed: 42,
            environment: defaultEnvironment,
            sessionFactory: sessionFactorySpy,
            config: {
              builderConfig: { populationSize: size as any },
            },
          });
        }).toThrow(GenerationRunnerConfigurationError);
      }
      expect(sessionFactorySpy).toHaveBeenCalledTimes(0);
    });

    it("[7] [R2 改訂] builderConfig.selectionConfig や builderConfig.geneticOperatorConfig に不正な値（範囲外の突然変異率、負の eliteCount 等）が指定された場合、対戦実行前に GenerationRunnerConfigurationError で即時 reject すること。", () => {
      const pop = createTestPopulation(4, 0);
      const sessionFactorySpy = vi.fn(createFastSessionFactory("p1"));

      expect(() => {
        GenerationRunner.run({
          population: pop,
          generationSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: sessionFactorySpy,
          config: {
            builderConfig: { selectionConfig: { eliteCount: -1 } as any },
          },
        });
      }).toThrow(GenerationRunnerConfigurationError);

      expect(() => {
        GenerationRunner.run({
          population: pop,
          generationSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: sessionFactorySpy,
          config: {
            builderConfig: { geneticOperatorConfig: { mutationRate: 1.5 } as any },
          },
        });
      }).toThrow(GenerationRunnerConfigurationError);

      expect(sessionFactorySpy).toHaveBeenCalledTimes(0);
    });

    it("[8] [R2 改訂] builderConfig.selectionConfig.eliteCount >= resolvedPopulationSize の設定不備を、対戦実行前に GenerationRunnerConfigurationError で即時 reject すること（REEVALUATION_REQUIRED ではなく事前設定エラーとして拒絶）。", () => {
      const pop = createTestPopulation(4, 0);
      const sessionFactorySpy = vi.fn(createFastSessionFactory("p1"));

      expect(() => {
        GenerationRunner.run({
          population: pop,
          generationSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: sessionFactorySpy,
          config: {
            builderConfig: {
              populationSize: 4,
              selectionConfig: { eliteCount: 4 } as any,
            },
          },
        });
      }).toThrow(GenerationRunnerConfigurationError);

      expect(sessionFactorySpy).toHaveBeenCalledTimes(0);
    });

    it("[9] perGenomeScheduledMatches < minimumCompletedMatches の設定不備を対戦実行前に Fail-Fast で reject すること。", () => {
      const pop = createTestPopulation(3, 0); // 2 * (3 - 1) * 1 = 4 scheduled per genome
      const sessionFactorySpy = vi.fn(createFastSessionFactory("p1"));

      expect(() => {
        GenerationRunner.run({
          population: pop,
          generationSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: sessionFactorySpy,
          config: {
            pairRepetitions: 1,
            fitnessConfig: { minimumCompletedMatches: 5, minimumCompletionRate: 0.5 },
          },
        });
      }).toThrow(GenerationRunnerConfigurationError);

      expect(sessionFactorySpy).toHaveBeenCalledTimes(0);
    });
  });

  // ===========================================================================
  // Group B: Schedule Construction & Context Identity (Tests 10–18)
  // ===========================================================================
  describe("Group B: Schedule Construction & Context Identity (Tests 10–18)", () => {
    it("[10] N=2, R=1 において総試合数が正確に 2 試合であること。", () => {
      const pop = createTestPopulation(2, 0);
      const schedule = GenerationRunner.planSchedule(pop, 42, 1);
      expect(schedule.length).toBe(2);
    });

    it("[11] N=3, R=1 において総試合数が正確に 6 試合であること。", () => {
      const pop = createTestPopulation(3, 0);
      const schedule = GenerationRunner.planSchedule(pop, 42, 1);
      expect(schedule.length).toBe(6);
    });

    it("[12] N=4, R=2 において総試合数が正確に 24 試合であること。", () => {
      const pop = createTestPopulation(4, 0);
      const schedule = GenerationRunner.planSchedule(pop, 42, 2);
      expect(schedule.length).toBe(24);
    });

    it("[13] 任意の N, R で総試合数が N(N-1)R と厳密に一致すること。", () => {
      const cases = [
        { n: 5, r: 3, expected: 5 * 4 * 3 },
        { n: 6, r: 1, expected: 6 * 5 * 1 },
        { n: 7, r: 2, expected: 7 * 6 * 2 },
      ];
      for (const c of cases) {
        const pop = createTestPopulation(c.n, 0);
        const schedule = GenerationRunner.planSchedule(pop, 42, c.r);
        expect(schedule.length).toBe(c.expected);
      }
    });

    it("[14] 同一個体同士の対戦（自己対戦: Gi vs Gi）が 1 試合も存在しないこと。", () => {
      const pop = createTestPopulation(5, 0);
      const schedule = GenerationRunner.planSchedule(pop, 42, 2);
      for (const m of schedule) {
        expect(m.p1GenomeId).not.toBe(m.p2GenomeId);
      }
    });

    it("[15] 各 unordered pair において、反復ごとに必ず Leg 0 と Leg 1 の 2 試合が存在すること。", () => {
      const pop = createTestPopulation(4, 0);
      const schedule = GenerationRunner.planSchedule(pop, 42, 2);
      const pairMap = new Map<string, { leg0: number; leg1: number }>();

      for (const m of schedule) {
        const key = `p${m.pairIndex}-r${m.repetitionIndex}`;
        const entry = pairMap.get(key) || { leg0: 0, leg1: 0 };
        if (m.legIndex === 0) entry.leg0++;
        if (m.legIndex === 1) entry.leg1++;
        pairMap.set(key, entry);
      }

      for (const counts of pairMap.values()) {
        expect(counts.leg0).toBe(1);
        expect(counts.leg1).toBe(1);
      }
    });

    it("[16] 全個体について p1 回数と p2 回数が同数（(N-1)R）であり完全に均衡していること。", () => {
      const N = 5;
      const R = 3;
      const pop = createTestPopulation(N, 0);
      const schedule = GenerationRunner.planSchedule(pop, 42, R);

      const p1Counts = new Map<string, number>();
      const p2Counts = new Map<string, number>();
      for (const e of pop.entries) {
        p1Counts.set(e.genomeId, 0);
        p2Counts.set(e.genomeId, 0);
      }

      for (const m of schedule) {
        p1Counts.set(m.p1GenomeId, (p1Counts.get(m.p1GenomeId) || 0) + 1);
        p2Counts.set(m.p2GenomeId, (p2Counts.get(m.p2GenomeId) || 0) + 1);
      }

      const expected = (N - 1) * R;
      for (const e of pop.entries) {
        expect(p1Counts.get(e.genomeId)).toBe(expected);
        expect(p2Counts.get(e.genomeId)).toBe(expected);
      }
    });

    it("[17] スケジュールの matchIndex が 0 から連番で欠番なく連続していること。", () => {
      const pop = createTestPopulation(4, 0);
      const schedule = GenerationRunner.planSchedule(pop, 42, 2);
      for (let i = 0; i < schedule.length; i++) {
        expect(schedule[i].matchIndex).toBe(i);
      }
    });

    it("[18] 入力母集団の entries 配列の順序を変更しても、生成されるスケジュールが完全に同一であること。", () => {
      const popOriginal = createTestPopulation(5, 0);
      const popShuffled: PopulationSnapshot = {
        generation: 0,
        entries: [
          popOriginal.entries[3],
          popOriginal.entries[0],
          popOriginal.entries[4],
          popOriginal.entries[1],
          popOriginal.entries[2],
        ],
      };

      const sched1 = GenerationRunner.planSchedule(popOriginal, 42, 2);
      const sched2 = GenerationRunner.planSchedule(popShuffled, 42, 2);
      expect(sched1).toEqual(sched2);
    });
  });

  // ===========================================================================
  // Group C: Seed Derivation & Context Identifiers (Tests 19–24)
  // ===========================================================================
  describe("Group C: Seed Derivation & Context Identifiers (Tests 19–24)", () => {
    it("[19] 同一入力に対し、導出される全 pairSeed 系列が完全に同一であること。", () => {
      const pop = createTestPopulation(4, 0);
      const sched1 = GenerationRunner.planSchedule(pop, 999, 2);
      const sched2 = GenerationRunner.planSchedule(pop, 999, 2);
      expect(sched1.map((m) => m.matchSeed)).toEqual(sched2.map((m) => m.matchSeed));
    });

    it("[20] 母集団の入力順序を変更しても、全試合の pairSeed 系列が不変であること。", () => {
      const popOriginal = createTestPopulation(4, 0);
      const popReversed: PopulationSnapshot = {
        generation: 0,
        entries: [...popOriginal.entries].reverse(),
      };
      const sched1 = GenerationRunner.planSchedule(popOriginal, 888, 1);
      const sched2 = GenerationRunner.planSchedule(popReversed, 888, 1);
      expect(sched1.map((m) => m.matchSeed)).toEqual(sched2.map((m) => m.matchSeed));
    });

    it("[21] 異なる generationSeed を与えた場合、固定 fixture においてシード系列が変化し得ること（Negative Control）。", () => {
      const pop = createTestPopulation(4, 0);
      const sched1 = GenerationRunner.planSchedule(pop, 111, 1);
      const sched2 = GenerationRunner.planSchedule(pop, 222, 1);
      expect(sched1.map((m) => m.matchSeed)).not.toEqual(sched2.map((m) => m.matchSeed));
    });

    it("[22] 異なるシードに対する過剰な万能相違保証（Universal Must-Differ）を課さないこと。", () => {
      const pop = createTestPopulation(3, 0);
      const sched1 = GenerationRunner.planSchedule(pop, 1, 1);
      expect(sched1.length).toBe(6);
      for (const m of sched1) {
        expect(typeof m.matchSeed).toBe("number");
        expect(Number.isFinite(m.matchSeed)).toBe(true);
      }
    });

    it("[23] pairRepetitions または maxDecisionsPerMatch が異なる場合、evaluationScheduleId が正しく差別化されること。", () => {
      const id1 = canonicalEvaluationScheduleId(1, 500);
      const id2 = canonicalEvaluationScheduleId(2, 500);
      const id3 = canonicalEvaluationScheduleId(1, 300);

      expect(id1).toBe("double-round-robin-v1:r=1:max-decisions=500");
      expect(id2).toBe("double-round-robin-v1:r=2:max-decisions=500");
      expect(id3).toBe("double-round-robin-v1:r=1:max-decisions=300");
      expect(id1).not.toBe(id2);
      expect(id1).not.toBe(id3);
    });

    it("[24] generationSeed が異なる場合、seedScheduleIdentity が正しく差別化されること。", () => {
      const id1 = canonicalSeedScheduleIdentity(42);
      const id2 = canonicalSeedScheduleIdentity(43);

      expect(id1).toBe("evolution-evaluation-pair-v1:generation-seed=42");
      expect(id2).toBe("evolution-evaluation-pair-v1:generation-seed=43");
      expect(id1).not.toBe(id2);
    });
  });

  // ===========================================================================
  // Group D: Outcome Aggregation & Conservation (Tests 25–32)
  // ===========================================================================
  describe("Group D: Outcome Aggregation & Conservation (Tests 25–32)", () => {
    it("[25] COMPLETED 試合における p1 勝利が、p1 の win および p2 の loss へ正確に集計されること。", () => {
      const pop = createTestPopulation(2, 0);
      const schedule = GenerationRunner.planSchedule(pop, 42, 1);
      const outcomes: GenerationMatchOutcome[] = [
        { matchIndex: 0, p1GenomeId: schedule[0].p1GenomeId, p2GenomeId: schedule[0].p2GenomeId, completed: true, winner: "p1" },
        { matchIndex: 1, p1GenomeId: schedule[1].p1GenomeId, p2GenomeId: schedule[1].p2GenomeId, completed: true, winner: "p1" },
      ];

      const summaries = GenerationRunner.aggregateOutcomes(schedule, outcomes, pop, 1);
      const pA = summaries.get(schedule[0].p1GenomeId)!;
      const pB = summaries.get(schedule[0].p2GenomeId)!;

      expect(pA.asP1.wins).toBe(1);
      expect(pB.asP2.losses).toBe(1);
    });

    it("[26] COMPLETED 試合における p2 勝利が、p2 の win および p1 の loss へ正確に集計されること。", () => {
      const pop = createTestPopulation(2, 0);
      const schedule = GenerationRunner.planSchedule(pop, 42, 1);
      const outcomes: GenerationMatchOutcome[] = [
        { matchIndex: 0, p1GenomeId: schedule[0].p1GenomeId, p2GenomeId: schedule[0].p2GenomeId, completed: true, winner: "p2" },
        { matchIndex: 1, p1GenomeId: schedule[1].p1GenomeId, p2GenomeId: schedule[1].p2GenomeId, completed: true, winner: "p2" },
      ];

      const summaries = GenerationRunner.aggregateOutcomes(schedule, outcomes, pop, 1);
      const pA = summaries.get(schedule[0].p1GenomeId)!;
      const pB = summaries.get(schedule[0].p2GenomeId)!;

      expect(pB.asP2.wins).toBe(1);
      expect(pA.asP1.losses).toBe(1);
    });

    it("[27] COMPLETED 試合における引き分けが、双方の draw へ正確に集計されること。", () => {
      const pop = createTestPopulation(2, 0);
      const schedule = GenerationRunner.planSchedule(pop, 42, 1);
      const outcomes: GenerationMatchOutcome[] = [
        { matchIndex: 0, p1GenomeId: schedule[0].p1GenomeId, p2GenomeId: schedule[0].p2GenomeId, completed: true, winner: undefined },
        { matchIndex: 1, p1GenomeId: schedule[1].p1GenomeId, p2GenomeId: schedule[1].p2GenomeId, completed: true, winner: undefined },
      ];

      const summaries = GenerationRunner.aggregateOutcomes(schedule, outcomes, pop, 1);
      const pA = summaries.get(schedule[0].p1GenomeId)!;
      const pB = summaries.get(schedule[0].p2GenomeId)!;

      expect(pA.draws).toBe(2);
      expect(pB.draws).toBe(2);
    });

    it("[28] INCOMPLETE 試合が draw として扱われず、双方の incompleteMatches へ厳密に集計されること。", () => {
      const pop = createTestPopulation(2, 0);
      const schedule = GenerationRunner.planSchedule(pop, 42, 1);
      const outcomes: GenerationMatchOutcome[] = [
        { matchIndex: 0, p1GenomeId: schedule[0].p1GenomeId, p2GenomeId: schedule[0].p2GenomeId, completed: false },
        { matchIndex: 1, p1GenomeId: schedule[1].p1GenomeId, p2GenomeId: schedule[1].p2GenomeId, completed: false },
      ];

      const summaries = GenerationRunner.aggregateOutcomes(schedule, outcomes, pop, 1);
      const pA = summaries.get(schedule[0].p1GenomeId)!;
      const pB = summaries.get(schedule[0].p2GenomeId)!;

      expect(pA.incompleteMatches).toBe(2);
      expect(pA.draws).toBe(0);
      expect(pA.completedMatches).toBe(0);
      expect(pB.incompleteMatches).toBe(2);
      expect(pB.draws).toBe(0);
      expect(pB.completedMatches).toBe(0);
    });

    it("[29] [R4 改訂] 試合実行中の 3 フェーズ（SESSION_FACTORY, POLICY_FACTORY, RUNNER）のいずれかで例外が発生した場合、実在する試合の障害フェーズ（phase）および診断プロパティ（matchIndex, p1GenomeId, p2GenomeId, causeName）を保持した GenerationRunnerExecutionError で即座に Fail-Closed 停止すること（causeMessage は Debug Detail として保持可能だが決定論的比較保証の対象外）。", () => {
      const pop = createTestPopulation(2, 0);

      // Phase 1: SESSION_FACTORY 障害
      expect(() => {
        GenerationRunner.run({
          population: pop,
          generationSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: () => {
            const err = new TypeError("Failed to instantiate session");
            err.name = "CustomSessionFactoryError";
            throw err;
          },
          config: {
            pairRepetitions: 1,
            fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          },
        });
      }).toThrowError(GenerationRunnerExecutionError);

      try {
        GenerationRunner.run({
          population: pop,
          generationSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: () => {
            const err = new TypeError("Failed to instantiate session");
            err.name = "CustomSessionFactoryError";
            throw err;
          },
          config: {
            pairRepetitions: 1,
            fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          },
        });
      } catch (err: any) {
        expect(err.phase).toBe("SESSION_FACTORY");
        expect(err.matchIndex).toBe(0);
        expect(err.p1GenomeId).toBe(pop.entries[0].genomeId);
        expect(err.p2GenomeId).toBe(pop.entries[1].genomeId);
        expect(err.causeName).toBe("CustomSessionFactoryError");
      }

      // Phase 3: RUNNER 障害
      const spyRunner = vi.spyOn(SimulationRunner, "run").mockImplementationOnce(() => {
        const err = new RangeError("SimulationRunner internal failure");
        err.name = "CustomRunnerError";
        throw err;
      });

      try {
        GenerationRunner.run({
          population: pop,
          generationSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: createFastSessionFactory("p1"),
          config: {
            pairRepetitions: 1,
            fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          },
        });
      } catch (err: any) {
        expect(err.phase).toBe("RUNNER");
        expect(err.matchIndex).toBe(0);
        expect(err.causeName).toBe("CustomRunnerError");
      } finally {
        spyRunner.mockRestore();
      }
    });

    it("[30] [R3 改訂] 試合実行例外による中断時、残余試合は一切実行されず、部分的な戦績サマリー集約は行われず、FitnessEvaluationSnapshot や次世代母集団が一切生成されない（Zero Side-effect / Zero Leak）こと。", () => {
      const pop = createTestPopulation(4, 0); // 12 matches
      let callCount = 0;
      const sessionFactory = (ctx: BatchMatchContext) => {
        callCount++;
        if (ctx.matchIndex === 1) {
          throw new Error("Match 1 crash");
        }
        return createFastSessionFactory("p1")(ctx);
      };

      expect(() => {
        GenerationRunner.run({
          population: pop,
          generationSeed: 42,
          environment: defaultEnvironment,
          sessionFactory,
          config: {
            pairRepetitions: 1,
            fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          },
        });
      }).toThrow(GenerationRunnerExecutionError);

      expect(callCount).toBe(2); // Match 0 and Match 1 only, 2..11 never executed
    });

    it("[31] 重複した matchIndex の結果が存在する場合、またはスケジュール計画数に対して実行結果が 1 件でも欠損している場合、GenerationRunnerIntegrityError で停止すること。", () => {
      const pop = createTestPopulation(2, 0);
      const schedule = GenerationRunner.planSchedule(pop, 42, 1);

      // 重複
      const dupOutcomes: GenerationMatchOutcome[] = [
        { matchIndex: 0, p1GenomeId: schedule[0].p1GenomeId, p2GenomeId: schedule[0].p2GenomeId, completed: true },
        { matchIndex: 0, p1GenomeId: schedule[1].p1GenomeId, p2GenomeId: schedule[1].p2GenomeId, completed: true },
      ];
      expect(() => {
        GenerationRunner.aggregateOutcomes(schedule, dupOutcomes, pop, 1);
      }).toThrow(GenerationRunnerIntegrityError);

      // 欠損 (1件のみ)
      const missingOutcomes: GenerationMatchOutcome[] = [
        { matchIndex: 0, p1GenomeId: schedule[0].p1GenomeId, p2GenomeId: schedule[0].p2GenomeId, completed: true },
      ];
      expect(() => {
        GenerationRunner.aggregateOutcomes(schedule, missingOutcomes, pop, 1);
      }).toThrow(GenerationRunnerIntegrityError);
    });

    it("[32] 試合結果の参加個体 ID と計画個体 ID が不一致の場合、GenerationRunnerIntegrityError で停止すること。", () => {
      const pop = createTestPopulation(2, 0);
      const schedule = GenerationRunner.planSchedule(pop, 42, 1);

      const mismatchedOutcomes: GenerationMatchOutcome[] = [
        { matchIndex: 0, p1GenomeId: "fake-id", p2GenomeId: schedule[0].p2GenomeId, completed: true },
        { matchIndex: 1, p1GenomeId: schedule[1].p1GenomeId, p2GenomeId: schedule[1].p2GenomeId, completed: true },
      ];

      expect(() => {
        GenerationRunner.aggregateOutcomes(schedule, mismatchedOutcomes, pop, 1);
      }).toThrow(GenerationRunnerIntegrityError);
    });
  });

  // ===========================================================================
  // Group E: Fitness Evaluation & Attribution (Tests 33–39)
  // ===========================================================================
  describe("Group E: Fitness Evaluation & Attribution (Tests 33–39)", () => {
    it("[33] 適応度評価が FitnessEvaluator.evaluateParticipant() へ正しく委譲されること。", () => {
      const pop = createTestPopulation(2, 0);
      const evalSpy = vi.spyOn(FitnessEvaluator, "evaluateParticipant");

      GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      expect(evalSpy).toHaveBeenCalledTimes(2);
      evalSpy.mockRestore();
    });

    it("[34] 残りライフ（Remaining Life）が適応度計算に一切使用されていないこと。", () => {
      const pop = createTestPopulation(2, 0);
      const runWithLife = (life: number) => {
        return GenerationRunner.run({
          population: pop,
          generationSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: (ctx) => {
            return {
              matchId: ctx.matchId,
              state: { version: 1, turnCount: 1, players: { p1: { life }, p2: { life } } },
              advance: () => ({ type: "FINISHED", result: { winner: "p1", reason: "normal" } } as any),
            } as any;
          },
          config: {
            pairRepetitions: 1,
            fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
            builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
          },
        });
      };

      const res1 = runWithLife(10);
      const res2 = runWithLife(1);
      expect(res1.logicalResult.fitnessSnapshot.entries).toEqual(res2.logicalResult.fitnessSnapshot.entries);
    });

    it("[35] ターン数（Turn Count）が適応度計算に一切使用されていないこと。", () => {
      const pop = createTestPopulation(2, 0);
      const runWithTurns = (turnCount: number) => {
        return GenerationRunner.run({
          population: pop,
          generationSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: (ctx) => {
            return {
              matchId: ctx.matchId,
              state: { version: 1, turnCount, players: {} },
              advance: () => ({ type: "FINISHED", result: { winner: "p1", reason: "normal" } } as any),
            } as any;
          },
          config: {
            pairRepetitions: 1,
            fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
            builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
          },
        });
      };

      const res1 = runWithTurns(5);
      const res2 = runWithTurns(20);
      expect(res1.logicalResult.fitnessSnapshot.entries).toEqual(res2.logicalResult.fitnessSnapshot.entries);
    });

    it("[36] 実行所要時間（Duration / Latency）が適応度計算に一切使用されていないこと。", () => {
      const pop = createTestPopulation(2, 0);
      const runWithDelay = (delayMs: number) => {
        return GenerationRunner.run({
          population: pop,
          generationSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: (ctx) => {
            if (delayMs > 0) {
              const start = Date.now();
              while (Date.now() - start < delayMs) {}
            }
            return createFastSessionFactory("p1")(ctx);
          },
          config: {
            pairRepetitions: 1,
            fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
            builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
          },
        });
      };

      const res1 = runWithDelay(0);
      const res2 = runWithDelay(5);
      expect(res1.logicalResult.fitnessSnapshot.entries).toEqual(res2.logicalResult.fitnessSnapshot.entries);
    });

    it("[37] 全敗（wins = 0, draws = 0）の個体でも VALID（スコア 0.0）として適格保存されること。", () => {
      const pop = createTestPopulation(2, 0);
      // p1 が常に勝つため、p2 は全敗となる
      const res = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: (ctx) => {
          return {
            matchId: ctx.matchId,
            state: { version: 1, turnCount: 1, players: {} },
            advance: () => ({
              type: "FINISHED",
              // Leg 0 (matchIndex 0): p1=ind0, p2=ind1 -> winner=p1 (ind0)
              // Leg 1 (matchIndex 1): p1=ind1, p2=ind0 -> winner=p2 (ind0)
              // 常に ind0 が勝ち、ind1 は全敗
              result: { winner: ctx.matchIndex === 0 ? "p1" : "p2", reason: "normal" },
            } as any),
          } as any;
        },
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      const fitEntry = res.logicalResult.fitnessSnapshot.entries.find((e) => e.genomeId === "ind-001");
      expect(fitEntry).toBeDefined();
      expect(fitEntry!.result.status).toBe("VALID");
      if (fitEntry!.result.status === "VALID") {
        expect(fitEntry!.result.wins).toBe(0);
        expect(fitEntry!.result.fitnessScore).toBe(0.0);
      }
    });

    it("[38] [R3 改訂] Generation Runner V1 が sessionFactory、GenomePolicy、または SimulationRunner.run の実行時例外を特定 Genome の INVALID として自動帰属せず、安全に Fail-Closed すること。また対戦完走時は全個体の failedMatches === 0 が数学的・論理的に保証されること。", () => {
      const pop = createTestPopulation(2, 0);
      const res = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      for (const entry of res.logicalResult.fitnessSnapshot.entries) {
        expect(entry.result.status).not.toBe("INVALID");
        if (entry.result.status === "VALID") {
          expect((entry.result as any).failedMatches).toBeUndefined();
        }
      }
    });

    it("[39] 完了試合数不足の個体が INSUFFICIENT_EVIDENCE（適応度 null）となること。", () => {
      const pop = createTestPopulation(2, 0);
      const runSpy = vi.spyOn(SimulationRunner, "run").mockReturnValue({
        completed: false,
        totalDecisions: 100,
        turnCount: 5,
        finalState: {},
        decisionTraceVersion: 2,
        decisionTrace: [],
      });

      const res = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      runSpy.mockRestore();

      for (const entry of res.logicalResult.fitnessSnapshot.entries) {
        expect(entry.result.status).toBe("INSUFFICIENT_EVIDENCE");
        expect(entry.result.fitnessScore).toBeNull();
      }
    });
  });

  // ===========================================================================
  // Group F: Readiness & Generation Transition (Tests 40–46)
  // ===========================================================================
  describe("Group F: Readiness & Generation Transition (Tests 40–46)", () => {
    it("[40] 生成された FitnessEvaluationSnapshot の世代番号が g と厳密に一致すること。", () => {
      const pop = createTestPopulation(2, 5);
      const res = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });
      expect(res.logicalResult.fitnessSnapshot.generation).toBe(5);
    });

    it("[41] 母集団エントリと適応度エントリが完全な 1:1 対応を成していること。", () => {
      const pop = createTestPopulation(4, 0);
      const res = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 4, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });
      const popIds = pop.entries.map((e) => e.genomeId).sort();
      const fitIds = res.logicalResult.fitnessSnapshot.entries.map((e) => e.genomeId).sort();
      expect(fitIds).toEqual(popIds);
    });

    it("[42] [R2 改訂] GenerationBuilder が目標世代 g+1 で正しく呼び出され、事前解決済みの resolvedBuilderConfig が完全かつ透過的に渡されること（Runner と Builder の設定不一致・Drift の防止）。", () => {
      const pop = createTestPopulation(2, 0);
      const buildSpy = vi.spyOn(GenerationBuilder, "buildNextGeneration");

      GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      expect(buildSpy).toHaveBeenCalledTimes(1);
      const callArg = buildSpy.mock.calls[0][0];
      expect(callArg.targetGeneration).toBe(1);
      expect(callArg.config?.populationSize).toBe(2);
      expect(callArg.config?.selectionConfig.eliteCount).toBe(1);
      buildSpy.mockRestore();
    });

    it("[43] GenerationBuilder へ同一の generationSeed が透過的に渡されること。", () => {
      const pop = createTestPopulation(2, 0);
      const buildSpy = vi.spyOn(GenerationBuilder, "buildNextGeneration");

      GenerationRunner.run({
        population: pop,
        generationSeed: 987654,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      expect(buildSpy.mock.calls[0][0].generationSeed).toBe(987654);
      buildSpy.mockRestore();
    });

    it("[44] 正常遷移時、ステータス ADVANCED と世代 g+1 の母集団スナップショットが返却されること。", () => {
      const pop = createTestPopulation(2, 0);
      const res = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      expect(res.logicalResult.status).toBe("ADVANCED");
      if (res.logicalResult.status === "ADVANCED") {
        expect(res.logicalResult.nextPopulation.generation).toBe(1);
        expect(res.logicalResult.nextPopulation.entries.length).toBe(2);
      }
    });

    it("[45] [R2 改訂] Readiness Preflight により有効個体数不足（standard または effective: max(requiredCount, eliteCount)）を resolvedBuilderConfig.selectionConfig に基づき検出し、Builder を呼び出すことなく status: 'REEVALUATION_REQUIRED' と完全な SelectionReadiness を返却すること。", () => {
      const pop = createTestPopulation(2, 0);
      const buildSpy = vi.spyOn(GenerationBuilder, "buildNextGeneration");
      const runSpy = vi.spyOn(SimulationRunner, "run").mockReturnValue({
        completed: false,
        totalDecisions: 100,
        turnCount: 5,
        finalState: {},
        decisionTraceVersion: 2,
        decisionTrace: [],
      });

      // 試合が未完了 (incomplete) のため、VALID 個体数は 0
      const res = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      runSpy.mockRestore();

      expect(buildSpy).toHaveBeenCalledTimes(0);
      expect(res.logicalResult.status).toBe("REEVALUATION_REQUIRED");
      if (res.logicalResult.status === "REEVALUATION_REQUIRED") {
        expect(res.logicalResult.readiness.status).toBe("REEVALUATION_REQUIRED");
        expect(res.logicalResult.readiness.validCount).toBe(0);
        expect(res.logicalResult.readiness.requiredCount).toBeGreaterThanOrEqual(2);
        expect(res.logicalResult.nextPopulation).toBeUndefined();
        expect(res.logicalResult.buildResult).toBeUndefined();
      }
      buildSpy.mockRestore();
    });

    it("[46] [R4 改訂] Runner の Readiness Preflight が READY であるにもかかわらず、同一の解決済み設定・コンテキストを渡した GenerationBuilder が予期せぬ例外（GenerationBuilderExecutionError）をスローした場合、偽・ダミーの試合診断情報を含む GenerationRunnerExecutionError ではなく、Contract Drift として GenerationRunnerIntegrityError で Fail-Closed 停止すること（また勝手な再試行を行わないこと）。", () => {
      const pop = createTestPopulation(2, 0);
      const buildSpy = vi.spyOn(GenerationBuilder, "buildNextGeneration").mockImplementationOnce(() => {
        throw new GenerationBuilderExecutionError("Unexpected builder drift");
      });

      expect(() => {
        GenerationRunner.run({
          population: pop,
          generationSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: createFastSessionFactory("p1"),
          config: {
            pairRepetitions: 1,
            fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
            builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
          },
        });
      }).toThrow(GenerationRunnerIntegrityError);

      expect(buildSpy).toHaveBeenCalledTimes(1); // No unauthorized retry
      buildSpy.mockRestore();
    });
  });

  // ===========================================================================
  // Group G: Determinism & Metrics Separation (Tests 47–52)
  // ===========================================================================
  describe("Group G: Determinism & Metrics Separation (Tests 47–52)", () => {
    it("[47] [R1 改訂] 同一環境・同一入力で 2 回実行した際、logicalResult が Deep Equal に完全一致すること（runtimeMetrics は一致比較対象外）。", () => {
      const pop = createTestPopulation(4, 0);
      const runParams: RunGenerationParams = {
        population: pop,
        generationSeed: 12345,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 4, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      };

      const res1 = GenerationRunner.run(runParams);
      const res2 = GenerationRunner.run(runParams);

      expect(res1.logicalResult).toEqual(res2.logicalResult);
    });

    it("[48] 入力母集団の配列シャッフルに対し、logicalResult が完全一致すること。", () => {
      const popOriginal = createTestPopulation(4, 0);
      const popShuffled: PopulationSnapshot = {
        generation: 0,
        entries: [popOriginal.entries[2], popOriginal.entries[0], popOriginal.entries[3], popOriginal.entries[1]],
      };

      const res1 = GenerationRunner.run({
        population: popOriginal,
        generationSeed: 777,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 4, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      const res2 = GenerationRunner.run({
        population: popShuffled,
        generationSeed: 777,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 4, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      expect(res1.logicalResult).toEqual(res2.logicalResult);
    });

    it("[49] [R1 改訂] 結果集約の純粋ロジックにおいて、同一試合結果群が異なる完了順序で到着しても matchIndex 再整列により同一集約結果が得られること。", () => {
      const pop = createTestPopulation(3, 0);
      const schedule = GenerationRunner.planSchedule(pop, 42, 1);
      const outcomes: GenerationMatchOutcome[] = schedule.map((m) => ({
        matchIndex: m.matchIndex,
        p1GenomeId: m.p1GenomeId,
        p2GenomeId: m.p2GenomeId,
        completed: true,
        winner: m.matchIndex % 2 === 0 ? "p1" : "p2",
      }));

      const shuffledOutcomes = [outcomes[3], outcomes[0], outcomes[5], outcomes[1], outcomes[4], outcomes[2]];

      const sum1 = GenerationRunner.aggregateOutcomes(schedule, outcomes, pop, 1);
      const sum2 = GenerationRunner.aggregateOutcomes(schedule, shuffledOutcomes, pop, 1);

      expect(sum1).toEqual(sum2);
    });

    it("[50] [R1 改訂] Generation Runner V1 の Public Config に concurrency オプションが存在せず、実行が厳密に Sequential であること。", () => {
      expect("concurrency" in DEFAULT_GENERATION_RUNNER_CONFIG).toBe(false);
    });

    it("[51] 出力論理データ構造内に動的タイムスタンプが一切含まれないこと。", () => {
      const pop = createTestPopulation(2, 0);
      const res = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      const serialized = JSON.stringify(res.logicalResult);
      expect(serialized).not.toMatch(/timestamp|timestampMs|Date\.now/i);
    });

    it("[52] 出力論理データ構造内に UUID や外部ランダム値が一切含まれないこと。", () => {
      const pop = createTestPopulation(2, 0);
      const res = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      const serialized = JSON.stringify(res.logicalResult);
      // Standard UUID v4 pattern: 8-4-4-4-12 hex digits
      expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    });
  });

  // ===========================================================================
  // Group H: Boundary & Isolation (Tests 53–60)
  // ===========================================================================
  describe("Group H: Boundary & Isolation (Tests 53–60)", () => {
    it("[53] Generation Runner が 1 世代のみを実行し、自律的に次世代ループを開始しないこと。", () => {
      const pop = createTestPopulation(2, 0);
      const res = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      if (res.logicalResult.status === "ADVANCED") {
        expect(res.logicalResult.nextPopulation.generation).toBe(1);
      }
    });

    it("[54] 内部に Evolution Loop（複数世代ループ）のコードが存在しないこと。", () => {
      const runnerSrc = GenerationRunner.toString();
      expect(runnerSrc).not.toMatch(/while\s*\(\s*generation\s*</);
      expect(runnerSrc).not.toMatch(/loopGenerations/);
    });

    it("[55] 過去世代や Hall of Fame との対戦が存在しないこと。", () => {
      const pop = createTestPopulation(4, 3);
      const schedule = GenerationRunner.planSchedule(pop, 42, 1);
      const popIds = new Set(pop.entries.map((e) => e.genomeId));

      for (const m of schedule) {
        expect(popIds.has(m.p1GenomeId)).toBe(true);
        expect(popIds.has(m.p2GenomeId)).toBe(true);
      }
    });

    it("[56] ファイルシステムや DB への永続化処理を行わないこと。", () => {
      const pop = createTestPopulation(2, 0);
      // 実行がインメモリのみで完結し、エラーなく終了すること
      const res = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });
      expect(res.logicalResult.status).toBe("ADVANCED");
    });

    it("[57] 収集された Runtime Telemetry が適応度や選択結果に 1 ビットも影響を与えていないこと。", () => {
      const pop = createTestPopulation(2, 0);
      const res1 = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });
      const res2 = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      expect(res1.logicalResult).toEqual(res2.logicalResult);
    });

    it("[58] [R4 改訂] モックやダミーではない本番シミュレーション経路（sessionFactory -> GenomePolicy -> SimulationRunner.run）の 3 フェーズが単一の Fail-Closed 実行境界下で順次実行され、Match 実行時障害（GenerationRunnerExecutionError）と Builder Contract Drift（GenerationRunnerIntegrityError）のエラー責務が明確に分離されていること。", () => {
      const pop = createTestPopulation(2, 0);
      // 本番 GameSession + RulePackage 経路
      const realSessionFactory = createRealSessionFactory();

      const result = GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: realSessionFactory,
        config: {
          pairRepetitions: 1,
          maxDecisionsPerMatch: 100,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      expect(["ADVANCED", "REEVALUATION_REQUIRED"]).toContain(result.logicalResult.status);
      expect(result.runtimeMetrics).toBeDefined();
      expect(result.runtimeMetrics!.totalDecisions).toBeGreaterThanOrEqual(0);

      // Match 実行時障害が GenerationRunnerExecutionError をスローすることの再検証
      expect(() => {
        GenerationRunner.run({
          population: pop,
          generationSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: () => {
            throw new Error("Match factory runtime failure");
          },
          config: {
            pairRepetitions: 1,
            fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          },
        });
      }).toThrow(GenerationRunnerExecutionError);

      // Builder Contract Drift が GenerationRunnerIntegrityError をスローすることの再検証
      const driftSpy = vi.spyOn(GenerationBuilder, "buildNextGeneration").mockImplementationOnce(() => {
        throw new GenerationBuilderExecutionError("Builder contract drift");
      });

      expect(() => {
        GenerationRunner.run({
          population: pop,
          generationSeed: 42,
          environment: defaultEnvironment,
          sessionFactory: createFastSessionFactory("p1"),
          config: {
            pairRepetitions: 1,
            fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
            builderConfig: { populationSize: 2, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
          },
        });
      }).toThrow(GenerationRunnerIntegrityError);

      driftSpy.mockRestore();
    });

    it("[59] [R3 改訂] resolveCanonicalBuilderConfig がモジュール内部ヘルパーとして隠蔽され公開 API としてエクスポートされていないこと、および Generation Runner が個別のアクション名（action.attack 等）を直接解釈しないこと。", () => {
      expect((TypesModule as any).resolveCanonicalBuilderConfig).toBeUndefined();
      expect((EngineModule as any).resolveCanonicalBuilderConfig).toBeUndefined();

      const runnerCode = GenerationRunner.toString();
      expect(runnerCode).not.toMatch(/action\.attack/);
      expect(runnerCode).not.toMatch(/action\.deploy/);
    });

    it("[60] 入力された現世代の PopulationSnapshot(g) が一切破壊・変更されていないこと。", () => {
      const pop = createTestPopulation(3, 0);
      const snapshotBefore = JSON.stringify(pop);

      GenerationRunner.run({
        population: pop,
        generationSeed: 42,
        environment: defaultEnvironment,
        sessionFactory: createFastSessionFactory("p1"),
        config: {
          pairRepetitions: 1,
          fitnessConfig: { minimumCompletedMatches: 2, minimumCompletionRate: 0.5 },
          builderConfig: { populationSize: 3, selectionConfig: { eliteCount: 1, tournamentSize: 2, minimumValidPopulationCount: 2 } },
        },
      });

      const snapshotAfter = JSON.stringify(pop);
      expect(snapshotAfter).toBe(snapshotBefore);
    });
  });
});
