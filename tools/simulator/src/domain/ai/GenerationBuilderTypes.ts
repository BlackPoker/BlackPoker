import {
  ComparableEvaluationContext,
  DEFAULT_POPULATION_SELECTION_CONFIG,
  FitnessEvaluationSnapshot,
  PopulationSelectionConfig,
  PopulationSnapshot,
  SelectionReadinessStatus,
} from "./PopulationSelectionTypes.js";
import {
  DEFAULT_GENETIC_OPERATOR_CONFIG,
  GeneticOperatorConfig,
  OffspringLineageMetadata,
} from "./GeneticOperatorTypes.js";

export interface GenerationBuilderConfig {
  readonly populationSize: number;
  readonly selectionConfig: PopulationSelectionConfig;
  readonly geneticOperatorConfig: GeneticOperatorConfig;
}

export const DEFAULT_GENERATION_BUILDER_CONFIG: GenerationBuilderConfig = Object.freeze({
  populationSize: 100,
  selectionConfig: DEFAULT_POPULATION_SELECTION_CONFIG,
  geneticOperatorConfig: DEFAULT_GENETIC_OPERATOR_CONFIG,
});

export interface BuildNextGenerationParams {
  readonly population: PopulationSnapshot;
  readonly fitnessSnapshot: FitnessEvaluationSnapshot;
  readonly targetGeneration: number;
  readonly generationSeed: number;
  readonly config?: Partial<GenerationBuilderConfig>;
  readonly expectedContext?: ComparableEvaluationContext;
}

export interface GenerationBuildResult {
  readonly population: PopulationSnapshot;
  readonly sourceGeneration: number;
  readonly targetGeneration: number;
  readonly generationSeed: number;
  readonly selectionSeed: number;
  readonly populationSize: number;
  readonly eliteCount: number;
  readonly offspringCount: number;
  readonly eliteGenomeIds: readonly string[];
  readonly offspringLineages: readonly OffspringLineageMetadata[];
}

export class GenerationBuilderConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GenerationBuilderConfigurationError";
  }
}

export class GenerationBuilderIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GenerationBuilderIntegrityError";
  }
}

export class GenerationBuilderExecutionError extends Error {
  public readonly readinessStatus?: SelectionReadinessStatus;

  public constructor(message: string, readinessStatus?: SelectionReadinessStatus) {
    super(message);
    this.name = "GenerationBuilderExecutionError";
    this.readinessStatus = readinessStatus;
  }
}

export function canonicalOffspringDnaRef(genomeId: string): string {
  return `genome:${genomeId}`;
}
