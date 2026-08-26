import type { AccountField } from "./accounts";

/** Shared shape for every account form's `useActionState` value. */
export interface FormState {
  error?: string;
  field?: AccountField;
  notice?: string;
  done?: boolean;
}

export const EMPTY_FORM_STATE: FormState = {};
