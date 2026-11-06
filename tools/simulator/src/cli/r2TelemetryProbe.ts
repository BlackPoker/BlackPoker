/**
 * Work 4-1 R2: 監査・ZIP作成・concurrency 1/2 の実測プローブ (原本は読み取り専用、ZIPは一時ディレクトリへ出力)
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  auditMillionMatchArtifacts,
  packageMillionMatchZip,
  loadOfficialChampionsStrict,
  createStandardMatchupsAndResolver,
  WORK4_WORK_ID,
} from "./largeScaleSimulationRunner";
import { MillionMatchCampaignEngine } from "../engine/simulation/MillionMatchCampaignEngine";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../engine/rules/RulePackageSelector";
import { prepareOfficialSessionFactory } from "./stage3EvolutionRunner";

async function main() {
  const out: any = { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, totalMemBytes: os.totalmem() };
  const champions = loadOfficialChampionsStrict();
  out.authenticity = champions.authenticityRecord;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bp-r2-probe-"));
  for (const [name, dir] of [
    ["A", ".artifacts/work4-stage-a-1k"],
    ["B", ".artifacts/work4-stage-b-10k"],
  ] as const) {
    const a = auditMillionMatchArtifacts(dir);
    const z = packageMillionMatchZip(dir, path.join(tmp, `${name}.zip`));
    out[`stage${name}`] = {
      auditValid: a.isValid,
      auditErrors: a.errors.slice(0, 3),
      auditMs: a.auditElapsedMs,
      auditHeapDelta: a.auditHeapDeltaBytes,
      auditPeakHeap: a.auditPeakHeapBytes,
      zipMs: z.elapsedMs,
      zipBytes: z.zipSizeBytes,
      rawBytes: z.uncompressedTotalBytes,
      rssBase: z.baselineRssBytes,
      rssPeak: z.peakRssBytes,
    };
  }
  const pkg = getPlaytestRulePackage(await loadRulePackageFromDirectory(path.resolve("src/data/rules-vnext")));
  const sessionFactory = await prepareOfficialSessionFactory("standard-pack");
  const { matchups, championAuthenticity, policyResolver } = createStandardMatchupsAndResolver(champions);
  out.concurrency = {};
  for (const c of [1, 2] as const) {
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    const r = await MillionMatchCampaignEngine.runCampaign({
      workId: WORK4_WORK_ID,
      campaignId: "r2-probe",
      purpose: "QUALITY_AUDIT",
      stage: "CUSTOM_PILOT",
      executionMode: "BENCHMARK",
      totalPlannedMatches: 40,
      campaignSeed: 20261106,
      regulationId: "standard-pack",
      frameId: "pack",
      rulePackageVersion: "1.0.0",
      featureSchemaVersion: 6,
      rulePackage: pkg,
      matchups,
      championAuthenticity,
      policyResolver,
      sessionFactory,
      outputDir: path.join(tmp, `c${c}`),
      maxDecisionsPerMatch: 500,
      chunkSizeMatches: 40,
      maxConcurrency: c,
      gitCommitSha: "probe",
      isGitClean: false,
    });
    const wall = performance.now() - t0;
    const cpu = process.cpuUsage(cpu0);
    out.concurrency[c] = {
      wallMs: wall,
      cpuMs: (cpu.user + cpu.system) / 1000,
      cpuCoresUsed: (cpu.user + cpu.system) / 1000 / wall,
      mps: 40 / (wall / 1000),
      digest: r.evidence.logicalResultDigest,
    };
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(os.tmpdir(), "r2-probe.json"), JSON.stringify(out, null, 2));
  console.log("PROBE_DONE");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
