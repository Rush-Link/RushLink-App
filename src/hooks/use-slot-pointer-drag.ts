import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type SlotDragSource = string | number;

export function useSlotPointerDrag<T extends SlotDragSource>(onDrop: (source: T, targetSlot: number) => void, canDrop: (source: T, targetSlot: number) => boolean = () => true) {
  const [dragSource, setDragSource] = useState<T | null>(null);
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const [pointerPosition, setPointerPosition] = useState<{ x: number; y: number } | null>(null);
  const origin = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const source = useRef<T | null>(null);
  const active = useRef(false);
  const suppressClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);

  const targetAt = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-chain-slot]");
    const slot = Number.parseInt(element?.dataset.chainSlot ?? "", 10);
    return Number.isInteger(slot) ? slot : null;
  };

  const reset = () => {
    cleanup.current?.();
    cleanup.current = null;
    origin.current = null;
    source.current = null;
    active.current = false;
    setDragSource(null);
    setDragTarget(null);
    setPointerPosition(null);
  };

  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, value: T, disabled = false) => {
    if (disabled || event.button !== 0 || (event.target as HTMLElement).closest("[data-no-chain-drag]")) return;
    cleanup.current?.();
    origin.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    source.current = value;
    active.current = false;
    const pointerId = event.pointerId;
    let latestTarget: number | null = null;
    const move = (next: PointerEvent) => {
      if (!origin.current || source.current === null || next.pointerId !== pointerId) return;
      if (!active.current && Math.hypot(next.clientX - origin.current.x, next.clientY - origin.current.y) < 6) return;
      if (!active.current) {
        active.current = true;
        setDragSource(source.current);
      }
      next.preventDefault();
      setPointerPosition({ x: next.clientX, y: next.clientY });
      const candidate = targetAt(next.clientX, next.clientY);
      latestTarget = candidate !== null && canDrop(source.current, candidate) ? candidate : null;
      setDragTarget(latestTarget);
    };
    const complete = (clientX: number, clientY: number, preventDefault: () => void) => {
      if (!origin.current || source.current === null) return;
      const currentSource = source.current;
      if (active.current) {
        preventDefault();
        suppressClick.current = true;
        window.setTimeout(() => { suppressClick.current = false; }, 0);
        const candidate = targetAt(clientX, clientY);
        const target = candidate !== null && canDrop(currentSource, candidate) ? candidate : latestTarget;
        if (target !== null) onDrop(currentSource, target);
      }
      reset();
    };
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      complete(next.clientX, next.clientY, () => next.preventDefault());
    };
    const finishMouse = (next: MouseEvent) => complete(next.clientX, next.clientY, () => next.preventDefault());
    const cancel = (next: PointerEvent) => { if (next.pointerId === pointerId) reset(); };
    window.addEventListener("pointermove", move, { passive: false, capture: true });
    window.addEventListener("pointerup", finish, { passive: false, capture: true });
    window.addEventListener("mouseup", finishMouse, { passive: false, capture: true });
    window.addEventListener("pointercancel", cancel, true);
    cleanup.current = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("mouseup", finishMouse, true);
      window.removeEventListener("pointercancel", cancel, true);
    };
  };
  const consumeClick = () => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  };

  return { dragSource, dragTarget, pointerPosition, onPointerDown, consumeClick };
}
