import type { InputHTMLAttributes, ReactNode } from "react";
import { Input } from "./input";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
};

export function Field({ label, hint, ...props }: FieldProps) {
  return (
    <label className="grid gap-2 text-sm text-foreground">
      <span className="font-medium">{label}</span>
      <Input {...props} />
      {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
    </label>
  );
}
