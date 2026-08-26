"use client";

import { useActionState } from "react";
import { resetAction } from "@/app/actions";
import { EMPTY_FORM_STATE } from "@/lib/form";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/validation";
import { Field, FormMessage, SubmitButton } from "./Bits";

export function ResetForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetAction, EMPTY_FORM_STATE);

  return (
    <form action={action} className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="token" value={token} />

      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        maxLength={PASSWORD_MAX}
        error={state.field === "password"}
        hint={`${PASSWORD_MIN}-${PASSWORD_MAX} characters.`}
      />

      <Field
        label="New password again"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        maxLength={PASSWORD_MAX}
      />

      <SubmitButton>Set the new password</SubmitButton>
    </form>
  );
}
