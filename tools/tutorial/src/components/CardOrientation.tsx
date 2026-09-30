/** 操作の前に見る、向きだけの凡例。盤面のカード操作とは独立した図。 */
export function CardOrientation() {
  return <figure className="orientation-primer" aria-label="カードの向き：チャージとドライブ">
    <div><span className="orientation-card" aria-hidden="true">♣6</span><span><b>縦＝チャージ</b><small>未使用の目印</small></span></div>
    <div><span className="orientation-card horizontal" aria-hidden="true">♣6</span><span><b>横＝ドライブ</b><small>使用済みの目印</small></span></div>
  </figure>;
}
