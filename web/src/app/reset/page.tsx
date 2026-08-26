import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "@/components/forms/ResetForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="mx-auto max-w-md px-5 py-24 sm:px-8">
      <p className="eyebrow">Password reset</p>
      <h1 className="display mt-6 text-4xl text-bone">Choose a new one.</h1>

      {token ? (
        <>
          <p className="mt-5 text-sm leading-relaxed text-ash">
            This link works once. Setting a new password also signs out every browser that was using
            the old one.
          </p>
          <div className="panel mt-8 px-6 py-7">
            <ResetForm token={token} />
          </div>
        </>
      ) : (
        <>
          <p className="mt-5 text-sm leading-relaxed text-ash">
            This page needs the link from your reset email. Open that link directly, or request a new
            one.
          </p>
          <Link href="/forgot" className="btn mt-8">
            Request a reset link
          </Link>
        </>
      )}
    </div>
  );
}
