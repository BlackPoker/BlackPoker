import { useEffect, useState } from "react";
import type { TutorialScene } from "../types";

export const PREVIEW_MS = 450;
export const RESULT_MS = 900;

interface Playback {
  sceneId: string | null;
  microIndex: number;
  applied: boolean;
  complete: boolean;
}

const initial = (scene?: TutorialScene): Playback => ({
  sceneId: scene?.id ?? null,
  microIndex: 0,
  applied: scene?.presentation === "static" || !scene,
  complete: scene?.presentation === "static" || !scene,
});

export function useScenePlayback(scene?: TutorialScene) {
  const [state, setState] = useState(() => initial(scene));
  const playback = state.sceneId === (scene?.id ?? null) ? state : initial(scene);

  useEffect(() => setState(initial(scene)), [scene?.id]);
  useEffect(() => {
    if (!scene || state.sceneId !== scene.id || state.complete) return;
    const timer = window.setTimeout(() => setState((current) => {
      if (current.sceneId !== scene.id) return current;
      if (!current.applied) return { ...current, applied: true };
      if (current.microIndex + 1 < scene.stepIds.length)
        return { ...current, microIndex: current.microIndex + 1, applied: false };
      return { ...current, complete: true };
    }), state.applied ? RESULT_MS : PREVIEW_MS);
    return () => window.clearTimeout(timer);
  }, [scene, state]);

  return { ...playback, replay: () => setState(initial(scene)) };
}
