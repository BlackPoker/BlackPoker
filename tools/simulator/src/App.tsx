import React, { useMemo, useRef, useState } from "react";

// Canvas のサンドボックスで外部アイコン取得に失敗することがあるため、
// lucide-react などの外部 UI アイコンには依存しない実装にしています。

const suits: Record<string, string> = {
  S: "♠",
  H: "♡",
  D: "♢",
  C: "♣",
  J: "Joker",
};

const newId = () => {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const cloneState = (value: any) => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const nowText = () => new Date().toLocaleTimeString();

const rankValue = (rank: string) => {
  if (rank === "A") return 1;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  if (rank === "0") return 0;
  const n = Number(rank);
  return Number.isFinite(n) ? n : 0;
};

const parseCard = (raw: string) => {
  if (typeof raw !== "string") return null;
  const text = raw.trim().toUpperCase();
  if (!text) return null;
  if (text === "JOKER" || text === "JK") {
    return { id: `JOKER-${newId()}`, code: "Joker", suit: "J", rank: "0", value: 0 };
  }
  const suit = text[0];
  const rank = text.slice(1);
  if (!suits[suit] || !rank) return null;
  const value = rankValue(rank);
  return { id: `${suit}${rank}-${newId()}`, code: `${suits[suit]}${rank}`, suit, rank, value };
};

const createUnit = ({ kind, card, state = "charge", labels = [] }: any) => ({
  unitId: newId(),
  kind,
  state,
  cards: [card],
  labels,
});

const initialPlayer = (name: string) => ({
  name,
  life: 16,
  hand: [parseCard("H3"), parseCard("S5"), parseCard("D7")],
  grave: [],
  field: [
    createUnit({ kind: "防壁", card: parseCard("C4"), labels: ["防御"] }),
    createUnit({ kind: "兵士", card: parseCard("S6"), labels: ["攻撃", "防御"] }),
  ],
  fog: [],
  trump: [],
});

const createInitialState = () => ({
  activePlayer: "p1",
  chancePlayer: "p1",
  phaseText: "メイン / ステージ空",
  stack: [] as any[],
  players: {
    p1: initialPlayer("Player A"),
    p2: initialPlayer("Player B"),
  } as Record<string, any>,
});

const makeLog = (level: string, message: string) => ({ id: newId(), level, message, at: nowText() });

function runSelfTests() {
  const results: any[] = [];
  const test = (name: string, fn: Function) => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (error: any) {
      results.push({ name, ok: false, error: error?.message || String(error) });
    }
  };

  test("parseCard parses H3", () => {
    const card = parseCard("H3");
    if (!card || card.code !== "♡3" || card.value !== 3) throw new Error("H3 parse failed");
  });

  test("parseCard parses Joker", () => {
    const card = parseCard("joker");
    if (!card || card.code !== "Joker" || card.value !== 0) throw new Error("Joker parse failed");
  });

  test("damage reduces life", () => {
    const base = createInitialState();
    const { state } = applyCommand(base, "damage p2 3");
    if (state.players.p2.life !== 13) throw new Error(`expected 13, got ${state.players.p2.life}`);
  });

  test("summon adds a soldier", () => {
    const base = createInitialState();
    const before = base.players.p1.field.length;
    const { state } = applyCommand(base, "summon p1 H7");
    if (state.players.p1.field.length !== before + 1) throw new Error("soldier was not added");
  });

  test("request pushes stack", () => {
    const base = createInitialState();
    const { state } = applyCommand(base, "request p1 アップ");
    if (state.stack.length !== 1 || state.stack[0].actionName !== "アップ") throw new Error("request failed");
  });

  return results;
}

function Icon({ children }: any) {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-800 text-xs text-slate-300">
      {children}
    </span>
  );
}

function CardChip({ card, compact = false }: any) {
  const red = card?.suit === "H" || card?.suit === "D";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border px-2 py-1 font-mono text-sm ${
        red
          ? "border-rose-400/50 bg-rose-950/40 text-rose-200"
          : "border-slate-400/40 bg-slate-800/80 text-slate-100"
      } ${compact ? "px-1.5 py-0.5 text-xs" : ""}`}
    >
      {card?.code ?? "?"}
    </span>
  );
}

function UnitCard({ unit, index }: any) {
  const total = unit.cards.reduce((sum: number, card: any) => sum + card.value, 0);
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3 shadow-lg shadow-black/20">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-100">
          #{index + 1} {unit.kind}
        </div>
        <div
          className={`rounded-full px-2 py-0.5 text-xs ${
            unit.state === "charge" ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-200"
          }`}
        >
          {unit.state === "charge" ? "チャージ" : "ドライブ"}
        </div>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {unit.cards.map((card: any) => (
          <CardChip key={card.id} card={card} compact />
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{unit.labels.join(" / ") || "ラベルなし"}</span>
        <span>size {total}</span>
      </div>
    </div>
  );
}

function ZoneSummary({ icon, label, count }: any) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
      <Icon>{icon}</Icon>
      <span className="text-slate-400">{label}</span>
      <span className="ml-auto font-mono text-slate-100">{count}</span>
    </div>
  );
}

function PlayerBoard({ playerKey, player, isActive }: any) {
  return (
    <section className={`rounded-2xl border p-4 ${isActive ? "border-cyan-500/50 bg-cyan-950/10" : "border-slate-800 bg-slate-950/40"}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">{player.name}</h2>
        <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">{playerKey}</span>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <ZoneSummary icon="♥" label="ライフ" count={player.life} />
        <ZoneSummary icon="手" label="手札" count={player.hand.length} />
        <ZoneSummary icon="墓" label="墓地" count={player.grave.length} />
        <ZoneSummary icon="霧" label="フォグ" count={player.fog.length} />
        <ZoneSummary icon="切" label="切札" count={player.trump.length} />
      </div>
      <div className="mb-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Field / 場</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {player.field.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">場にユニットなし</div>
          ) : (
            player.field.map((unit: any, index: number) => <UnitCard key={unit.unitId} unit={unit} index={index} />)
          )}
        </div>
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Hand / 手札</div>
        <div className="flex flex-wrap gap-2">
          {player.hand.map((card: any) => (
            <CardChip key={card.id} card={card} />
          ))}
        </div>
      </div>
    </section>
  );
}

function applyCommand(state: any, command: string) {
  const next = cloneState(state);
  const logs: any[] = [];
  const parts = command.trim().split(/\s+/);
  const [name, p, arg1, ...restArgs] = parts;
  const player = next.players[p];

  const addLog = (level: string, message: string) => logs.push(makeLog(level, message));

  if (!name) return { state: next, logs };

  if (name === "help") {
    addLog(
      "info",
      "commands: help / reset / draw p1 1 / damage p2 3 / summon p1 H7 / bulwark p1 C2 / drive p1 1 / charge p1 1 / request p1 アップ / pass / resolve / test"
    );
    return { state: next, logs };
  }

  if (name === "test") {
    const results = runSelfTests();
    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      addLog("info", `Self tests passed: ${results.length}/${results.length}`);
    } else {
      failed.forEach((r) => addLog("error", `Self test failed: ${r.name}: ${r.error}`));
    }
    return { state: next, logs };
  }

  if (name === "reset") {
    return { state: createInitialState(), logs: [makeLog("info", "ゲーム状態を初期化しました。")] };
  }

  if (!player && !["pass", "resolve"].includes(name)) {
    addLog("error", "プレイヤーは p1 または p2 を指定してください。例: summon p1 H7");
    return { state: next, logs };
  }

  switch (name) {
    case "draw": {
      const count = Math.max(1, Number(arg1 || 1));
      let actual = 0;
      for (let i = 0; i < count; i += 1) {
        if (player.life <= 0) break;
        player.life -= 1;
        actual += 1;
        const randomSuit = ["S", "H", "D", "C"][Math.floor(Math.random() * 4)];
        const randomRank = String(Math.floor(Math.random() * 9) + 2);
        player.hand.push(parseCard(randomSuit + randomRank));
      }
      addLog("info", `${player.name} が ${actual} 枚ドローしました。`);
      break;
    }
    case "damage": {
      const amount = Math.max(0, Number(arg1 || 0));
      player.life = Math.max(0, player.life - amount);
      addLog("warn", `${player.name} は ${amount} 点ダメージを受けました。`);
      if (player.life === 0) addLog("error", `${player.name} のライフが 0 です。勝敗判定が必要です。`);
      break;
    }
    case "summon": {
      const card = parseCard(arg1 || "");
      if (!card) {
        addLog("error", "カード指定が読み取れません。例: summon p1 H7");
        break;
      }
      player.field.push(createUnit({ kind: "兵士", card, labels: ["攻撃", "防御"] }));
      addLog("info", `${player.name} は ${card.code} を兵士として場に出しました。`);
      break;
    }
    case "bulwark": {
      const card = parseCard(arg1 || "");
      if (!card) {
        addLog("error", "カード指定が読み取れません。例: bulwark p1 C2");
        break;
      }
      player.field.push(createUnit({ kind: "防壁", card, labels: ["防御"] }));
      addLog("info", `${player.name} は ${card.code} を防壁として場に出しました。`);
      break;
    }
    case "drive":
    case "charge": {
      const index = Number(arg1) - 1;
      const unit = player.field[index];
      if (!unit) {
        addLog("error", "ユニット番号が存在しません。例: drive p1 1");
        break;
      }
      unit.state = name === "drive" ? "drive" : "charge";
      addLog("info", `${player.name} の ${index + 1} 番目のユニットを ${unit.state === "drive" ? "ドライブ" : "チャージ"}しました。`);
      break;
    }
    case "request": {
      const actionName = [arg1, ...restArgs].filter(Boolean).join(" ") || "未定義アクション";
      next.stack.push({ id: newId(), controller: p, actionName });
      next.phaseText = "ステージ処理中";
      next.chancePlayer = p === "p1" ? "p2" : "p1";
      addLog("info", `${player.name} が「${actionName}」をリクエストしました。チャンスは ${next.chancePlayer} へ。`);
      break;
    }
    case "pass": {
      next.chancePlayer = next.chancePlayer === "p1" ? "p2" : "p1";
      addLog("info", `パスしました。チャンスは ${next.chancePlayer} へ。`);
      break;
    }
    case "resolve": {
      const request = next.stack.pop();
      if (!request) {
        next.phaseText = "メイン / ステージ空";
        addLog("info", "ステージは空です。解決するリクエストはありません。");
      } else {
        addLog("info", `「${request.actionName}」を解決しました。※現段階では効果は手動反映です。`);
      }
      if (next.stack.length === 0) next.phaseText = "メイン / ステージ空";
      break;
    }
    default:
      addLog("error", `未対応コマンドです: ${name}. help を入力してください。`);
  }

  return { state: next, logs };
}

export default function BlackPokerSimulatorPrototype() {
  const [game, setGame] = useState(createInitialState);
  const [logs, setLogs] = useState([makeLog("info", "BlackPoker Web Simulator Prototype を起動しました。help でコマンド一覧。")]);
  const [command, setCommand] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const stackText = useMemo(() => {
    return game.stack.map((r, index) => `${index + 1}. ${r.actionName} (${r.controller})`).join("\n") || "ステージ空";
  }, [game.stack]);

  const run = () => {
    const trimmed = command.trim();
    if (!trimmed) return;
    const { state, logs: newLogs } = applyCommand(game, trimmed);
    setGame(state);
    setLogs((prev) => [...prev, makeLog("cmd", `> ${trimmed}`), ...newLogs]);
    setCommand("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const runReset = () => {
    const { state, logs: newLogs } = applyCommand(game, "reset");
    setGame(state);
    setLogs((prev) => [...prev, ...newLogs]);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const runTests = () => {
    const { state, logs: newLogs } = applyCommand(game, "test");
    setGame(state);
    setLogs((prev) => [...prev, makeLog("cmd", "> test"), ...newLogs]);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="flex h-screen flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-200">BP</div>
            <div>
              <h1 className="text-base font-semibold">BlackPoker Simulator</h1>
              <p className="text-xs text-slate-500">VSCode風 / Web prototype / command driven</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-slate-400">
            <span className="rounded-full border border-slate-800 px-3 py-1">Turn: {game.activePlayer}</span>
            <span className="rounded-full border border-slate-800 px-3 py-1">Chance: {game.chancePlayer}</span>
            <span className="rounded-full border border-slate-800 px-3 py-1">{game.phaseText}</span>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_360px]">
          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="grid gap-4">
                <PlayerBoard playerKey="p2" player={game.players.p2} isActive={game.activePlayer === "p2"} />
                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">
                    <Icon>積</Icon>
                    Stage / ステージ
                  </div>
                  <pre className="min-h-16 whitespace-pre-wrap rounded-xl bg-slate-950 p-3 font-mono text-sm text-slate-400">{stackText}</pre>
                </div>
                <PlayerBoard playerKey="p1" player={game.players.p1} isActive={game.activePlayer === "p1"} />
              </div>
            </div>

            <section className="border-t border-slate-800 bg-slate-950 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">
                <Icon>&gt;</Icon>
                Console / コマンド入力
              </div>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") run();
                  }}
                  placeholder="例: summon p1 H7 / request p1 アップ / resolve / help"
                  className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 font-mono text-sm text-slate-100 outline-none ring-cyan-500/30 placeholder:text-slate-600 focus:ring-4"
                />
                <button onClick={run} className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
                  実行
                </button>
                <button onClick={runReset} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-900">
                  Reset
                </button>
                <button onClick={runTests} className="hidden rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-900 md:inline-flex">
                  Test
                </button>
              </div>
            </section>
          </div>

          <aside className="min-h-0 border-l border-slate-800 bg-slate-950">
            <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-300">
              <Icon>log</Icon>
              Log / 履歴
            </div>
            <div className="h-full overflow-auto p-3 pb-20">
              <div className="space-y-2">
                {[...logs].reverse().map((log) => (
                  <div
                    key={log.id}
                    className={`rounded-xl border p-3 text-sm ${
                      log.level === "error"
                        ? "border-rose-500/30 bg-rose-950/30 text-rose-100"
                        : log.level === "warn"
                          ? "border-amber-500/30 bg-amber-950/30 text-amber-100"
                          : log.level === "cmd"
                            ? "border-cyan-500/20 bg-cyan-950/20 font-mono text-cyan-100"
                            : "border-slate-800 bg-slate-900/70 text-slate-300"
                    }`}
                  >
                    <div className="mb-1 text-xs text-slate-500">{log.at}</div>
                    {log.message}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
