/**
 * データを JSON 文字列化し、ブラウザのローカルダウンロードを開始するユーティリティ。
 * 外部ネットワーク送信は一切行わず、ブラウザ DOM/Blob API のみで完結します。
 */
export function downloadJsonFile(filename: string, data: unknown): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
