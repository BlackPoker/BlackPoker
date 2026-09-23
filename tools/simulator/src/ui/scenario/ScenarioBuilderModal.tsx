import React, { useState, useMemo, useCallback } from "react";
import {
  ScenarioDefinitionV1,
  ScenarioPlayerV1,
  ScenarioUnitV1,
  ScenarioCardRefV1,
  SCENARIO_SCHEMA_VERSION,
} from "../../domain/scenario/ScenarioTypes";
import { RegulationCatalog } from "../../domain/regulation/RegulationDefinition";
import { RulePackage } from "../../domain/rules/RulePackage";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { SimulatorDeckProfileResolver } from "../../engine/regulation/SimulatorDeckProfileResolver";
import {
  ScenarioCompiler,
  ScenarioCompileOutcome,
} from "../../engine/scenario/ScenarioCompiler";
import {
  encodeScenarioDefinitionV1ToUrlParam,
  decodeScenarioDefinitionV1FromUrlParam,
  buildScenarioShareUrl,
  parseScenarioShareUrl,
} from "./ScenarioShareUrl";
import { copyTextToClipboard } from "../utils/clipboard";
import { OFFICIAL_ENV_PREFIX, extractRegulationId } from "../../engine/playtest/PlaytestEnvironmentController";

export interface ScenarioBuilderModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly catalog: RegulationCatalog;
  readonly fullRulePackage: RulePackage;
  readonly onStartScenario: (definition: ScenarioDefinitionV1) => void;
  readonly initialDefinition?: ScenarioDefinitionV1;
  readonly initialTab?: "p1" | "p2" | "settings";
}

const DEFAULT_SUITS: readonly ("S" | "H" | "D" | "C" | "J")[] = ["S", "H", "D", "C"];

export const ScenarioBuilderModal: React.FC<ScenarioBuilderModalProps> = ({
  isOpen,
  onClose,
  catalog,
  fullRulePackage,
  onStartScenario,
  initialDefinition,
  initialTab,
}) => {
  // 利用可能な公式環境一覧（simulatorImplemented === true のみ。Core Battle は対象外）
  const officialEnvironments = useMemo(() => {
    const list: { id: string; name: string; regulationId: string }[] = [];
    for (const reg of catalog.regulations.values()) {
      const validation = RegulationValidator.validateRegulation(catalog, reg.id);
      if (validation.simulatorImplemented) {
        list.push({
          id: `${OFFICIAL_ENV_PREFIX}${reg.id}`,
          name: `${reg.name} (公式)`,
          regulationId: reg.id,
        });
      }
    }
    return list;
  }, [catalog]);

  const defaultEnvId = officialEnvironments.length > 0 ? officialEnvironments[0].id : "official:light-entry16";

  // モーダル内部の Draft State
  const [environmentId, setEnvironmentId] = useState<string>(
    initialDefinition?.environmentId ?? defaultEnvId
  );
  const [seed, setSeed] = useState<number>(initialDefinition?.seed ?? 42);
  const [turnPlayer, setTurnPlayer] = useState<"p1" | "p2">(initialDefinition?.turnPlayer ?? "p1");
  const [chancePlayer, setChancePlayer] = useState<"p1" | "p2">(initialDefinition?.chancePlayer ?? "p1");
  const [turnCount, setTurnCount] = useState<number>(initialDefinition?.turnCount ?? 1);
  const [name, setName] = useState<string>(initialDefinition?.name ?? "");
  const [description, setDescription] = useState<string>(initialDefinition?.description ?? "");

  // プレイヤーごとのカード配置 Draft
  const [p1Hand, setP1Hand] = useState<ScenarioCardRefV1[]>(
    initialDefinition?.players?.p1?.hand ? [...initialDefinition.players.p1.hand] : []
  );
  const [p1Grave, setP1Grave] = useState<ScenarioCardRefV1[]>(
    initialDefinition?.players?.p1?.grave ? [...initialDefinition.players.p1.grave] : []
  );
  const [p1Field, setP1Field] = useState<ScenarioUnitV1[]>(
    initialDefinition?.players?.p1?.field ? [...initialDefinition.players.p1.field] : []
  );

  const [p2Hand, setP2Hand] = useState<ScenarioCardRefV1[]>(
    initialDefinition?.players?.p2?.hand ? [...initialDefinition.players.p2.hand] : []
  );
  const [p2Grave, setP2Grave] = useState<ScenarioCardRefV1[]>(
    initialDefinition?.players?.p2?.grave ? [...initialDefinition.players.p2.grave] : []
  );
  const [p2Field, setP2Field] = useState<ScenarioUnitV1[]>(
    initialDefinition?.players?.p2?.field ? [...initialDefinition.players.p2.field] : []
  );

  // URL 読込・共有用ステート
  const [urlInput, setUrlInput] = useState<string>("");
  const [shareNotice, setShareNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // 現在の環境に対応する Canonical Deck Profile のカード候補
  const currentDeckCards = useMemo(() => {
    const regId = extractRegulationId(environmentId);
    if (!regId) return [];
    const val = RegulationValidator.validateRegulation(catalog, regId);
    if (!val.frame) return [];
    return SimulatorDeckProfileResolver.resolveDeckProfile(val.frame, regId).cards;
  }, [catalog, environmentId]);

  // 利用可能なコンポーネント定義一覧
  const availableComponents = useMemo(() => {
    return fullRulePackage.components.filter((c) => c.type === "character");
  }, [fullRulePackage]);

  // 現在の入力から ScenarioDefinitionV1 を構築
  const currentDefinition: ScenarioDefinitionV1 = useMemo(() => {
    return {
      version: 1,
      name: name.trim() || undefined,
      description: description.trim() || undefined,
      environmentId,
      seed,
      turnPlayer,
      chancePlayer,
      turnCount,
      players: {
        p1: {
          hand: p1Hand.length > 0 ? p1Hand : undefined,
          field: p1Field.length > 0 ? p1Field : undefined,
          grave: p1Grave.length > 0 ? p1Grave : undefined,
        },
        p2: {
          hand: p2Hand.length > 0 ? p2Hand : undefined,
          field: p2Field.length > 0 ? p2Field : undefined,
          grave: p2Grave.length > 0 ? p2Grave : undefined,
        },
      },
    };
  }, [name, description, environmentId, seed, turnPlayer, chancePlayer, turnCount, p1Hand, p1Field, p1Grave, p2Hand, p2Field, p2Grave]);

  // リアルタイムコンパイル検証
  const compileOutcome: ScenarioCompileOutcome = useMemo(() => {
    return ScenarioCompiler.compile(currentDefinition, catalog, fullRulePackage);
  }, [currentDefinition, catalog, fullRulePackage]);

  // カード追加用ローカル入力ステート (P1/P2共通または個別)
  const [activeTab, setActiveTab] = useState<"p1" | "p2" | "settings">(initialTab ?? "p1");

  // カード追加ハンドラ
  const handleAddCard = (playerKey: "p1" | "p2", zone: "hand" | "grave", card: ScenarioCardRefV1) => {
    if (playerKey === "p1") {
      if (zone === "hand") setP1Hand((prev) => [...prev, card]);
      else setP1Grave((prev) => [...prev, card]);
    } else {
      if (zone === "hand") setP2Hand((prev) => [...prev, card]);
      else setP2Grave((prev) => [...prev, card]);
    }
  };

  const handleRemoveCard = (playerKey: "p1" | "p2", zone: "hand" | "grave", index: number) => {
    if (playerKey === "p1") {
      if (zone === "hand") setP1Hand((prev) => prev.filter((_, i) => i !== index));
      else setP1Grave((prev) => prev.filter((_, i) => i !== index));
    } else {
      if (zone === "hand") setP2Hand((prev) => prev.filter((_, i) => i !== index));
      else setP2Grave((prev) => prev.filter((_, i) => i !== index));
    }
  };

  // ユニット追加ハンドラ
  const handleAddUnit = (playerKey: "p1" | "p2", compId: string, card: ScenarioCardRefV1, state: "charge" | "drive", face: "up" | "down") => {
    const newUnit: ScenarioUnitV1 = { componentId: compId, card, state, face };
    if (playerKey === "p1") {
      setP1Field((prev) => [...prev, newUnit]);
    } else {
      setP2Field((prev) => [...prev, newUnit]);
    }
  };

  const handleRemoveUnit = (playerKey: "p1" | "p2", index: number) => {
    if (playerKey === "p1") {
      setP1Field((prev) => prev.filter((_, i) => i !== index));
    } else {
      setP2Field((prev) => prev.filter((_, i) => i !== index));
    }
  };

  // 共有 URL コピーハンドラ
  const handleCopyShareUrl = async () => {
    try {
      const url = typeof window !== "undefined"
        ? buildScenarioShareUrl(window.location.href, currentDefinition)
        : `?scenario=${encodeScenarioDefinitionV1ToUrlParam(currentDefinition)}`;
      const success = await copyTextToClipboard(url);
      if (success) {
        setShareNotice({ type: "success", message: "Scenario共有URLをクリップボードにコピーしました。" });
      } else {
        setShareNotice({ type: "error", message: "URLのコピーに失敗しました。" });
      }
    } catch (err: any) {
      setShareNotice({ type: "error", message: err.message || "共有URL生成エラー" });
    }
    setTimeout(() => setShareNotice(null), 3000);
  };

  // URL / コード読込ハンドラ
  const handleLoadFromUrl = () => {
    const raw = urlInput.trim();
    if (!raw) return;
    const result = raw.includes("=") || raw.includes("?")
      ? parseScenarioShareUrl(raw)
      : decodeScenarioDefinitionV1FromUrlParam(raw);

    if (result.success === false) {
      setShareNotice({ type: "error", message: `読込失敗: ${result.error}` });
      setTimeout(() => setShareNotice(null), 4000);
      return;
    }

    const def = result.definition;
    setEnvironmentId(def.environmentId);
    setSeed(def.seed);
    setTurnPlayer(def.turnPlayer);
    setChancePlayer(def.chancePlayer);
    setTurnCount(def.turnCount ?? 1);
    setName(def.name ?? "");
    setDescription(def.description ?? "");

    setP1Hand(def.players?.p1?.hand ? [...def.players.p1.hand] : []);
    setP1Field(def.players?.p1?.field ? [...def.players.p1.field] : []);
    setP1Grave(def.players?.p1?.grave ? [...def.players.p1.grave] : []);

    setP2Hand(def.players?.p2?.hand ? [...def.players.p2.hand] : []);
    setP2Field(def.players?.p2?.field ? [...def.players.p2.field] : []);
    setP2Grave(def.players?.p2?.grave ? [...def.players.p2.grave] : []);

    setShareNotice({ type: "success", message: "シナリオを正常に読み込みました。" });
    setUrlInput("");
    setTimeout(() => setShareNotice(null), 4000);
  };

  // Scenario 開始
  const handleStart = () => {
    if (compileOutcome.type !== "READY") return;
    onStartScenario(currentDefinition);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in font-sans">
      <div className="w-full max-w-4xl bg-white rounded-2xl border border-zinc-300 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* モーダルヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 bg-zinc-50">
          <div className="flex items-center gap-3">
            <span className="text-xl">🛠️</span>
            <div>
              <h2 className="text-base font-black text-zinc-950 font-serif">
                Scenario Builder (初期局面ビルダー)
              </h2>
              <p className="text-[11px] text-zinc-500 font-mono">
                公式レギュレーションの初期配置を高レベルに編集・共有します
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-200 hover:bg-zinc-300 text-zinc-700 font-mono transition"
          >
            ✕
          </button>
        </div>

        {/* タブナビゲーション */}
        <div className="flex border-b border-zinc-200 px-6 bg-white font-mono text-xs font-bold">
          <button
            onClick={() => setActiveTab("p1")}
            className={`py-2.5 px-4 border-b-2 transition ${
              activeTab === "p1"
                ? "border-zinc-950 text-zinc-950"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            }`}
          >
            Player A (先手/P1)
          </button>
          <button
            onClick={() => setActiveTab("p2")}
            className={`py-2.5 px-4 border-b-2 transition ${
              activeTab === "p2"
                ? "border-zinc-950 text-zinc-950"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            }`}
          >
            Player B (後手/P2)
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`py-2.5 px-4 border-b-2 transition ${
              activeTab === "settings"
                ? "border-zinc-950 text-zinc-950"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            }`}
          >
            環境・ターン設定・共有
          </button>
        </div>

        {/* メインコンテンツエリア */}
        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6 text-sm">
          {/* 通知バナー */}
          {shareNotice && (
            <div
              className={`p-3 rounded-xl text-xs font-mono font-bold ${
                shareNotice.type === "success"
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-red-50 text-red-800 border border-red-200"
              }`}
            >
              {shareNotice.message}
            </div>
          )}

          {activeTab === "settings" && (
            <div className="flex flex-col gap-5">
              {/* 環境選択 (Core Battle は除外) */}
              <div>
                <label className="block text-xs font-bold text-zinc-700 font-mono mb-1">
                  対戦環境 (公式レギュレーションのみ):
                </label>
                <select
                  value={environmentId}
                  onChange={(e) => setEnvironmentId(e.target.value)}
                  className="w-full text-xs font-mono font-bold p-2.5 rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:ring-2 focus:ring-zinc-950 focus:outline-none"
                >
                  {officialEnvironments.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Seed 入力 */}
              <div>
                <label className="block text-xs font-bold text-zinc-700 font-mono mb-1">
                  補完用決定論的 Seed (非負整数):
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={seed}
                  onChange={(e) => setSeed(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full text-xs font-mono font-bold p-2.5 rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:ring-2 focus:ring-zinc-950 focus:outline-none"
                />
                <p className="text-[11px] text-zinc-500 font-mono mt-1">
                  ※ 未指定のカードやデッキ順は、このSeedを用いて決定論的に補完されます。
                </p>
              </div>

              {/* 進行設定 (Turn Player & Chance Player のみ設定) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-zinc-50 rounded-xl border border-zinc-200 font-mono">
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">Turn Player:</label>
                  <select
                    value={turnPlayer}
                    onChange={(e) => setTurnPlayer(e.target.value as "p1" | "p2")}
                    className="w-full text-xs font-bold p-2 rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:outline-none"
                  >
                    <option value="p1">Player A (p1)</option>
                    <option value="p2">Player B (p2)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">Chance Player:</label>
                  <select
                    value={chancePlayer}
                    onChange={(e) => setChancePlayer(e.target.value as "p1" | "p2")}
                    className="w-full text-xs font-bold p-2 rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:outline-none"
                  >
                    <option value="p1">Player A (p1)</option>
                    <option value="p2">Player B (p2)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">Turn Count:</label>
                  <input
                    type="number"
                    min="1"
                    value={turnCount}
                    onChange={(e) => setTurnCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full text-xs font-bold p-2 rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:outline-none"
                  />
                </div>
              </div>

              {/* シナリオメタ情報 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-700 font-mono mb-1">シナリオ名 (任意):</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例: 防壁突破局面テスト"
                    className="w-full text-xs font-mono p-2.5 rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-700 font-mono mb-1">説明 (任意):</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="例: 先手兵士2体 vs 後手防壁"
                    className="w-full text-xs font-mono p-2.5 rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:outline-none"
                  />
                </div>
              </div>

              {/* URL 共有・読込 */}
              <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200 flex flex-col gap-3 font-mono">
                <span className="text-xs font-bold text-zinc-800">共有・読込 (Share & Import)</span>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={handleCopyShareUrl}
                    className="px-4 py-2 bg-white border border-zinc-300 hover:bg-zinc-100 text-zinc-900 font-bold text-xs rounded-lg shadow-sm transition"
                  >
                    共有URLをコピー
                  </button>
                </div>
                <div className="flex gap-2 mt-1">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="シナリオ共有URLまたはパラメータを入力..."
                    className="flex-1 text-xs p-2 rounded-lg border border-zinc-300 bg-white text-zinc-900 focus:outline-none"
                  />
                  <button
                    onClick={handleLoadFromUrl}
                    className="px-4 py-2 bg-zinc-950 hover:bg-zinc-800 text-white font-bold text-xs rounded-lg shadow-sm transition"
                  >
                    読込
                  </button>
                </div>
              </div>
            </div>
          )}

          {(activeTab === "p1" || activeTab === "p2") && (
            <PlayerZoneEditor
              playerKey={activeTab}
              hand={activeTab === "p1" ? p1Hand : p2Hand}
              field={activeTab === "p1" ? p1Field : p2Field}
              grave={activeTab === "p1" ? p1Grave : p2Grave}
              onAddCard={(zone, card) => handleAddCard(activeTab, zone, card)}
              onRemoveCard={(zone, idx) => handleRemoveCard(activeTab, zone, idx)}
              onAddUnit={(comp, card, state, face) => handleAddUnit(activeTab, comp, card, state, face)}
              onRemoveUnit={(idx) => handleRemoveUnit(activeTab, idx)}
              deckCards={currentDeckCards}
              components={availableComponents}
            />
          )}

          {/* バリデーション結果表示エリア */}
          <div className="mt-2 p-4 rounded-xl border font-mono text-xs">
            {compileOutcome.type === "READY" ? (
              <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 -m-4 p-4 rounded-xl">
                <span>✅</span>
                <span className="font-bold">
                  バリデーション正常: Canonical 初期盤面を構築可能です (Match ID: {compileOutcome.matchId})
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 text-red-700 bg-red-50 -m-4 p-4 rounded-xl">
                <div className="flex items-center gap-1.5 font-bold">
                  <span>⚠️</span>
                  <span>バリデーションエラー ({compileOutcome.errors.length} 件):</span>
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                  {compileOutcome.errors.map((err, i) => (
                    <li key={i}>
                      <span className="font-bold">[{err.code}]</span> {err.path ? `${err.path}: ` : ""}
                      {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* モーダルフッター */}
        <div className="px-6 py-4 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between font-mono">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-zinc-300 rounded-lg text-zinc-700 text-xs font-bold hover:bg-zinc-100 transition"
          >
            キャンセル
          </button>
          <button
            onClick={handleStart}
            disabled={compileOutcome.type !== "READY"}
            className={`px-6 py-2.5 rounded-xl font-bold text-xs shadow-sm transition flex items-center gap-2 ${
              compileOutcome.type === "READY"
                ? "bg-zinc-950 hover:bg-zinc-800 text-white cursor-pointer"
                : "bg-zinc-200 text-zinc-400 cursor-not-allowed"
            }`}
          >
            <span>⚔️</span>
            <span>Scenario 開始</span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface PlayerZoneEditorProps {
  readonly playerKey: "p1" | "p2";
  readonly hand: readonly ScenarioCardRefV1[];
  readonly field: readonly ScenarioUnitV1[];
  readonly grave: readonly ScenarioCardRefV1[];
  readonly onAddCard: (zone: "hand" | "grave", card: ScenarioCardRefV1) => void;
  readonly onRemoveCard: (zone: "hand" | "grave", index: number) => void;
  readonly onAddUnit: (compId: string, card: ScenarioCardRefV1, state: "charge" | "drive", face: "up" | "down") => void;
  readonly onRemoveUnit: (index: number) => void;
  readonly deckCards: readonly { suit: string; rank: string }[];
  readonly components: readonly { id: string; name?: string; display?: any }[];
}

const PlayerZoneEditor: React.FC<PlayerZoneEditorProps> = ({
  playerKey,
  hand,
  field,
  grave,
  onAddCard,
  onRemoveCard,
  onAddUnit,
  onRemoveUnit,
  deckCards,
  components,
}) => {
  const [selectedSuit, setSelectedSuit] = useState<"S" | "H" | "D" | "C" | "J">("S");
  const [selectedRank, setSelectedRank] = useState<string>("A");
  const [selectedComponentId, setSelectedComponentId] = useState<string>(
    components.length > 0 ? components[0].id : "character.soldier"
  );
  const [selectedState, setSelectedState] = useState<"charge" | "drive">("charge");
  const [selectedFace, setSelectedFace] = useState<"up" | "down">("up");

  const playerName = playerKey === "p1" ? "Player A" : "Player B";

  // 有効なランク一覧（選択中スートに適合するもの）
  const availableRanks = useMemo(() => {
    const ranks = deckCards.filter((c) => c.suit === selectedSuit).map((c) => c.rank);
    return Array.from(new Set(ranks));
  }, [deckCards, selectedSuit]);

  return (
    <div className="flex flex-col gap-6">
      {/* カードセレクター */}
      <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200 flex flex-col gap-3 font-mono text-xs">
        <span className="font-bold text-zinc-800">カード / ユニット追加 ({playerName}):</span>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500 font-bold">Suit:</span>
            <select
              value={selectedSuit}
              onChange={(e) => {
                const s = e.target.value as "S" | "H" | "D" | "C" | "J";
                setSelectedSuit(s);
                const ranks = deckCards.filter((c) => c.suit === s).map((c) => c.rank);
                if (ranks.length > 0 && !ranks.includes(selectedRank)) {
                  setSelectedRank(ranks[0]);
                }
              }}
              className="p-1.5 rounded border border-zinc-300 bg-white font-bold"
            >
              <option value="S">♠ (S)</option>
              <option value="H">♡ (H)</option>
              <option value="D">♢ (D)</option>
              <option value="C">♣ (C)</option>
              {deckCards.some((c) => c.suit === "J") && <option value="J">★ (J)</option>}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500 font-bold">Rank:</span>
            <select
              value={selectedRank}
              onChange={(e) => setSelectedRank(e.target.value)}
              className="p-1.5 rounded border border-zinc-300 bg-white font-bold"
            >
              {availableRanks.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => onAddCard("hand", { suit: selectedSuit, rank: selectedRank })}
            className="px-3 py-1.5 bg-white border border-zinc-300 hover:bg-zinc-100 rounded font-bold shadow-sm"
          >
            + 手札に追加
          </button>

          <button
            onClick={() => onAddCard("grave", { suit: selectedSuit, rank: selectedRank })}
            className="px-3 py-1.5 bg-white border border-zinc-300 hover:bg-zinc-100 rounded font-bold shadow-sm"
          >
            + 墓地に追加
          </button>
        </div>

        {/* ユニット追加設定 */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-zinc-200">
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500 font-bold">Component:</span>
            <select
              value={selectedComponentId}
              onChange={(e) => setSelectedComponentId(e.target.value)}
              className="p-1.5 rounded border border-zinc-300 bg-white font-bold"
            >
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.id}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500 font-bold">State:</span>
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value as "charge" | "drive")}
              className="p-1.5 rounded border border-zinc-300 bg-white font-bold"
            >
              <option value="charge">Charge</option>
              <option value="drive">Drive</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500 font-bold">Face:</span>
            <select
              value={selectedFace}
              onChange={(e) => setSelectedFace(e.target.value as "up" | "down")}
              className="p-1.5 rounded border border-zinc-300 bg-white font-bold"
            >
              <option value="up">表 (Up)</option>
              <option value="down">裏 (Down)</option>
            </select>
          </div>

          <button
            onClick={() =>
              onAddUnit(selectedComponentId, { suit: selectedSuit, rank: selectedRank }, selectedState, selectedFace)
            }
            className="px-3 py-1.5 bg-zinc-950 text-white hover:bg-zinc-800 rounded font-bold shadow-sm"
          >
            + フィールドにユニット配置
          </button>
        </div>
      </div>

      {/* ゾーンごとの配置一覧表示 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-xs">
        {/* 手札 */}
        <div className="p-3 bg-white rounded-xl border border-zinc-200 flex flex-col gap-2">
          <div className="flex items-center justify-between border-b pb-1.5">
            <span className="font-bold text-zinc-800">手札 (Hand: {hand.length}枚)</span>
          </div>
          {hand.length === 0 ? (
            <span className="text-zinc-400 italic text-[11px]">指定なし</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {hand.map((c, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded font-bold text-zinc-800"
                >
                  {c.suit}{c.rank}
                  <button
                    onClick={() => onRemoveCard("hand", i)}
                    className="text-zinc-400 hover:text-red-600 font-bold text-[10px]"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* フィールドユニット */}
        <div className="p-3 bg-white rounded-xl border border-zinc-200 flex flex-col gap-2">
          <div className="flex items-center justify-between border-b pb-1.5">
            <span className="font-bold text-zinc-800">場 (Field: {field.length}体)</span>
          </div>
          {field.length === 0 ? (
            <span className="text-zinc-400 italic text-[11px]">指定なし (初期プリセットなし)</span>
          ) : (
            <div className="flex flex-col gap-1.5">
              {field.map((u, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-2 py-1 bg-zinc-100 border border-zinc-300 rounded font-bold text-zinc-800 text-[11px]"
                >
                  <span>
                    {u.componentId.replace("character.", "")} ({u.card.suit}{u.card.rank}) [{u.state}/{u.face}]
                  </span>
                  <button
                    onClick={() => onRemoveUnit(i)}
                    className="text-zinc-400 hover:text-red-600 font-bold text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 墓地 */}
        <div className="p-3 bg-white rounded-xl border border-zinc-200 flex flex-col gap-2">
          <div className="flex items-center justify-between border-b pb-1.5">
            <span className="font-bold text-zinc-800">墓地 (Grave: {grave.length}枚)</span>
          </div>
          {grave.length === 0 ? (
            <span className="text-zinc-400 italic text-[11px]">空</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {grave.map((c, i) => {
                const isTop = i === grave.length - 1;
                return (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 border rounded font-bold ${
                      isTop
                        ? "bg-amber-50 border-amber-300 text-amber-900"
                        : "bg-zinc-100 border-zinc-300 text-zinc-800"
                    }`}
                  >
                    {c.suit}{c.rank}{isTop ? " (TOP)" : ""}
                    <button
                      onClick={() => onRemoveCard("grave", i)}
                      className="text-zinc-400 hover:text-red-600 font-bold text-[10px]"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
