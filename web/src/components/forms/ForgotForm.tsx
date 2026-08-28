"use client";

import { useActionState } from "react";
import { forgotAction } from "@/app/actions";
import { EMPTY_FORM_STATE } from "@/lib/form";
import { Field, FormMessage, SubmitButton } from "./Bits";

export function ForgotForm() {
  const [state, action] = useActionState(forgotAction, EMPTY_FORM_STATE);

  return (
    <form action={action} className="space-y-5">
      <FormMessage state={state} />

      {state.done ? null : (
        <>
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            error={state.field === "email"}
            hint="The address you registered with."
          />
          <SubmitButton>Send a reset link</SubmitButton>
        </>
      )}
    </form>
  );
}
