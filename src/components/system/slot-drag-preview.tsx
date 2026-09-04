import { GripVertical, Move } from "lucide-react";
import { createPortal } from "react-dom";
import "../../styles/slot-drag-preview.css";

export function SlotDragPreview({ position, label, detail, color, targetSlot }: { position: { x: number; y: number } | null; label?: string; detail?: string; color?: string; targetSlot: number | null }) {
  if (!position || !label) return null;
  const left = Math.max(10, Math.min(position.x - 24, window.innerWidth - 128));
  const top = Math.max(10, Math.min(position.y - 18, window.innerHeight - 124));
  return createPortal(<div className="slot-drag-preview" style={{ left, top, "--drag-color": color ?? "#62deea" } as React.CSSProperties} role="status" aria-live="polite">
    <i className="slot-drag-preview__rail" aria-hidden="true"/>
    <span className="slot-drag-preview__header"><small>{targetSlot === null ? "MOVING EFFECT" : `DROP INTO SLOT ${targetSlot + 1}`}</small><GripVertical size={14}/></span>
    <span className="slot-drag-preview__icon"><Move size={19}/></span>
    <span className="slot-drag-preview__copy"><strong>{label}</strong><em>{detail ?? "Signal-chain block"}</em></span>
  </div>, document.body);
}
