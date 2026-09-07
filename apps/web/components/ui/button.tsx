import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary";
export type ButtonSize = "default" | "lg";

export function buttonVariants(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "default",
  className?: string,
) {
  return cn(
    "inline-flex items-center justify-center rounded-md font-medium transition-colors",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:cursor-wait disabled:opacity-60",
    size === "lg" ? "h-14 w-full px-6 text-base" : "h-11 px-4 text-sm",
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:opacity-90"
      : "border border-border bg-transparent text-foreground hover:bg-card",
    className,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={buttonVariants(variant, size, className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
