import { validateRuleRef } from "./schema.mjs";

export function youtubeEmbed(url) {
  try {
    const value = new URL(url);
    if (value.protocol !== "https:" || value.username || value.password || value.port) return null;
    const id = value.hostname === "youtu.be" ? value.pathname.slice(1) :
      ["www.youtube.com", "youtube.com"].includes(value.hostname) && value.pathname === "/watch" ? value.searchParams.get("v") : null;
    return /^[\w-]{11}$/.test(id || "") ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  } catch { return null; }
}

export function validateCurriculum(value, catalog, scenarios) {
  const errors = [];
  const text = (v) => typeof v === "string" && v.trim().length > 0;
  const strings = (v) => Array.isArray(v) && v.every(text) && new Set(v).size === v.length;
  if (!value || value.schemaVersion !== 1 || !text(value.id) || !text(value.title) ||
      !Array.isArray(value.categories) || !Array.isArray(value.lessons) || !value.lessons.length)
    return ["Invalid curriculum schema"];
  const categories = new Set(value.categories.map((c) => c?.id));
  if (categories.size !== value.categories.length || value.categories.some((c) => !text(c?.id) || !text(c?.title))) errors.push("Invalid categories");
  const ids = new Set(value.lessons.map((l) => l?.id));
  if (ids.size !== value.lessons.length) errors.push("Duplicate lesson id");
  const scenes = scenarios.flatMap((s) => s.scenes.map((scene) => scene.id));
  const real = scenarios.flatMap((s) => s.steps.filter((step) => step.mode === "real").map((step) => step.id));
  const lite = catalog.formats.lite.actions;
  const owners = new Map();
  const usedScenes = new Set();
  for (const l of value.lessons) {
    if (!l || ![l.id, l.title, l.shortDescription].every(text)) { errors.push("Invalid lesson text"); continue; }
    if (!categories.has(l.category) || !["beginner", "intermediate", "advanced"].includes(l.difficulty) || !["ready", "reading", "pending"].includes(l.status)) errors.push("Invalid lesson metadata: " + l.id);
    for (const key of ["prerequisites", "sceneIds", "actionIds", "reviewActionIds", "ruleRefs", "cards"])
      if (!strings(l[key])) errors.push("Invalid lesson " + key + ": " + l.id);
    if (l.realStepIds !== undefined && !strings(l.realStepIds)) errors.push("Invalid realStepIds");
    if (l.sceneIds?.length > 1 || (l.sceneIds?.length && l.realStepIds?.length)) errors.push("Lesson must use one scene or real steps");
    for (const id of Array.isArray(l.prerequisites) ? l.prerequisites : []) if (!ids.has(id) || id === l.id) errors.push("Invalid prerequisite: " + id);
    for (const id of Array.isArray(l.sceneIds) ? l.sceneIds : []) {
      if (!scenes.includes(id)) errors.push("Unknown scene: " + id);
      if (usedScenes.has(id)) errors.push("Duplicate scene assignment: " + id);
      usedScenes.add(id);
    }
    for (const id of Array.isArray(l.realStepIds) ? l.realStepIds : []) if (!real.includes(id)) errors.push("Unknown real step: " + id);
    if (Array.isArray(l.realStepIds) && JSON.stringify(l.realStepIds) !== JSON.stringify(real)) errors.push("Real lesson must preserve the ordered setup sequence");
    if (l.status === "ready" && !l.sceneIds?.length && !l.realStepIds?.length) errors.push("Ready lesson requires interaction: " + l.id);
    if (l.status !== "ready" && (l.sceneIds?.length || l.realStepIds?.length)) errors.push("Non-ready lesson cannot own interactions");
    for (const id of Array.isArray(l.actionIds) ? l.actionIds : []) {
      if (!lite.includes(id)) errors.push("Unknown Lite action: " + id);
      if (owners.has(id)) errors.push("Duplicate action owner: " + id);
      owners.set(id, l.id);
    }
    for (const id of Array.isArray(l.reviewActionIds) ? l.reviewActionIds : [])
      if (!lite.includes(id) || (Array.isArray(l.actionIds) && l.actionIds.includes(id))) errors.push("Invalid review action: " + id);
    for (const ref of Array.isArray(l.ruleRefs) ? l.ruleRefs : []) {
      const error = validateRuleRef(ref, catalog); if (error) errors.push(error);
    }
    const e = l.explainer;
    if (l.status === "reading" && !e) errors.push("Reading lesson requires explainer");
    if (e !== undefined && (!e || typeof e !== "object")) errors.push("Invalid explainer");
    if (e) {
      if (!text(e.title) || !["flow", "anatomy", "compare", "example"].includes(e.type)) errors.push("Invalid explainer type/title");
      if (e.type === "flow" && (!Array.isArray(e.items) || !e.items.length || e.items.some((i) => !text(i?.title) || !text(i?.text)))) errors.push("Invalid flow");
      if (e.type === "anatomy" && (!lite.includes(e.actionId) || !text(e.effectSummary))) errors.push("Invalid anatomy action/summary");
      if (e.type === "compare" && (!strings(e.characterIds) || !e.characterIds.length || e.characterIds.some((id) => !catalog.characters[id]?.formats.includes("lite")))) errors.push("Invalid compare characters");
      if (e.type !== "flow" && !text(e.text)) errors.push("Invalid explainer text");
      if (e.type === "example" && (!text(e.equation) || !strings(e.cards) || !e.cards.length)) errors.push("Invalid example");
    }
    if (l.media !== undefined && (!l.media || l.media.type !== "youtube" || !youtubeEmbed(l.media.url) || !text(l.media.title) || !text(l.media.note) || !["current", "legacy"].includes(l.media.edition))) errors.push("Invalid media");
  }
  for (const id of lite) if (!owners.has(id)) errors.push("Missing Lite coverage: " + id);
  const visiting = new Set(), visited = new Set();
  function walk(id) {
    if (visiting.has(id)) { errors.push("Cyclic prerequisite: " + id); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    const l = value.lessons.find((item) => item?.id === id);
    if (Array.isArray(l?.prerequisites)) l.prerequisites.filter((p) => ids.has(p)).forEach(walk);
    visiting.delete(id); visited.add(id);
  }
  ids.forEach(walk);
  return [...new Set(errors)];
}
