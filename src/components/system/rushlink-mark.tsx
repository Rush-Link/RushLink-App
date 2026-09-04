import { useId } from "react";
import { cn } from "../../lib/utils";

export function RushLinkMark({ className, title }: { className?: string; title?: string }) {
  const instanceId = useId().replace(/:/g, "");
  const rushGradient = `${instanceId}-rush`;
  const linkGradient = `${instanceId}-link`;
  const rushMask = `${instanceId}-rush-cut`;
  const linkMask = `${instanceId}-link-cut`;

  return <svg className={cn("rushlink-mark", className)} viewBox="118 205 814 600" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
    <defs>
      <linearGradient id={rushGradient} x1="180" y1="280" x2="860" y2="500" gradientUnits="userSpaceOnUse"><stop stopColor="#eefeff"/><stop offset=".55" stopColor="#bceef4"/><stop offset="1" stopColor="#87cad9"/></linearGradient>
      <linearGradient id={linkGradient} x1="170" y1="560" x2="870" y2="790" gradientUnits="userSpaceOnUse"><stop stopColor="#61e8e5"/><stop offset=".5" stopColor="#58a8ff"/><stop offset="1" stopColor="#9b78ff"/></linearGradient>
      <mask id={rushMask}><rect width="1024" height="1024" fill="#fff"/><path d="M152 433L875 370" stroke="#000" strokeWidth="17"/></mask>
      <mask id={linkMask}><rect width="1024" height="1024" fill="#fff"/><path d="M151 706L877 643" stroke="#000" strokeWidth="17"/></mask>
    </defs>
    <g className="rushlink-mark__words" transform="skewX(-5)" fontFamily="Bahnschrift, Arial Narrow, sans-serif" fontWeight="800" textAnchor="middle">
      <text x="548" y="493" fontSize="263" textLength="720" lengthAdjust="spacingAndGlyphs" fill={`url(#${rushGradient})`} mask={`url(#${rushMask})`}>RUSH</text>
      <text x="548" y="766" fontSize="263" textLength="720" lengthAdjust="spacingAndGlyphs" fill={`url(#${linkGradient})`} mask={`url(#${linkMask})`}>LINK</text>
    </g>
    <path className="rushlink-mark__signal-bars" d="M178 538h118M728 538h118"/>
  </svg>;
}
