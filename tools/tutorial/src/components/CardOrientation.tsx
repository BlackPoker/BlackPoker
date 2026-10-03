import { PlayingCard } from "./PlayingCard";
/** 操作の前に見る、向きだけの凡例。盤面のカード操作とは独立した図。 */
export function CardOrientation() {
  return <figure className="orientation-primer" aria-label="カードの向き：チャージとドライブ">
    <div><PlayingCard code="C6" /><span><b>縦＝チャージ</b><small>未使用の目印</small></span></div>
    <div><PlayingCard code="C6" state="drive" /><span><b>横＝ドライブ</b><small>使用済みの目印</small></span></div>
  </figure>;
}
