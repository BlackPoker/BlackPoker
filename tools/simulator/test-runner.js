import { spawn } from "child_process";

const DEFAULT_TIMEOUT_MS = 360 * 1000;
const timeoutMs = process.env.TEST_TIMEOUT_SEC
  ? parseInt(process.env.TEST_TIMEOUT_SEC, 10) * 1000
  : DEFAULT_TIMEOUT_MS;

const args = process.argv.slice(2);
const vitestArgs = args.includes("run") ? args : ["run", ...args];


const t0 = Date.now();
const isWin = process.platform === "win32";

// POSIX環境では detached: true にして独立したプロセスグループを作成
const child = spawn("npx", ["vitest", ...vitestArgs], {
  stdio: "inherit",
  env: process.env,
  shell: true,
  detached: !isWin,
});

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error(`\n[TEST RUNNER ERROR] 全体タイムアウト (${timeoutMs / 1000}秒) を超過したため、テストプロセスツリーを強制終了します。\n`);
  try {
    if (isWin) {
      spawn("taskkill", ["/pid", child.pid.toString(), "/f", "/t"]);
    } else if (child.pid) {
      // 負の PID を指定してプロセスグループ（親Vitest、子ワーカーすべて）に SIGKILL を一括送信
      process.kill(-child.pid, "SIGKILL");
    }
  } catch (e) {
    try {
      child.kill("SIGKILL");
    } catch (_) {}
  }
  process.exit(1);
}, timeoutMs);

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (timedOut) return;

  const durationSec = ((Date.now() - t0) / 1000).toFixed(2);
  if (code === 0) {
    console.log(`\n[TEST RUNNER] 全テストが正常に完了しました (${durationSec}秒)\n`);
    process.exit(0);
  } else {
    console.error(`\n[TEST RUNNER] テストが失敗しました (code: ${code}, signal: ${signal}, ${durationSec}秒)\n`);
    process.exit(code || 1);
  }
});
