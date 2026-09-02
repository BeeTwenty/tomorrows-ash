import Link from "next/link";
import { signOutAction } from "@/app/login/actions";
import { can, type Actor, type Permission } from "@/lib/roles";

/**
 * The panel frame.
 *
 * Navigation is filtered by permission, which is a convenience and nothing
 * more: hiding a link does not protect the page behind it, and every one of
 * those pages calls `requirePermission` for itself. If the two ever disagree,
 * the page wins - that is the whole reason the guard produces the actor rather
 * than inspecting one.
 */
const NAV: { href: string; label: string; permission: Permission }[] = [
  { href: "/", label: "Overview", permission: "realm.view" },
  { href: "/accounts", label: "Accounts", permission: "account.view" },
  { href: "/characters", label: "Characters", permission: "character.view" },
  { href: "/trees", label: "Ability trees", permission: "tree.view" },
  { href: "/items", label: "Itemization", permission: "item.view" },
  { href: "/realm", label: "Realm", permission: "realm.view" },
  { href: "/audit", label: "Audit log", permission: "audit.view.self" },
];

const ROLE_LABEL: Record<Actor["role"], string> = {
  support: "Support",
  gamemaster: "Game master",
  administrator: "Administrator",
  owner: "Owner",
};

export function Shell({ actor, children }: { actor: Actor; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-[var(--color-edge)] bg-[var(--color-soot)]">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-3">
          <Link href="/" className="shrink-0">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-ember)]">
              Ashmorrow
            </span>
            <span className="muted ml-2 text-[0.6875rem] uppercase tracking-[0.18em]">admin</span>
          </Link>

          <nav className="flex flex-1 flex-wrap items-center gap-1">
            {NAV.filter((item) => can(actor, item.permission)).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-2.5 py-1 text-[0.8125rem] text-[var(--color-ash-bright)] hover:bg-[var(--color-raised)] hover:text-[var(--color-bone)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <span className="chip" title={`GM level ${actor.gmLevel}`}>
              {ROLE_LABEL[actor.role]}
            </span>
            <span className="mono text-[var(--color-ash-bright)]">{actor.username}</span>
            <form action={signOutAction}>
              <button type="submit" className="btn px-2.5 py-1 text-xs">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-6">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {description ? <p className="muted mt-0.5 text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
