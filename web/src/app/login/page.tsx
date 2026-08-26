import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/forms/LoginForm";
import { currentAccount } from "@/lib/auth-guard";
import { isDemo } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Ashmorrow account.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  if (await currentAccount()) redirect("/account");
  const { next, reset } = await searchParams;

  return (
    <div className="mx-auto max-w-md px-5 py-24 sm:px-8">
      <p className="eyebrow">Sign in</p>
      <h1 className="display mt-6 text-4xl text-bone">Back to the fire.</h1>

      {reset ? (
        <p className="mt-6 border-l-2 border-edge-warm bg-smoke px-4 py-3 text-sm text-ash-bright">
          Password changed. Sign in with the new one — it works in the game client immediately.
        </p>
      ) : null}

      {isDemo ? (
        <p className="mt-6 border-l-2 border-edge-warm bg-smoke px-4 py-3 text-xs leading-relaxed text-ash">
          <strong className="text-ash-bright">Demo mode.</strong> No realm database is attached, so
          sign-in is switched off.
        </p>
      ) : null}

      <div className="panel mt-8 px-6 py-7">
        <LoginForm next={next} />
      </div>

      <p className="mt-8 text-center text-xs text-ash">
        No account yet?{" "}
        <Link href="/register" className="text-ember hover:underline">
          Create one
        </Link>
        .
      </p>
    </div>
  );
}
