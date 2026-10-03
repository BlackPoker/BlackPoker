import type { ReactNode } from "react";
import type { BookSection } from "../data/book";

export function HowToSection({ section, number, completed, onActivate, children }: {
  section: BookSection; number: number; completed: boolean; onActivate: () => void; children: ReactNode;
}) {
  return <section className="howto-section lesson-card" id={section.anchor} data-section-id={section.id}
    aria-labelledby={`${section.anchor}-title`} onPointerDownCapture={onActivate} onFocusCapture={onActivate}>
    <header className="section-heading">
      <span className="section-number">{String(number).padStart(2, "0")}</span>
      <h2 id={`${section.anchor}-title`} tabIndex={-1}>{section.title}</h2>
      {completed && <small className="section-completed">✓ 完了</small>}
    </header>
    {children}
  </section>;
}
