// 教材の掲載順はルールの分類と分離し、CLIとテストで同じデータを検証する。
export function validateBookLayout(value, lessons) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.tracks)) return ["Invalid book layout"];
  const errors = [];
  const tracks = ["first-game", "learn-more", "reference"];
  if (JSON.stringify(value.tracks.map((t) => t?.id)) !== JSON.stringify(tracks)) errors.push("Invalid book tracks");
  const special = ["about", "game-purpose", "orientation", "first-game-ready", "entry16"];
  const known = new Set([...special, ...lessons.map((l) => l.id)]);
  const seen = new Set();
  for (const track of value.tracks) {
    if (!track || typeof track.title !== "string" || !track.title.trim() || !Array.isArray(track.sectionIds)) {
      errors.push("Invalid book track metadata"); continue;
    }
    for (const id of track.sectionIds) {
      if (!known.has(id)) errors.push("Unknown book section: " + id);
      if (seen.has(id)) errors.push("Duplicate book section: " + id);
      seen.add(id);
      if (track.id === "first-game" && lessons.find((l) => l.id === id)?.status === "pending") errors.push("Pending section in first-game: " + id);
      if (special.includes(id) && track.id !== "first-game") errors.push("Intro/milestone outside first-game: " + id);
    }
  }
  for (const id of known) if (!seen.has(id)) errors.push("Missing book section: " + id);
  const first = value.tracks.find((t) => t?.id === "first-game")?.sectionIds;
  if (Array.isArray(first)) {
    if (first.indexOf("game-purpose") + 1 !== first.indexOf("board-overview")) errors.push("Board must follow game-purpose");
    if (!(first.indexOf("pass-turn") < first.indexOf("first-game-ready") &&
          first.indexOf("first-game-ready") < first.indexOf("entry16") &&
          first.indexOf("entry16") + 1 === first.indexOf("real-game"))) errors.push("Invalid first-game milestone/real order");
  }
  return errors;
}
