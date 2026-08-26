"use client";

import { useActionState } from "react";
import { registerAction } from "@/app/actions";
import { EMPTY_FORM_STATE } from "@/lib/form";
import { PASSWORD_MAX, PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN } from "@/lib/validation";
import { Field, FormMessage, SubmitButton } from "./Bits";

export function RegisterForm({ disabled }: { disabled?: boolean }) {
  const [state, action] = useActionState(registerAction, EMPTY_FORM_STATE);

  return (
    <form action={action} className="space-y-5">
      <FormMessage state={state} />

      <Field
        label="Account name"
        name="username"
        autoComplete="username"
        required
        minLength={USERNAME_MIN}
        maxLength={USERNAME_MAX}
        pattern="[A-Za-z0-9_]+"
        spellCheck={false}
        error={state.field === "username"}
        hint={`${USERNAME_MIN}-${USERNAME_MAX} characters. Letters, numbers and underscores. This is what you type into the game client.`}
      />

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={state.field === "email"}
        hint="Only used to reset your password. Never shown on the site."
      />

      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        maxLength={PASSWORD_MAX}
        error={state.field === "password"}
        hint={`${PASSWORD_MIN}-${PASSWORD_MAX} characters. The 3.3.5a client cannot send more than ${PASSWORD_MAX}, so the limit is real.`}
      />

      <Field
        label="Password again"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        maxLength={PASSWORD_MAX}
      />

      <SubmitButton>{disabled ? "Registration closed" : "Kindle an account"}</SubmitButton>
    </form>
  );
}
