import { spawn } from "child_process";

const DEFAULT_TIMEOUT_MS = 360 * 1000;
const timeoutMs = process.env.TEST_TIMEOUT_SEC
  ? parseInt(process.env.TEST_TIMEOUT_SEC, 10) * 1000
  : DEFAULT_TIMEOUT_MS;

const args = process.argv.slice(2);
const vitestArgs = args.length > 0 ? args : ["run"];

const t0 = Date.now();
const child = spawn("npx", ["vitest", ...vitestArgs], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error(`\n[TEST RUNNER ERROR] 全体タイムアウト (${timeoutMs / 1000}秒) を超過したため、テストプロセスを強制終了します。\n`);
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", child.pid.toString(), "/f", "/t"]);
    } else {
      child.kill("SIGKILL");
    }
  } catch (e) {
    // ignore
  }
  process.exit(1);
}, timeoutMs);

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (timedOut) return;

  const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
  if (code === 0) {
    console.log(`\n[TEST RUNNER] 全テストが正常に完了しました (${durationSec}秒)\n`);
    process.exit(0);
  } else {
    console.error(`\n[TEST RUNNER] テストが失敗しました (code: ${code}, signal: ${signal}, ${durationSec}秒)\n`);
    process.exit(code || 1);
  }
});
