import React, { useMemo, useRef, useState, useEffect } from "react";
import { DecisionPanel } from "./ui/decision/DecisionPanel";
import { LegalPatternGenerator } from "./engine/decision/LegalPatternGenerator";
import { PatternExecutor } from "./engine/decision/PatternExecutor";
import { PatternExpander } from "./engine/decision/PatternExpander";
import { DecisionRequest } from "./domain/decision/DecisionRequest";
import { DecisionResponse } from "./domain/decision/DecisionResponse";
import { CommandRegistry } from "./engine/rules/CommandRegistry";
import { FirstLegalPatternPolicy } from "./controller/FirstLegalPatternPolicy";
import { RandomPolicy } from "./controller/RandomPolicy";
import { GameSession } from "./engine/session/GameSession";
import { PassTracker } from "./engine/session/PassTracker";

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

const createUnit = ({ kind, card, state = "charge", labels = [], componentId }: any) => ({
  unitId: newId(),
  kind,
  componentId: componentId || (kind === "防壁" ? "character.bulwark" : "character.soldier"),
  state,
  cards: [card],
  labels,
});

const initialPlayer = (name: string) => ({
  name,
  life: 16,
  hand: [parseCard("H3"), parseCard("S5"), parseCard("D7")],
  grave: [] as any[],
  field: [
    createUnit({ kind: "防壁", card: parseCard("C4"), labels: ["防御"], componentId: "character.bulwark" }),
    createUnit({ kind: "兵士", card: parseCard("S6"), labels: ["攻撃", "防御"], componentId: "character.soldier" }),
  ],
  fog: [] as any[],
  trump: [] as any[],
});

const createInitialState = () => ({
  turnPlayer: "p1",
  chancePlayer: "p1",
  activePlayer: "p1",
  phaseText: "メイン / ステージ空",
  stateVersion: 1,
  stage: {
    requests: [] as any[],
    history: [] as any[],
  },
  stack: [] as any[],
  players: {
    p1: initialPlayer("Player A"),
    p2: initialPlayer("Player B"),
  } as Record<string, any>,
});

const makeLog = (level: string, message: string) => ({ id: newId(), level, message, at: nowText() });

// 基本組み込みルール定義
const builtinRulePackage = {
  id: "blackpoker-official-base",
  version: "1.0.0",
  actions: [
    {
      id: "action.up",
      name: "アップ",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "quick" },
      cost: "D",
      key: { id: "key", condition: { card: { suit: "heart", rank: "A..10", zone: "hand" } } },
      targets: [{ id: "target", condition: { component: "character.soldier" } }],
      effect: [{ createFog: { component: "fog.up", card: "key", bindings: { target: "target", amount: "key.rankValue" } } }],
    },
    {
      id: "action.down",
      name: "ダウン",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "quick" },
      cost: "D",
      key: { id: "key", condition: { card: { suit: "spade", rank: "2..10", zone: "hand" } } },
      targets: [{ id: "target", condition: { component: "character.soldier" } }],
      effect: [{ createFog: { component: "fog.down", card: "key", bindings: { target: "target", amount: "-key.rankValue" } } }],
    },
    {
      id: "action.twist",
      name: "ツイスト",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "quick" },
      cost: "D",
      key: { id: "key", condition: { card: { suit: "club", rank: "A..10", zone: "hand" } } },
      targets: [{ id: "target", condition: { componentType: "character" } }],
      effect: [{ toggleUnitState: { target: "target" } }],
    },
    {
      id: "action.attack",
      name: "アタック",
      type: "normal",
      request: { trigger: "direct", speed: "normal", timing: "main" },
      targets: [{ id: "target", type: "unit", condition: { owner: "self", componentType: "character" } }],
      effect: [{ startAttack: { attacker: "target" } }],
    },
    {
      id: "action.end",
      name: "エンド",
      type: "normal",
      request: { trigger: "direct", speed: "normal", timing: "main" },
      effect: [{ endTurn: {} }],
    },
  ],
  components: [
    { id: "character.soldier", name: "兵士", type: "character" },
    { id: "character.bulwark", name: "防壁", type: "character" },
    { id: "fog.up", name: "アップ", type: "fog" },
    { id: "fog.down", name: "ダウン", type: "fog" },
  ],
};

function Icon({ children }: any) {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-800 text-xs text-slate-300 font-mono">
      {children}
    </span>
  );
}

function CardChip({ card, compact = false }: any) {
  const red = card?.suit === "H" || card?.suit === "D";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border px-2 py-1 font-mono text-sm shadow-sm ${
        red
          ? "border-rose-500/40 bg-rose-950/40 text-rose-200"
          : "border-slate-600/50 bg-slate-800/90 text-slate-100"
      } ${compact ? "px-1.5 py-0.5 text-xs" : ""}`}
    >
      {card?.code ?? "?"}
    </span>
  );
}

function UnitCard({ unit }: { unit: any }) {
  const stateColor =
    unit.state === "charge"
      ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-200"
      : "bg-amber-950/60 border-amber-500/40 text-amber-200";

  return (
    <div className={`rounded-xl border p-2.5 text-xs shadow-sm ${stateColor}`}>
      <div className="flex items-center justify-between font-bold">
        <span>{unit.kind}</span>
        <span className="rounded px-1.5 py-0.5 text-[10px] uppercase font-mono bg-black/40">
          {unit.state}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {unit.cards?.map((c: any, i: number) => (
          <CardChip key={i} card={c} compact />
        ))}
      </div>
      {unit.labels && unit.labels.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-400">
          {unit.labels.map((l: string, i: number) => (
            <span key={i} className="rounded bg-slate-800/80 px-1 py-0.5">
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerBoard({
  playerKey,
  player,
  isActive,
  controllerType,
}: {
  playerKey: string;
  player: any;
  isActive: boolean;
  controllerType: "HUMAN" | "AI";
}) {
  return (
    <section
      className={`rounded-2xl border p-4 transition ${
        isActive
          ? "border-indigo-500/60 bg-slate-900/90 shadow-lg ring-1 ring-indigo-500/30"
          : "border-slate-800 bg-slate-900/40"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              isActive ? "bg-indigo-400 shadow-sm shadow-indigo-400" : "bg-slate-600"
            }`}
          />
          <h2 className="font-bold text-slate-200">
            {player.name} ({playerKey})
          </h2>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-400">
            {controllerType === "HUMAN" ? "Human" : "AI"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="rounded-lg bg-rose-950/50 border border-rose-800/40 px-2.5 py-1 font-bold text-rose-300">
            Life: {Array.isArray(player.life) ? player.life.length : player.life}
          </div>
          <div className="text-xs text-slate-400">
            墓地: <span className="font-mono">{player.grave?.length || 0}</span>
          </div>
        </div>
      </div>

      {/* 手札 */}
      <div className="mb-3">
        <div className="mb-1 text-xs font-semibold text-slate-400">
          手札 ({player.hand?.length || 0})
        </div>
        <div className="flex flex-wrap gap-1.5">
          {player.hand?.map((c: any, i: number) => (
            <CardChip key={c.id || i} card={c} />
          ))}
          {(!player.hand || player.hand.length === 0) && (
            <span className="text-xs text-slate-500 italic">なし</span>
          )}
        </div>
      </div>

      {/* フィールド */}
      <div>
        <div className="mb-1 text-xs font-semibold text-slate-400">
          フィールド ({player.field?.length || 0})
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {player.field?.map((u: any) => (
            <UnitCard key={u.unitId} unit={u} />
          ))}
          {(!player.field || player.field.length === 0) && (
            <span className="text-xs text-slate-500 italic col-span-2">ユニットなし</span>
          )}
        </div>
      </div>

      {/* フォグ */}
      {player.fog && player.fog.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-slate-800">
          <div className="mb-1 text-xs font-semibold text-indigo-300">フォグ効果</div>
          <div className="flex flex-wrap gap-2 text-xs">
            {player.fog.map((f: any, i: number) => (
              <div key={i} className="rounded bg-indigo-950/40 border border-indigo-500/30 px-2 py-1 text-indigo-200">
                {f.componentId} (Card: {f.card?.code || f.card?.suit + f.card?.rank})
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function BlackPokerSimulator() {
  const [activeTab, setActiveTab] = useState<"decision" | "debug">("decision");
  const [game, setGame] = useState(createInitialState);
  const [logs, setLogs] = useState([
    makeLog("info", "BlackPoker Simulator: Decision & Debug Interface 起動完了"),
  ]);
  const [controllers, setControllers] = useState<{ p1: "HUMAN" | "AI"; p2: "HUMAN" | "AI" }>({
    p1: "HUMAN",
    p2: "AI",
  });
  const [aiPolicyType, setAiPolicyType] = useState<"first" | "random">("first");

  const registry = useMemo(() => new CommandRegistry(), []);
  const passTracker = useMemo(() => new PassTracker(), []);
  const session = useMemo(() => {
    return new GameSession(game, builtinRulePackage as any, { registry, passTracker });
  }, [game, registry, passTracker]);

  // 現在のチャンスプレイヤーに対する DecisionRequest 生成
  const currentDecision = useMemo(() => {
    try {
      const step = session.advance();
      if (step.type === "WAITING_FOR_DECISION") {
        return step.request;
      }
      return null;
    } catch {
      return null;
    }
  }, [session]);

  const currentController = currentDecision ? controllers[currentDecision.playerId as "p1" | "p2"] : "HUMAN";

  // Decision 確定時の適用処理
  const handleDecisionSubmit = (response: DecisionResponse) => {
    if (!currentDecision) return;
    try {
      const chosenPattern = currentDecision.patterns[response.selectedPatternRef];
      const expanded = PatternExpander.expandPattern(
        chosenPattern,
        currentDecision.catalog,
        response.selectedPatternRef
      );

      const step = session.submitDecision(response);

      setGame({ ...session.state });

      setLogs((prev) => [
        ...prev,
        makeLog(
          "decision",
          `[${currentDecision.playerId === "p1" ? "Player A" : "Player B"}] ${expanded.summary} (Ref: #${
            response.selectedPatternRef
          })`
        ),
      ]);

      if (step.type === "WAITING_FOR_DECISION" && step.lastEvent && step.lastEvent.type === "STAGE_TOP_RESOLVED") {
        const lastEv = step.lastEvent;
        setLogs((prev) => [
          ...prev,
          makeLog("info", `⚡ 全員連続パス成立: ステージ最上段のアクション [${lastEv.actionRequest.action?.name || lastEv.actionRequest.actionId}] を1件解決しました。`),
        ]);
      }
    } catch (err: any) {
      setLogs((prev) => [...prev, makeLog("error", `実行エラー: ${err.message || String(err)}`)]);
    }
  };

  // AI に1手を打たせる
  const handleAiStep = async () => {
    if (!currentDecision || currentDecision.patterns.length === 0) return;
    const policy = aiPolicyType === "first" ? new FirstLegalPatternPolicy() : new RandomPolicy();
    const response = await policy.decide(currentDecision);
    handleDecisionSubmit(response);
  };

  const handleReset = () => {
    setGame(createInitialState());
    setLogs((prev) => [...prev, makeLog("info", "ゲーム盤面を初期化しました。")]);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="flex h-screen flex-col overflow-hidden">
        {/* ヘッダー */}
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-300 font-bold">
              BP
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-100">BlackPoker Simulator</h1>
              <p className="text-xs text-slate-500">Universal Decision Interface & Simulator</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* モード切替タブ */}
            <div className="flex rounded-lg bg-slate-900 p-1 border border-slate-800 text-xs">
              <button
                onClick={() => setActiveTab("decision")}
                className={`rounded px-3 py-1.5 font-bold transition ${
                  activeTab === "decision"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                🎮 通常対戦モード (Decision)
              </button>
              <button
                onClick={() => setActiveTab("debug")}
                className={`rounded px-3 py-1.5 font-bold transition ${
                  activeTab === "debug"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                🛠️ デバッグ / コマンド
              </button>
            </div>

            <button
              onClick={handleReset}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-900 transition"
            >
              リセット
            </button>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_380px]">
          <div className="flex min-h-0 flex-col overflow-auto p-4 space-y-4">
            {/* プレイヤーB (上部) */}
            <PlayerBoard
              playerKey="p2"
              player={game.players.p2}
              isActive={game.chancePlayer === "p2"}
              controllerType={controllers.p2}
            />

            {/* ステージ / 中央情報 */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-300">
                  <Icon>積</Icon>
                  <span>ステージ & マッチ情報</span>
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-400">
                    Turn: <b className="text-slate-200">{game.turnPlayer}</b>
                  </span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-400">
                    Chance: <b className="text-indigo-300">{game.chancePlayer}</b>
                  </span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-400">
                    Ver: <b className="text-emerald-300">{game.stateVersion}</b>
                  </span>
                </div>
              </div>

              {game.stage?.requests && game.stage.requests.length > 0 ? (
                <div className="space-y-1">
                  {game.stage.requests.map((r: any, idx: number) => (
                    <div
                      key={r.id || idx}
                      className="rounded-lg bg-indigo-950/40 border border-indigo-500/30 p-2 text-xs flex justify-between"
                    >
                      <span>
                        #{r.sequence} <b>{r.action?.name || r.actionId}</b> ({r.controller})
                      </span>
                      <span className="text-indigo-400">{r.status}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl bg-slate-950/60 p-3 text-xs text-slate-500 italic">
                  ステージ空（リクエストなし）
                </div>
              )}
            </div>

            {/* プレイヤーA (下部) */}
            <PlayerBoard
              playerKey="p1"
              player={game.players.p1}
              isActive={game.chancePlayer === "p1"}
              controllerType={controllers.p1}
            />

            {/* DecisionPanel (人間手番時) または AI 操作バー */}
            {activeTab === "decision" && (
              <div className="pt-2">
                {currentController === "HUMAN" && currentDecision && currentDecision.patterns.length > 0 && (
                  <DecisionPanel
                    request={currentDecision}
                    onSubmit={handleDecisionSubmit}
                  />
                )}

                {currentController === "AI" && currentDecision && currentDecision.patterns.length > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-slate-900/90 p-4 flex items-center justify-between">
                    <div>
                      <span className="rounded bg-amber-600 px-2 py-0.5 text-xs font-bold text-white uppercase">
                        AI Turn
                      </span>
                      <p className="mt-1 text-sm font-semibold text-slate-200">
                        {currentDecision.playerId === "p1" ? "Player A" : "Player B"} (AI) の判断待機中
                      </p>
                      <p className="text-xs text-slate-400">
                        合法手: {currentDecision.patterns.length}件 / 方針: {aiPolicyType}
                      </p>
                    </div>
                    <button
                      onClick={handleAiStep}
                      className="rounded-lg bg-amber-600 px-5 py-2.5 font-bold text-white shadow-lg hover:bg-amber-500 transition active:scale-95"
                    >
                      AIに1手実行させる
                    </button>
                  </div>
                )}

                {currentDecision && currentDecision.patterns.length === 0 && (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-center text-sm text-slate-400">
                    現在のプレイヤーに選択可能な合法手がありません。
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 右サイドバー: 設定 & ログ */}
          <aside className="min-h-0 border-l border-slate-800 bg-slate-950 flex flex-col">
            {/* コントローラー設定パネル */}
            <div className="p-4 border-b border-slate-800 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                座席・AI設定
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Player A</label>
                  <select
                    value={controllers.p1}
                    onChange={(e) => setControllers((prev) => ({ ...prev, p1: e.target.value as any }))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200 font-semibold"
                  >
                    <option value="HUMAN">Human (人間)</option>
                    <option value="AI">AI (自動)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Player B</label>
                  <select
                    value={controllers.p2}
                    onChange={(e) => setControllers((prev) => ({ ...prev, p2: e.target.value as any }))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200 font-semibold"
                  >
                    <option value="HUMAN">Human (人間)</option>
                    <option value="AI">AI (自動)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">AI アルゴリズム方針</label>
                <select
                  value={aiPolicyType}
                  onChange={(e) => setAiPolicyType(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-slate-200 font-semibold"
                >
                  <option value="first">FirstLegalPatternPolicy (最初の合法手)</option>
                  <option value="random">RandomPolicy (ランダム選択)</option>
                </select>
              </div>
            </div>

            {/* ログ一覧 */}
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 text-xs font-bold text-slate-400">
              <span>実行ログ & 履歴</span>
              <span>{logs.length}件</span>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {[...logs].reverse().map((log) => (
                <div
                  key={log.id}
                  className={`rounded-xl border p-2.5 text-xs ${
                    log.level === "error"
                      ? "border-rose-500/30 bg-rose-950/30 text-rose-200"
                      : log.level === "decision"
                      ? "border-indigo-500/30 bg-indigo-950/30 text-indigo-200"
                      : "border-slate-800 bg-slate-900/60 text-slate-300"
                  }`}
                >
                  <div className="text-[10px] text-slate-500 mb-0.5">{log.at}</div>
                  <div className="font-semibold">{log.message}</div>
                </div>
              ))}
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
