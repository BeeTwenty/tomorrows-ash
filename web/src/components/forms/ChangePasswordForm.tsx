"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/app/actions";
import { EMPTY_FORM_STATE } from "@/lib/form";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/validation";
import { Field, FormMessage, SubmitButton } from "./Bits";

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, EMPTY_FORM_STATE);

  return (
    <form action={action} className="space-y-5">
      <FormMessage state={state} />

      <Field
        label="Current password"
        name="current"
        type="password"
        autoComplete="current-password"
        required
        maxLength={PASSWORD_MAX}
        error={state.field === "password"}
      />

      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        maxLength={PASSWORD_MAX}
        hint="Changing this signs out every other browser and applies to the game client immediately."
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

      <SubmitButton className="btn w-full">Change password</SubmitButton>
    </form>
  );
}
