/**
 * クリップボードにテキストをコピーするUIユーティリティ。
 * navigator.clipboard および execCommand のフォールバックを持ち、決して例外をスローしません。
 * 成功した場合は true、失敗した場合は false を返します。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  // 1. モダンな Clipboard API の試行
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    // フォールバックへ移行
  }

  // 2. document.execCommand("copy") によるフォールバック
  try {
    if (typeof document !== "undefined" && document.createElement) {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      // 画面外に配置してスクロールや視覚的乱れを防止
      textArea.style.position = "fixed";
      textArea.style.top = "0";
      textArea.style.left = "-9999px";
      textArea.style.opacity = "0";
      textArea.setAttribute("readonly", "");
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textArea);
      return success;
    }
  } catch (_) {
    // 失敗
  }

  return false;
}
