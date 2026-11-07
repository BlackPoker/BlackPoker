import { describe, it, expect } from "vitest";
import {
  loadAndValidateGen8ChampionCandidateDNA,
  createGen8ChampionCandidatePolicy,
  computeGen8DnaDigest,
  GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST,
  GEN8_CHAMPION_CANDIDATE_TOTAL_WEIGHTS,
  GEN8_CHAMPION_CANDIDATE_PATTERN_WEIGHTS_COUNT,
  GEN8_CHAMPION_CANDIDATE_CONTEXT_PATTERN_WEIGHTS_COUNT,
  GEN8_CHAMPION_CANDIDATE_FEATURE_SCHEMA_VERSION,
  GEN8_CHAMPION_CANDIDATE_DNA_FORMAT_VERSION,
  GEN8_CHAMPION_CANDIDATE_SUPPORTED_REGULATION_ID,
} from "../../engine/ai/Gen8DNALoader";

describe("Gen8DNALoader", () => {
  it("should successfully load and validate the official Gen 8 candidate DNA", () => {
    const dna = loadAndValidateGen8ChampionCandidateDNA();
    expect(dna).toBeDefined();
    expect(dna.dnaFormatVersion).toBe(GEN8_CHAMPION_CANDIDATE_DNA_FORMAT_VERSION);
    expect(dna.featureSchemaVersion).toBe(GEN8_CHAMPION_CANDIDATE_FEATURE_SCHEMA_VERSION);
    expect(dna.patternWeights.length).toBe(GEN8_CHAMPION_CANDIDATE_PATTERN_WEIGHTS_COUNT);
    expect(dna.contextPatternWeights.length).toBe(GEN8_CHAMPION_CANDIDATE_CONTEXT_PATTERN_WEIGHTS_COUNT);
    expect(dna.patternWeights.length + dna.contextPatternWeights.length).toBe(
      GEN8_CHAMPION_CANDIDATE_TOTAL_WEIGHTS
    );

    const digest = computeGen8DnaDigest(dna);
    expect(digest).toBe(GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST);
  });

  it("should create a valid GenomePolicy instance for Gen 8 candidate", () => {
    const policy = createGen8ChampionCandidatePolicy();
    expect(policy).toBeDefined();
    expect(policy.descriptor.name).toBe("Gen 8 Champion Candidate");
    expect(policy.descriptor.kind).toBe("genome");
  });

  it("should fail-closed when DNA weights are tampered with (digest mismatch)", () => {
    const officialDna = loadAndValidateGen8ChampionCandidateDNA();
    const tampered = JSON.parse(JSON.stringify(officialDna));
    tampered.patternWeights[0] += 0.001;

    expect(() => loadAndValidateGen8ChampionCandidateDNA(tampered)).toThrowError(
      /Gen 8 DNA digest mismatch/
    );
  });

  it("should fail-closed when dnaFormatVersion is invalid", () => {
    const officialDna = loadAndValidateGen8ChampionCandidateDNA();
    const invalid = JSON.parse(JSON.stringify(officialDna));
    invalid.dnaFormatVersion = 999;

    expect(() => loadAndValidateGen8ChampionCandidateDNA(invalid)).toThrowError(
      /dnaFormatVersion/
    );
  });

  it("should fail-closed when featureSchemaVersion is invalid", () => {
    const officialDna = loadAndValidateGen8ChampionCandidateDNA();
    const invalid = JSON.parse(JSON.stringify(officialDna));
    invalid.featureSchemaVersion = 5;

    expect(() => loadAndValidateGen8ChampionCandidateDNA(invalid)).toThrowError(
      /featureSchemaVersion/
    );
  });

  it("should fail-closed when patternWeights length is invalid", () => {
    const officialDna = loadAndValidateGen8ChampionCandidateDNA();
    const invalid = JSON.parse(JSON.stringify(officialDna));
    invalid.patternWeights.pop();

    expect(() => loadAndValidateGen8ChampionCandidateDNA(invalid)).toThrowError(
      /patternWeights/
    );
  });

  it("should fail-closed when contextPatternWeights length is invalid", () => {
    const officialDna = loadAndValidateGen8ChampionCandidateDNA();
    const invalid = JSON.parse(JSON.stringify(officialDna));
    invalid.contextPatternWeights.push(0);

    expect(() => loadAndValidateGen8ChampionCandidateDNA(invalid)).toThrowError(
      /contextPatternWeights/
    );
  });

  it("should fail-closed when invalid object is provided", () => {
    expect(() => loadAndValidateGen8ChampionCandidateDNA(null)).toThrowError();
    expect(() => loadAndValidateGen8ChampionCandidateDNA({})).toThrowError();
  });
});
