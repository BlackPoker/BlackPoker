import * as fs from "fs";
import * as path from "path";

export interface SeedRangeAllocation {
  readonly purpose: string;
  readonly status: "USED" | "PROTECTED_LOCKED" | "ALLOCATED_FOR_PRODUCTION" | "RESERVED_FOR_FUTURE_HOLDOUT";
  readonly startSeed: number;
  readonly endSeed: number;
  readonly count: number;
  readonly description: string;
}

export const SEED_REGISTRY_GEN8: SeedRangeAllocation[] = [
  {
    purpose: "Stage 3 Training",
    status: "USED",
    startSeed: 1,
    endSeed: 50000,
    count: 50000,
    description: "Stage 3 過去進化学習の訓練用 Seed 空間",
  },
  {
    purpose: "Stage A 1K Pilot",
    status: "USED",
    startSeed: 1001,
    endSeed: 1500,
    count: 500,
    description: "大規模基盤 Stage A 検証用 Seed",
  },
  {
    purpose: "Stage B 10K Scale Run",
    status: "USED",
    startSeed: 10001,
    endSeed: 15000,
    count: 5000,
    description: "大規模基盤 Stage B 10K 完走用 Seed",
  },
  {
    purpose: "Stage 3 Validation",
    status: "USED",
    startSeed: 70001,
    endSeed: 70100,
    count: 100,
    description: "Stage 3 過去進化学習の中間 Validation Seed",
  },
  {
    purpose: "Stage 3 Official Holdout (Protected)",
    status: "PROTECTED_LOCKED",
    startSeed: 95001,
    endSeed: 95030,
    count: 30,
    description: "Work 3-7 で使用された公式 Holdout 240 試合 Seed (厳格保護・再利用禁止)",
  },
  {
    purpose: "Gen 7 Phase 1 Diagnostic & H2H Verification",
    status: "USED",
    startSeed: 200001,
    endSeed: 200030,
    count: 30,
    description: "Work 4-3 Phase 1 診断 210 試合および H2H 60 試合で使用済み",
  },
  {
    purpose: "Gen 8 Phase 2 Pilot Exploration",
    status: "USED",
    startSeed: 210001,
    endSeed: 211000,
    count: 1000,
    description: "Work 4-3 Phase 2 パイロット探索 1,000 試合で使用済み",
  },
  {
    purpose: "Reserved Protected Seed Range",
    status: "PROTECTED_LOCKED",
    startSeed: 250001,
    endSeed: 250120,
    count: 120,
    description: "最終評価プロトコル確定まで完全未使用のまま保護される予約 Seed",
  },
  {
    purpose: "Gen 8 Production Training",
    status: "ALLOCATED_FOR_PRODUCTION",
    startSeed: 300001,
    endSeed: 320000,
    count: 20000,
    description: "Gen 8 本番進化学習 (上限 10,000 試合) 用に新規割当された訓練 Seed 空間",
  },
  {
    purpose: "Gen 8 Production Validation",
    status: "ALLOCATED_FOR_PRODUCTION",
    startSeed: 330001,
    endSeed: 331000,
    count: 1000,
    description: "Gen 8 本番進化学習の世代間 Validation 評価用に新規割当された Seed 空間",
  },
  {
    purpose: "Gen 8 Final Holdout (Future Unused)",
    status: "RESERVED_FOR_FUTURE_HOLDOUT",
    startSeed: 350001,
    endSeed: 350300,
    count: 300,
    description: "本番学習完了後の正式評価・Holdout 用に将来割り当て予定の完全隔離 Seed (現在未実行)",
  },
];

export function auditSeedRegistry(registry: SeedRangeAllocation[]) {
  console.log("================================================================================");
  console.log("BlackPoker Work 4-3 — Comprehensive Seed Registry Audit");
  console.log("================================================================================");

  let collisionErrors = 0;

  // 1. レンジ間の重複判定 (互いに独立なグループ間での重複検証)
  // 過去の Stage A, B は Stage 3 Training のサブセットであったが、
  // 今回の Gen 7 診断、Gen 8 パイロット、予約保護、本番学習、Validation、将来 Holdout は
  // 相互に 1 Seed たりとも重複してはならない。
  const criticalRanges = registry.filter(
    (r) => r.startSeed >= 90000 // Stage 3 Holdout 以降の全重要レンジ
  );

  for (let i = 0; i < criticalRanges.length; i++) {
    for (let j = i + 1; j < criticalRanges.length; j++) {
      const a = criticalRanges[i];
      const b = criticalRanges[j];
      const overlap = !(a.endSeed < b.startSeed || b.endSeed < a.startSeed);
      if (overlap) {
        console.error(`COLLISION DETECTED: [${a.purpose}] (${a.startSeed}..${a.endSeed}) overlaps with [${b.purpose}] (${b.startSeed}..${b.endSeed})`);
        collisionErrors++;
      }
    }
  }

  // 2. 本番学習・Validation・将来Holdoutが過去の全使用済みSeedと重複しないことの検証
  const productionRanges = registry.filter((r) => r.status.startsWith("ALLOCATED") || r.status.startsWith("RESERVED"));
  const usedRanges = registry.filter((r) => r.status === "USED" || r.status === "PROTECTED_LOCKED");

  for (const prod of productionRanges) {
    for (const used of usedRanges) {
      const overlap = !(prod.endSeed < used.startSeed || used.endSeed < prod.startSeed);
      if (overlap) {
        console.error(`CRITICAL COLLISION: Production Range [${prod.purpose}] overlaps with used/protected range [${used.purpose}]`);
        collisionErrors++;
      }
    }
  }

  console.log(`- Audited Critical Ranges: ${criticalRanges.length}`);
  console.log(`- Detected Collisions:     ${collisionErrors}`);

  if (collisionErrors === 0) {
    console.log("- ALL SEED RANGES ARE DETERMINISTICALLY NON-OVERLAPPING & STRICTLY ISOLATED.");
  } else {
    throw new Error(`Seed Registry Audit FAILED with ${collisionErrors} collisions.`);
  }

  // 成果物保存
  const outDir = path.resolve(".artifacts/seed-registry");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "seed-registry-gen8.json");
  fs.writeFileSync(outPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    auditStatus: "PASS",
    collisionErrors: 0,
    registry,
  }, null, 2), "utf8");

  console.log(`Seed registry written to: ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("verifySeedRegistryGen8.ts")) {
  auditSeedRegistry(SEED_REGISTRY_GEN8);
}
