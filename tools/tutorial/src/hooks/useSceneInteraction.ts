import { useEffect, useState } from "react";
import type { BoardState, TutorialScene, TutorialStep, Zone } from "../types";
import { attemptInteraction, deriveInteractions, interactionBoard } from "../lib/interaction.mjs";
import type { CardLocation, InteractionCommand, InteractionInput } from "../lib/interaction.mjs";
import { cardName } from "../lib/cards";

export const RESULT_MS = 500;
export const zoneNames: Record<Zone, string> = { hand: "手札", soldiers: "兵士", bulwarks: "防壁", life: "ライフ", grave: "墓地" };
export const zoneDescriptions: Record<Zone, string> = {
  hand: "手札：これから使うカードを持ちます。相手には見せません。",
  soldiers: "兵士：攻撃やブロックに使います。",
  bulwarks: "防壁：コストの支払いや防御に使います。",
  life: "ライフ：山札です。一番上から引き、0枚になると負けです。",
  grave: "墓地：使い終わったカードを表向きで置きます。",
};
function visibleName(location: CardLocation, board: BoardState) {
  const card = board[location.player][location.zone].find((c) => c.card === location.card);
  return card?.face === "down" ? location.zone === "life" ? "ライフの一番上" : "裏向きの防壁" : cardName(location.card);
}
function instruction(command: InteractionCommand | undefined, selected: CardLocation | null, board: BoardState) {
  if (!command) return "置き場をタップしてみましょう。";
  if (command.kind === "action") return `「${command.label}」を押してください。`;
  if (selected && command.kind === "move-card") return `PLAYER ${command.source.player}の${zoneNames[command.to]}をタップしてください。`;
  if (selected && command.kind === "select-target") return `${visibleName(command.target, board)}をタップして、ブロックする相手を指定してください。`;
  return `PLAYER ${command.source.player}の${visibleName(command.source, board)}をタップしてください。`;
}
function resultText(command: InteractionCommand, step: TutorialStep, board: BoardState) {
  if (command.kind === "action") return step.learned;
  const name = visibleName(command.source, step.board.before);
  if (command.kind === "select-target") return `${name}が${visibleName(command.target, board)}をブロック。向きはそのままです。`;
  if (command.kind === "move-card") {
    const card = board[command.source.player][command.to].find((c) => c.card === command.source.card);
    return `${step.cause?.phase === "request" ? "コストL：1点ダメージ。" : ""}${card?.face === "up" ? cardName(card.card) : "裏向きのカード"}を${zoneNames[command.to]}へ移しました。`;
  }
  const card = board[command.source.player][command.source.zone].find((c) => c.card === command.source.card);
  return `${step.cause?.phase === "request" ? "コストB" : step.actionName || "状態変更"}：${name}を${card?.state === "drive" ? "ドライブ（横向き）" : "チャージ（縦向き）"}にしました。`;
}
interface State {
  sceneId: string | null; microIndex: number; completedActions: number;
  selected: CardLocation | null; pending: boolean; complete: boolean; hasCompleted: boolean;
  feedback: string; lastResult: string; mistakes: number;
}
const initial = (scene?: TutorialScene): State => ({ sceneId: scene?.id ?? null, microIndex: 0,
  completedActions: 0, selected: null, pending: false, complete: !scene || scene.presentation === "static",
  hasCompleted: !scene || scene.presentation === "static",
  feedback: "", lastResult: "", mistakes: 0 });

export function useSceneInteraction(scene: TutorialScene | undefined, steps: TutorialStep[]) {
  const [state, setState] = useState(() => initial(scene));
  const current = state.sceneId === (scene?.id ?? null) ? state : initial(scene);
  const step = steps[current.microIndex];
  const commands = step ? deriveInteractions(step) : [];
  const board = step ? interactionBoard(step, current.completedActions) : undefined;
  const command = commands[current.completedActions];
  useEffect(() => setState(initial(scene)), [scene?.id]);
  // 時間で操作は行わない。成功した操作の結果を読める間だけ待つ。
  useEffect(() => {
    if (!state.pending || state.sceneId !== scene?.id) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setState((s) => {
      if (!s.pending || s.sceneId !== scene?.id) return s;
      if (s.completedActions < commands.length) return { ...s, pending: false };
      if (s.microIndex + 1 === steps.length) return { ...s, pending: false, complete: true, hasCompleted: true };
      return { ...s, pending: false, microIndex: s.microIndex + 1, completedActions: 0, mistakes: 0 };
    }), reduced ? 300 : RESULT_MS);
    return () => window.clearTimeout(timer);
  }, [state.pending, state.sceneId, state.completedActions, scene?.id, commands.length, steps.length]);

  function attempt(input: InteractionInput) {
    if (scene?.presentation === "static") {
      const zone = input.kind === "zone" ? input.zone : input.kind === "card" ? input.card.zone : undefined;
      if (zone) setState((s) => ({ ...s, feedback: zoneDescriptions[zone] }));
      return;
    }
    if (current.pending || current.complete || !step || !board) return;
    const outcome = attemptInteraction(command, current.selected, input);
    if (outcome === "success") {
      const count = current.completedActions + 1;
      setState({ ...current, completedActions: count, selected: null, pending: true, feedback: "",
        lastResult: resultText(command, step, interactionBoard(step, count)) });
    } else if (outcome === "select") {
      setState({ ...current, selected: input.kind === "card" ? input.card : null, feedback: "" });
    } else if (outcome === "deselect") setState({ ...current, selected: null, feedback: "選択を解除しました。" });
    else setState({ ...current, mistakes: current.mistakes + 1,
      feedback: outcome === "wrong-target" ? instruction(command, "source" in command ? command.source : null, board)
        : `今回は、${instruction(command, null, board)}` });
  }
  return { ...current, step, board, command, commands, attempt,
    applied: current.completedActions === commands.length,
    prompt: board ? instruction(command, current.selected, board) : "",
    replay: () => setState({ ...initial(scene), hasCompleted: current.hasCompleted }) };
}
