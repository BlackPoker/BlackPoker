// 正解は教材の operation / before / after のみから得る。ルール判定は行わない。
export function deriveInteractions(step) {
  if (step.interaction?.kind === "action")
    return [{ kind: "action", label: step.interaction.label }];
  return (step.operations || []).flatMap((operation) => operation.cards.map((card) => {
    const source = { player: operation.player, zone: operation.from, card };
    if (step.interaction?.kind === "select-target")
      return { kind: "select-target", source, target: step.interaction.targetCard, operation };
    if (operation.from !== operation.to)
      return { kind: "move-card", source, to: operation.to, operation };
    const before = step.board.before[operation.player][operation.from].find((c) => c.card === card);
    const after = step.board.after[operation.player][operation.to].find((c) => c.card === card);
    return before && after && (before.state !== after.state || before.face !== after.face)
      ? { kind: "tap-card", source, operation } : { kind: "unsupported", source, operation };
  }));
}

// 完了済みの1枚分だけを反映する。元の教材データは変更しない。
export function interactionBoard(step, completed) {
  const commands = deriveInteractions(step);
  if (completed >= commands.length && commands.length) return structuredClone(step.board.after);
  const board = structuredClone(step.board.before);
  for (const command of commands.slice(0, completed)) {
    if (!command.source || command.kind === "select-target") continue;
    const { player, zone, card } = command.source;
    const to = command.kind === "move-card" ? command.to : zone;
    const result = step.board.after[player][to].find((c) => c.card === card);
    if (command.kind === "move-card") {
      board[player][zone] = board[player][zone].filter((c) => c.card !== card);
      board[player][to].push({ ...result });
    } else board[player][zone] = board[player][zone].map((c) => c.card === card ? { ...result } : c);
  }
  return board;
}

export const sameCard = (a, b) => !!a && !!b && a.player === b.player && a.zone === b.zone && a.card === b.card;

// click / keyboard / pointer drop はすべてこの判定を通る。
export function attemptInteraction(command, selected, input) {
  if (!command) return "wrong-source";
  if (input.kind === "action") return command.kind === "action" ? "success" : "wrong-source";
  if (input.kind === "drop") return command.kind === "move-card" && sameCard(command.source, input.source)
    ? (input.player === command.source.player && input.zone === command.to ? "success" : "wrong-target")
    : "wrong-source";
  if (input.kind === "zone") return command.kind === "move-card" && sameCard(selected, command.source)
    ? (input.player === command.source.player && input.zone === command.to ? "success" : "wrong-target")
    : "wrong-source";
  if (input.kind === "card") {
    if (sameCard(selected, input.card)) return "deselect";
    if (command.kind === "move-card" && sameCard(selected, command.source))
      return input.card.player === command.source.player && input.card.zone === command.to ? "success" : "wrong-target";
    if (command.kind === "select-target" && sameCard(selected, command.source))
      return sameCard(command.target, input.card) ? "success" : "wrong-target";
    if (sameCard(command.source, input.card)) return command.kind === "tap-card" ? "success" : "select";
  }
  return "wrong-source";
}
