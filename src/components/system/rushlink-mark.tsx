import { cn } from "../../lib/utils";
import { useResolvedTheme } from "../../hooks/use-app-theme";

export const RUSHLINK_BRAND = "RushLink by Cygma Audio";

/** Keep RushLink's original stacked signal mark in both interface themes. */
export function RushLinkMark({ className, title }: { className?: string; title?: string }) {
  const theme = useResolvedTheme();
  return <img className={cn("rushlink-mark", className)} src={theme === "light" ? "/rushlink-mark-light.svg" : "/rushlink-mark.svg"} alt={title ?? ""} aria-hidden={title ? undefined : true}/>;
}

/** Keep the endorsement legible when the workspace changes size. */
export function RushLinkBrand({ className, artwork }: { className?: string; artwork?: "full" | "compact" }) {
  const theme = useResolvedTheme();
  const logo = artwork === "compact" ? "rushlink-compact" : "rushlink-lockup";
  return <span className={cn("rushlink-brand", className)} role="img" aria-label={RUSHLINK_BRAND}>
    {artwork ? <img className="rushlink-brand__artwork" src={`/${logo}${theme === "light" ? "-light" : ""}.svg`} alt="" aria-hidden="true"/> : <><RushLinkMark/>
    <span className="rushlink-brand__name" aria-hidden="true"><small>by <span>Cygma Audio</span></small></span></>}
  </span>;
}
