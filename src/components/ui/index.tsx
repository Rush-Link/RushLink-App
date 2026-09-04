import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle, X } from "lucide-react";
import { cn } from "../../lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";

const buttonVariants = cva("ui-button", {
  variants: {
    variant: { primary: "ui-button--primary", secondary: "ui-button--secondary", ghost: "ui-button--ghost", danger: "ui-button--danger", outline: "ui-button--outline" },
    size: { sm: "ui-button--sm", md: "ui-button--md", lg: "ui-button--lg" },
  },
  defaultVariants: { variant: "secondary", size: "md" },
});

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { loading?: boolean; asChild?: boolean }>(({ className, variant, size, loading, children, disabled, asChild, type, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} type={asChild ? undefined : type ?? "button"} aria-busy={loading || undefined} disabled={asChild ? undefined : disabled || loading} {...props}>
    {loading && <LoaderCircle size={15} className="spin" />}{children}
  </Comp>;
});
Button.displayName = "Button";

export function IconButton({ label, className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" className={cn("icon-button", className)} aria-label={label} title={label} {...props}>{children}</button>;
}

export function Card({ className, children, interactive, ...props }: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return <div className={cn("card", interactive && "card--interactive", className)} {...props}>{children}</div>;
}

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "cyan" | "violet" | "green" | "amber" | "red" | "blue"; className?: string }) {
  return <span className={cn("badge", `badge--${tone}`, className)}>{children}</span>;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} className={cn("ui-input", className)} {...props} />);
Input.displayName = "Input";

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("ui-select", className)} {...props}>{children}</select>;
}

export function Label({ children, hint, className }: { children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return <label className={cn("ui-label", className)}><span>{children}</span>{hint && <small>{hint}</small>}</label>;
}

export function Switch({ checked, onCheckedChange, label, disabled }: { checked: boolean; onCheckedChange: (checked: boolean) => void; label?: string; disabled?: boolean }) {
  return <SwitchPrimitive.Root checked={checked} onCheckedChange={onCheckedChange} aria-label={label} disabled={disabled} className={cn("switch", checked && "switch--on")}><SwitchPrimitive.Thumb asChild><span /></SwitchPrimitive.Thumb></SwitchPrimitive.Root>;
}

export function Tabs<T extends string>({ value, onValueChange, items, className }: { value: T; onValueChange: (value: T) => void; items: Array<{ value: T; label: string; count?: number }>; className?: string }) {
  return <TabsPrimitive.Root value={value} onValueChange={(next) => onValueChange(next as T)}><TabsPrimitive.List className={cn("tabs", className)}>{items.map((item) => <TabsPrimitive.Trigger className={cn(item.value === value && "active")} key={item.value} value={item.value}>{item.label}{item.count !== undefined && <span>{item.count}</span>}</TabsPrimitive.Trigger>)}</TabsPrimitive.List></TabsPrimitive.Root>;
}

export function Dialog({ open, onClose, title, description, children, footer, width = "520px" }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode; width?: string }) {
  return <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}><DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="dialog-backdrop" />
    <DialogPrimitive.Content className="dialog" style={{ maxWidth: width }}>
      <div className="dialog__header"><div><DialogPrimitive.Title asChild><h2>{title}</h2></DialogPrimitive.Title>{description && <DialogPrimitive.Description asChild><p>{description}</p></DialogPrimitive.Description>}</div><DialogPrimitive.Close asChild><IconButton label="Close"><X size={18} /></IconButton></DialogPrimitive.Close></div>
      <div className="dialog__body">{children}</div>{footer && <div className="dialog__footer">{footer}</div>}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal></DialogPrimitive.Root>;
}

export function EmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-state__icon">{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Progress({ value, tone = "cyan" }: { value: number; tone?: string }) {
  const normalized = Math.max(0, Math.min(100, value));
  return <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={normalized}><span className={`tone-${tone}`} style={{ width: `${normalized}%` }} /></div>;
}

export function Skeleton({ className }: { className?: string }) { return <div className={cn("skeleton", className)} />; }
