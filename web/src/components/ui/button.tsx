import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-foreground hover:opacity-90",
  secondary:
    "border border-border bg-surface text-foreground hover:bg-border/40",
  danger: "bg-danger text-background hover:opacity-90",
  ghost: "text-muted hover:bg-border/40 hover:text-foreground",
};

export function buttonClass(variant: Variant = "secondary"): string {
  return `${base} ${variants[variant]}`;
}

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`${buttonClass(variant)} ${className}`.trim()}
      {...props}
    />
  );
}
