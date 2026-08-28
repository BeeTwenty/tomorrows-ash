"use client";

import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/form";

export function SubmitButton({ children, className = "btn btn-ember w-full" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function Field({
  label,
  name,
  type = "text",
  hint,
  error,
  ...rest
}: {
  label: string;
  name: string;
  type?: string;
  hint?: string;
  error?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <label className="block">
      <span className="eyebrow text-[0.625rem]">{label}</span>
      <input
        {...rest}
        id={name}
        name={name}
        type={type}
        aria-describedby={hintId}
        aria-invalid={error || undefined}
        className={`field mt-2 ${error ? "border-ember-dim" : ""}`}
      />
      {hint ? (
        <span id={hintId} className="mt-1.5 block text-[0.7rem] leading-relaxed text-ash/70">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="border-l-2 border-ember-dim bg-ember/5 px-3 py-2 text-sm text-bone">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p role="status" className="border-l-2 border-edge-warm bg-smoke px-3 py-2 text-sm text-ash-bright">
        {state.notice}
      </p>
    );
  }
  return null;
}
