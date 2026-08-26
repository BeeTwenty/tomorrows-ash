import Link from "next/link";
import { RealmPulseLive } from "./RealmPulseLive";
import { env } from "@/lib/env";

const NAV = [
  { href: "/play", label: "Play" },
  { href: "/armory", label: "Armory" },
  { href: "/leaderboards", label: "Rankings" },
  { href: "/status", label: "Realm" },
  { href: "/docs", label: "Wiki" },
  { href: "/patch-notes", label: "Notes" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-edge/70 bg-void/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3.5 sm:px-8">
        <Link href="/" className="group flex items-baseline gap-2.5 whitespace-nowrap">
          <span className="display text-lg tracking-wide text-bone transition-colors group-hover:text-ember">
            Tomorrow&rsquo;s Ash
          </span>
        </Link>

        <nav className="scroll-x -mx-1 flex-1">
          <ul className="flex items-center gap-1 px-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block whitespace-nowrap px-2.5 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ash transition-colors hover:text-bone"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <RealmPulseLive realmName={env.realm.name} />
          <Link
            href="/login"
            className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ash transition-colors hover:text-bone"
          >
            Sign in
          </Link>
          <Link href="/register" className="btn btn-ember !px-4 !py-2 !text-[0.65rem]">
            Register
          </Link>
        </div>
      </div>
    </header>
  );
}
