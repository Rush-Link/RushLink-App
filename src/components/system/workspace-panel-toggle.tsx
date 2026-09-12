import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button, IconButton } from "../ui";
import { cn } from "../../lib/utils";
import { restoreWorkspacePanelFocus } from "../../hooks/use-workspace-panel";

interface WorkspacePanelToggleProps {
  open: boolean;
  onToggle: () => void;
  controls: string;
  label: string;
  className?: string;
  compact?: boolean;
}

export function WorkspacePanelToggle({ open, onToggle, controls, label, className, compact = false }: WorkspacePanelToggleProps) {
  const name = `${open ? "Hide" : "Show"} ${label.toLowerCase()}`;
  const Icon = open ? PanelRightClose : PanelRightOpen;
  const toggle = () => {
    if (open) restoreWorkspacePanelFocus(controls);
    onToggle();
  };
  const props = {
    "aria-expanded": open,
    "aria-controls": controls,
    "data-workspace-panel-toggle": true,
    className: cn("workspace-panel-toggle", className),
    onClick: toggle,
  };

  if (compact) return <IconButton {...props} label={name}><Icon size={17} aria-hidden="true"/></IconButton>;
  return <Button {...props} variant={open ? "outline" : "secondary"} aria-label={name} title={name}><Icon size={17} aria-hidden="true"/><span>{label}</span></Button>;
}
