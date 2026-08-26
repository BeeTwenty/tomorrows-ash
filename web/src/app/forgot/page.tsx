import type { Metadata } from "next";
import Link from "next/link";
import { ForgotForm } from "@/components/forms/ForgotForm";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a password reset link for your Ashmorrow account.",
};

export default function ForgotPage() {
  return (
    <div className="mx-auto max-w-md px-5 py-24 sm:px-8">
      <p className="eyebrow">Password reset</p>
      <h1 className="display mt-6 text-4xl text-bone">Lost the way back.</h1>
      <p className="mt-5 text-sm leading-relaxed text-ash">
        Give us the address you registered with and we will send a single-use link. It expires in{" "}
        {env.accounts.resetTokenMinutes} minutes.
      </p>

      <div className="panel mt-8 px-6 py-7">
        <ForgotForm />
      </div>

      <p className="mt-8 text-center text-xs text-ash">
        Remembered it?{" "}
        <Link href="/login" className="text-ember hover:underline">
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}
