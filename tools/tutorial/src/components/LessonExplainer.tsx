import { useEffect, useRef, useState } from "react";
import type { Explainer, Lesson } from "../data/lessons";
import { ruleCatalog } from "../generated/ruleCatalog";
import { cardName } from "../lib/cards";
import { youtubeEmbed } from "../lib/curriculum-schema.mjs";
import { RuleLinks } from "./RuleLinks";

export function ActionDefinition({ id }: { id: string }) {
  const action = ruleCatalog.actions[id as keyof typeof ruleCatalog.actions];
  return <section className="action-definition"><h3>{action.name}</h3><dl>
    {[["タイミング", action.timing], ["スピード", action.speed], ["コスト", action.cost || "なし"],
      ["キーカード", action.key || "なし"], ["対象", action.target || "なし"],
      ["トリガー", action.trigger], ["誘発条件", action.triggerCondition || "なし"],
      ["使用条件", action.condition || "なし"], ["効果", action.effect]].map(([label, text]) =>
      <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}
  </dl><RuleLinks refs={[`action.${id}`]} /></section>;
}

export function ConceptSlide({ explainer: e }: { explainer: Explainer }) {
  return <section className={`concept-slide presentation-${e.type}`} aria-label={e.title}>
    <h2>{e.title}</h2>
    {e.type === "flow" ? <ol className="concept-flow">{e.items.map((item, index) => <li key={item.title}>
      <span className="concept-number">{index + 1}</span><strong>{item.title}</strong><p>{item.text}</p>
      {index < e.items.length - 1 && <span className="concept-arrow" aria-hidden="true">↓</span>}
    </li>)}</ol> : <p>{e.text}</p>}
    {e.type === "compare" && <div className="concept-compare">{e.characterIds.map((id) => {
      const c = ruleCatalog.characters[id as keyof typeof ruleCatalog.characters];
      return <article key={id}><strong>{c.name}</strong><b>{c.key}</b><p>{c.size}</p><small>{c.labels}</small>
        <p>{c.labels.includes("速攻") ? "出したターンも攻撃できる" : "出したターンは攻撃できない"}</p></article>;
    })}</div>}
    {e.type === "anatomy" && (() => {
      const a = ruleCatalog.actions[e.actionId as keyof typeof ruleCatalog.actions];
      return <div className="anatomy-card"><h3>{a.name}</h3><dl>
        {[["タイミング", a.timing], ["スピード", a.speed], ["コスト", a.cost || "なし"],
          ["キーカード", a.key || "なし"], ["対象", a.target || "なし"], ["効果", e.effectSummary]]
          .map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}
      </dl><small>タイミング＝いつ使えるか／スピード＝どう処理されるか</small></div>;
    })()}
    {e.type === "example" && <div className="concept-example"><div className="example-cards">
      {e.cards.map((card) => <span key={card}>{cardName(card)}</span>)}
    </div><strong>{e.equation}</strong></div>}
  </section>;
}

function VideoDialog({ media, onClose }: { media: NonNullable<Lesson["media"]>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (dialog.current?.showModal) dialog.current.showModal();
    else dialog.current?.setAttribute("open", "");
    return () => previous?.focus();
  }, []);
  return <dialog ref={dialog} className="lesson-video" aria-labelledby="video-title" onCancel={onClose}>
    <header><h2 id="video-title">{media.title}</h2><button autoFocus onClick={onClose}>動画を閉じる</button></header>
    {media.edition === "legacy" && <strong>旧ルールの参考動画 — 現行ルールの正規教材ではありません</strong>}
    <p>{media.note}</p>
    <iframe title={media.title} src={youtubeEmbed(media.url) || undefined} allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
  </dialog>;
}

export function LessonExplainer({ lesson, onStart, onNext, onLesson, prerequisiteTitles }: {
  lesson: Lesson; onStart: () => void; onNext: () => void; onLesson: (id: string) => void;
  prerequisiteTitles: { id: string; title: string }[];
}) {
  const [video, setVideo] = useState(false);
  return <div className="lesson-explainer">
    <small>見る → 触る → 理解する</small>
    <h1>{lesson.title}</h1><p className="instruction">{lesson.shortDescription}</p>
    {lesson.status === "pending" && <p className="pending-notice"><b>準備中</b> カード操作はまだ利用できません。解説と公式ルールは確認できます。</p>}
    {lesson.status === "reading" && <p className="pending-notice">ミニ解説のみ公開中。魔法の操作Lessonは準備中です。</p>}
    {lesson.explainer && <ConceptSlide explainer={lesson.explainer} />}
    {lesson.status === "ready" && <><p className="fixture-note">{lesson.realStepIds ? "ここから実物カードを使います。" : "実物カードは不要です。このLesson用の盤面から始めます。"}</p>
      <button className="primary-button" onClick={onStart}>{lesson.realStepIds ? "実物カードを準備する" : "やってみる"} →</button></>}
    {lesson.status === "reading" && <button className="primary-button" onClick={onNext}>読み終えて次へ →</button>}
    {lesson.media && <button className="lesson-media-button" onClick={() => setVideo(true)}>動画で見る</button>}
    {prerequisiteTitles.length > 0 && <details className="lesson-prerequisites"><summary>先に見ると分かりやすいLesson（移動は自由）</summary>
      {prerequisiteTitles.map((item) => <button key={item.id} onClick={() => onLesson(item.id)}>{item.title}</button>)}
    </details>}
    <details className="lesson-definitions"><summary>解説を見る</summary>
      {[...new Set([...lesson.actionIds, ...lesson.reviewActionIds, ...lesson.ruleRefs.filter((r) => r.startsWith("action.")).map((r) => r.slice(7))])]
        .map((id) => <ActionDefinition key={id} id={id} />)}
      <RuleLinks refs={lesson.ruleRefs} />
    </details>
    {video && lesson.media && <VideoDialog media={lesson.media} onClose={() => setVideo(false)} />}
  </div>;
}
