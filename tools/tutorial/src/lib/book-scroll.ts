export function scrollToSection(anchor: string, smooth = true) {
  const element = document.getElementById(anchor);
  if (!element) return;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView?.({ behavior: smooth && !reduced ? "smooth" : "auto", block: "start" });
  element.querySelector<HTMLElement>("h2[tabindex], h3[tabindex]")?.focus({ preventScroll: true });
}
