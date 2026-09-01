import { useState, useEffect } from "react";

/**
 * メディアクエリの適合状態を返すカスタムフック。
 * SSR / テスト環境（window なし、または matchMedia なし）でも安全に動作する。
 */
export function useMediaQuery(query: string, defaultValue = false): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia(query).matches;
    }
    return defaultValue;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const handler = (e: MediaQueryListEvent) => {
      setMatches(e.matches);
    };

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    } else if (typeof (mql as any).addListener === "function") {
      (mql as any).addListener(handler);
      return () => (mql as any).removeListener(handler);
    }
  }, [query]);

  return matches;
}

export function useIsDesktop(): boolean {
  // Tailwind の lg ブレークポイント (1024px)
  return useMediaQuery("(min-width: 1024px)", true);
}
