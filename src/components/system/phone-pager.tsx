import { Children, useEffect, useId, useRef, useState, type ReactNode } from "react";

const scrollBehavior = (): ScrollBehavior => window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.querySelector(".reduce-motion") ? "instant" : "smooth";

/** Scrolls actual content rather than remounting it, preserving edits and focus. */
export function PhonePager({ children, labels, label }: { children: ReactNode; labels?: string[]; label: string }) {
  const items = Children.toArray(children);
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const id = useId();
  const current = Math.max(0, Math.min(active, items.length - 1));
  const activeRef = useRef(current);
  activeRef.current = current;
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    let touching = false;
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (touching || !element.clientWidth) return;
        const left = Math.round(element.scrollLeft / element.clientWidth) * element.clientWidth;
        if (Math.abs(left - element.scrollLeft) > 1) element.scrollTo({ left, behavior: scrollBehavior() });
      }, 160);
    };
    const sync = () => {
      const width = element.clientWidth;
      if (width) setActive(Math.round(element.scrollLeft / width));
      settle();
    };
    const touchStart = () => { touching = true; clearTimeout(timer); };
    const touchEnd = () => { touching = false; settle(); };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      element.scrollLeft = activeRef.current * element.clientWidth;
    });
    resize?.observe(element);
    element.addEventListener("scroll", sync, { passive: true });
    element.addEventListener("touchstart", touchStart, { passive: true });
    element.addEventListener("touchend", touchEnd, { passive: true });
    element.addEventListener("touchcancel", touchEnd, { passive: true });
    return () => {
      clearTimeout(timer); resize?.disconnect(); element.removeEventListener("scroll", sync);
      element.removeEventListener("touchstart", touchStart); element.removeEventListener("touchend", touchEnd); element.removeEventListener("touchcancel", touchEnd);
    };
  }, [items.length]);
  const go = (index: number) => {
    const element = track.current;
    if (!element) return;
    element.scrollTo({ left: index * element.clientWidth, behavior: scrollBehavior() });
  };
  const start = Math.max(0, Math.min(current - 2, items.length - 5));
  return <div className="phone-pager">
    {items.length > 1 && <nav className="phone-pager__navigation" aria-label={`${label} pages`}>
      <span aria-live="polite">{labels?.[current] ?? label} <small>{current + 1}/{items.length}</small></span>
      <div>{items.slice(start, start + 5).map((_, offset) => { const index = start + offset; return <button key={index} type="button" aria-label={`Show ${labels?.[index] ?? `${label} ${index + 1}`}`} aria-current={index === current ? "page" : undefined} aria-controls={`${id}-${index}`} onClick={() => go(index)}><i/></button>; })}</div>
    </nav>}
    <div className="phone-pager__track" ref={track}>
      {items.map((child, index) => <div className="phone-pager__page" id={`${id}-${index}`} key={(child as { key?: string }).key ?? index}>{child}</div>)}
    </div>
  </div>;
}
