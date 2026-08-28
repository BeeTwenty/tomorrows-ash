import Link from "next/link";
import { EmberRule } from "./EmberRule";

const COLUMNS = [
  {
    title: "Play",
    links: [
      { href: "/register", label: "Create an account" },
      { href: "/play", label: "Connect to Ashmorrow" },
      { href: "/status", label: "Realm status" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/docs/classless", label: "What classless means" },
      { href: "/docs/getting-started", label: "Getting started" },
      { href: "/docs", label: "The wiki" },
    ],
  },
  {
    title: "Follow",
    links: [
      { href: "/patch-notes", label: "Patch notes" },
      { href: "/armory", label: "Armory" },
      { href: "/leaderboards", label: "Rankings" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24">
      <EmberRule />
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="display text-xl text-bone">Tomorrow&rsquo;s Ash</p>
            <p className="cryptic mt-3 text-sm">Everything burns. Something chooses to stay.</p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="eyebrow">{column.title}</p>
              <ul className="mt-4 space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-ash transition-colors hover:text-bone">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 space-y-2 border-t border-edge/60 pt-6 text-xs leading-relaxed text-ash/80">
          <p>
            Built on{" "}
            <a
              href="https://github.com/azerothcore/azerothcore-wotlk"
              className="text-ash transition-colors hover:text-ember"
              rel="noreferrer noopener"
              target="_blank"
            >
              AzerothCore
            </a>{" "}
            (AGPL-3.0). Our source lives at{" "}
            <a
              href="https://github.com/BeeTwenty/tomorrows-ash"
              className="text-ash transition-colors hover:text-ember"
              rel="noreferrer noopener"
              target="_blank"
            >
              BeeTwenty/tomorrows-ash
            </a>
            .
          </p>
          <p>
            World of Warcraft is a trademark of Blizzard Entertainment. This project is not affiliated with
            or endorsed by Blizzard, ships no Blizzard content, and requires you to supply your own game
            client.
          </p>
        </div>
      </div>
    </footer>
  );
}
