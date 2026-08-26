"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/app/actions";
import { EMPTY_FORM_STATE } from "@/lib/form";
import { PASSWORD_MAX, USERNAME_MAX } from "@/lib/validation";
import { Field, FormMessage, SubmitButton } from "./Bits";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, EMPTY_FORM_STATE);

  return (
    <form action={action} className="space-y-5">
      <FormMessage state={state} />
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <Field
        label="Account name"
        name="username"
        autoComplete="username"
        required
        maxLength={USERNAME_MAX}
        spellCheck={false}
        error={state.field === "username"}
      />

      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={PASSWORD_MAX}
        error={state.field === "password"}
      />

      <SubmitButton>Sign in</SubmitButton>

      <p className="text-center text-xs text-ash">
        <Link href="/forgot" className="transition-colors hover:text-ember">
          Forgotten your password?
        </Link>
      </p>
    </form>
  );
}
