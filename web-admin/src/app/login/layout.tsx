export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-12">
      <header>
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ember)]">
          Ashmorrow
        </p>
        <h1 className="mt-1 text-lg font-semibold">Operator panel</h1>
      </header>
      {children}
      <footer className="muted mt-10 text-[0.6875rem]">
        Every sign-in, successful or not, is recorded with the address it came from.
      </footer>
    </div>
  );
}
