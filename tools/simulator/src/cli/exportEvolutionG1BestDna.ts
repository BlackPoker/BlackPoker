import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { fileURLToPath } from "url";

import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../engine/regulation/RegulationRulePackageSelector";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { OfficialRegulationMatchFactory } from "../engine/regulation/OfficialRegulationMatchFactory";
import { deriveSeed } from "../engine/random/DeterministicShuffle";

import { GenerationRunner } from "../engine/ai/GenerationRunner";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec";
import { DecisionDNA } from "../domain/ai/DecisionDNATypes";
import { FEATURE_SCHEMA_VERSION } from "../domain/ai/DecisionFeatureTypes";
import { PopulationSnapshot } from "../domain/ai/PopulationSelectionTypes";
import {
  GenerationRunnerEnvironmentContext,
  RunGenerationParams,
} from "../domain/ai/GenerationRunnerTypes";
import { canonicalGenerationStreamKey } from "../domain/ai/EvolutionLoopTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXPECTED_GENOME_ID = "gen-000001-offspring-000003";
const EXPECTED_FULL_DIGEST = "e5f69e36c3dac0f4700d6013d92a5471009f1b185078ebf168e082193c14502b";
const EXPECTED_PATTERN_DIGEST = "7299c74dfe2518640dbdc271c21a1a687bcc21c915430cf82217e476594cd5c8";
const EXPECTED_CONTEXT_PATTERN_DIGEST = "e7dac493883cfecc0bd777d04bb54e353f8112e244db77557a0267351f29b950";

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function computeDnaWeightsDigest(dna: DecisionDNA): {
  totalWeights: number;
  patternWeightsDigest: string;
  contextPatternWeightsDigest: string;
  fullDnaDigest: string;
} {
  const pDigest = sha256(JSON.stringify(dna.patternWeights));
  const cpDigest = sha256(JSON.stringify(dna.contextPatternWeights));
  const fullDigest = sha256(
    JSON.stringify({
      dnaFormatVersion: dna.dnaFormatVersion,
      featureSchemaVersion: dna.featureSchemaVersion,
      scoringModel: dna.scoringModel,
      contextDimension: dna.contextDimension,
      patternDimension: dna.patternDimension,
      patternWeights: dna.patternWeights,
      contextPatternWeights: dna.contextPatternWeights,
    })
  );
  return {
    totalWeights: dna.patternWeights.length + dna.contextPatternWeights.length,
    patternWeightsDigest: pDigest,
    contextPatternWeightsDigest: cpDigest,
    fullDnaDigest: fullDigest,
  };
}

async function main() {
  console.log("=== Reconstructing Evolution g1 Best Genome DNA ===");

  const catalog = await loadRegulationCatalog();
  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

  const lightValidation = RegulationValidator.validateRegulation(catalog, "light-entry16", { assertImplemented: true });
  const lightRulePackage = RegulationRulePackageSelector.selectRulePackage(
    fullRulePackage,
    lightValidation.format!,
    lightValidation.regulation!,
    lightValidation.frame!
  );
  const lightSessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory("light-entry16", {
    catalog,
    fullRulePackage,
  });

  const CAMPAIGN_SEED = 42;
  const INITIAL_GENOME_IDS = ["genome-000", "genome-001", "genome-002", "genome-003", "genome-004", "genome-005"];

  const popA_g0: PopulationSnapshot = Object.freeze({
    generation: 0,
    entries: Object.freeze(
      INITIAL_GENOME_IDS.map((genomeId) =>
        Object.freeze({
          genomeId,
          dnaRef: `genome:${genomeId}`,
          generation: 0,
          dna: DecisionDNACodec.createZeroDecisionDNA({ id: genomeId }),
        })
      )
    ),
  });

  const environment: GenerationRunnerEnvironmentContext = Object.freeze({
    environmentRef: `official:${lightValidation.regulation!.id}`,
    regulationId: lightValidation.regulation!.id,
    frameId: lightValidation.frame!.id,
    rulePackageVersion: lightRulePackage.version,
  });

  const g0Seed = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(0));
  const g1Seed = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(1));

  console.log(`Campaign Seed: ${CAMPAIGN_SEED}, g0 Seed: ${g0Seed}, g1 Seed: ${g1Seed}`);
  console.log("Running Generation 0 to produce Generation 1 population...");

  const runParamsA_g0: RunGenerationParams = {
    population: popA_g0,
    generationSeed: g0Seed,
    environment,
    sessionFactory: lightSessionFactory,
    config: {
      pairRepetitions: 1,
      maxDecisionsPerMatch: 500,
      builderConfig: { populationSize: 6 },
    },
  };

  const g0Result = GenerationRunner.run(runParamsA_g0);
  if (g0Result.logicalResult.status !== "ADVANCED") {
    throw new Error(`g0 failed to advance: status=${g0Result.logicalResult.status}`);
  }

  const pop_g1 = g0Result.logicalResult.nextPopulation;
  console.log(`Generation 1 population generated with ${pop_g1.entries.length} genomes.`);

  const targetEntry = pop_g1.entries.find((e) => e.genomeId === EXPECTED_GENOME_ID);
  if (!targetEntry) {
    throw new Error(
      `BLOCKED: Target genome ID '${EXPECTED_GENOME_ID}' not found in g1 population entries: ${pop_g1.entries.map((e) => e.genomeId).join(", ")}`
    );
  }

  const dna = targetEntry.dna;

  console.log("\nValidating DNA structure...");
  DecisionDNACodec.validate(dna);
  console.log("  - DecisionDNACodec.validate() passed.");

  if (dna.patternWeights.length !== 143) {
    throw new Error(`Invalid patternWeights length: expected 143, got ${dna.patternWeights.length}`);
  }
  if (dna.contextPatternWeights.length !== 23595) {
    throw new Error(`Invalid contextPatternWeights length: expected 23595, got ${dna.contextPatternWeights.length}`);
  }
  if (dna.featureSchemaVersion !== FEATURE_SCHEMA_VERSION || dna.featureSchemaVersion !== 6) {
    throw new Error(`Invalid featureSchemaVersion: expected 6, got ${dna.featureSchemaVersion}`);
  }
  if (dna.dnaFormatVersion !== 1) {
    throw new Error(`Invalid dnaFormatVersion: expected 1, got ${dna.dnaFormatVersion}`);
  }

  const digests = computeDnaWeightsDigest(dna);
  console.log(`  - Pattern Weights Digest:         ${digests.patternWeightsDigest}`);
  console.log(`  - Context-Pattern Weights Digest: ${digests.contextPatternWeightsDigest}`);
  console.log(`  - Full DNA Digest:                ${digests.fullDnaDigest}`);

  if (digests.patternWeightsDigest !== EXPECTED_PATTERN_DIGEST) {
    throw new Error(`BLOCKED: Pattern weights digest mismatch! Expected ${EXPECTED_PATTERN_DIGEST}, got ${digests.patternWeightsDigest}`);
  }
  if (digests.contextPatternWeightsDigest !== EXPECTED_CONTEXT_PATTERN_DIGEST) {
    throw new Error(`BLOCKED: Context-Pattern weights digest mismatch! Expected ${EXPECTED_CONTEXT_PATTERN_DIGEST}, got ${digests.contextPatternWeightsDigest}`);
  }
  if (digests.fullDnaDigest !== EXPECTED_FULL_DIGEST) {
    throw new Error(`BLOCKED: Full DNA digest mismatch! Expected ${EXPECTED_FULL_DIGEST}, got ${digests.fullDnaDigest}`);
  }

  console.log("All digests strictly match R1 Evidence!");

  // Build clean DecisionDNA JSON artifact with metadata
  const dnaArtifact: DecisionDNA = {
    dnaFormatVersion: dna.dnaFormatVersion,
    featureSchemaVersion: dna.featureSchemaVersion,
    scoringModel: dna.scoringModel,
    contextDimension: dna.contextDimension,
    patternDimension: dna.patternDimension,
    patternWeights: dna.patternWeights,
    contextPatternWeights: dna.contextPatternWeights,
    metadata: {
      id: EXPECTED_GENOME_ID,
      name: "Evolution g1 Best (Experimental)",
      description: "進化学習で生成されたGenome AI。Baseline内で9勝1敗。対人戦の強さは未検証です。",
      generation: 1,
      fitness: 0.9,
      author: "EvolutionLoop-v92-v6",
      sourceWorkId: "BP-SIM-AI-V92-V6-EVOLUTION-BASELINE-V1-R1",
      fullDnaDigest: EXPECTED_FULL_DIGEST,
    },
  };

  // Build companion Manifest JSON artifact
  const manifestArtifact = {
    genomeId: EXPECTED_GENOME_ID,
    generation: 1,
    sourceWorkId: "BP-SIM-AI-V92-V6-EVOLUTION-BASELINE-V1-R1",
    sourceCommitSha: "f55697183ce66170d2a661adcece153d03ea29b1",
    featureSchemaVersion: 6,
    dnaFormatVersion: 1,
    scoringModel: dna.scoringModel,
    fullDnaDigest: EXPECTED_FULL_DIGEST,
    patternWeightsDigest: EXPECTED_PATTERN_DIGEST,
    contextPatternWeightsDigest: EXPECTED_CONTEXT_PATTERN_DIGEST,
    patternDimension: 143,
    contextDimension: 165,
    totalWeights: 23738,
    baselineRecord: {
      wins: 9,
      losses: 1,
      draws: 0,
      completedMatches: 10,
      scheduledMatches: 10,
      fitnessScore: 0.9,
      completionRate: 1.0,
    },
    generationParameters: {
      campaignSeed: CAMPAIGN_SEED,
      g0GenerationSeed: g0Seed,
      g1GenerationSeed: g1Seed,
      populationSize: 6,
      pairRepetitions: 1,
      maxDecisionsPerMatch: 500,
      regulation: "light-entry16",
    },
    dnaArtifactFile: "evolution-g1-best-v6.json",
  };

  const outputDir = path.resolve(__dirname, "../data/ai");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const dnaPath = path.join(outputDir, "evolution-g1-best-v6.json");
  const manifestPath = path.join(outputDir, "evolution-g1-best-v6.manifest.json");

  fs.writeFileSync(dnaPath, JSON.stringify(dnaArtifact, null, 2), "utf8");
  console.log(`Saved DNA artifact to: ${dnaPath}`);

  fs.writeFileSync(manifestPath, JSON.stringify(manifestArtifact, null, 2), "utf8");
  console.log(`Saved Manifest artifact to: ${manifestPath}`);

  // Re-read and re-verify saved files
  const readDna = JSON.parse(fs.readFileSync(dnaPath, "utf8"));
  DecisionDNACodec.validate(readDna);
  const reDigests = computeDnaWeightsDigest(readDna);
  if (reDigests.fullDnaDigest !== EXPECTED_FULL_DIGEST) {
    throw new Error(`Integrity check failed after saving DNA artifact: digest mismatch!`);
  }
  console.log("Post-save artifact roundtrip verification SUCCESS!");
}

main().catch((err) => {
  console.error("FATAL ERROR in exportEvolutionG1BestDna:", err);
  process.exit(1);
});
