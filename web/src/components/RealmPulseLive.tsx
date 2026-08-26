"use client";

import { useEffect, useState } from "react";

interface Pulse {
  online: boolean;
  playersOnline: number;
}

/**
 * The realm's heartbeat in the header.
 *
 * It is fetched from the browser rather than rendered on the server so that
 * every static page - the wiki, the patch notes - stays static. Until the
 * first response arrives the header simply shows the realm name, which is
 * also what a visitor with JavaScript disabled sees.
 */
export function RealmPulseLive({ realmName }: { realmName: string }) {
  const [pulse, setPulse] = useState<Pulse | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as Pulse;
        if (!cancelled) setPulse({ online: Boolean(data.online), playersOnline: Number(data.playersOnline) || 0 });
      } catch {
        // A realm that cannot be reached simply keeps the neutral header.
      }
    };

    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <a href="/status" className="flex items-center gap-2 whitespace-nowrap" title={`${realmName} realm status`}>
      <span
        className={pulse ? (pulse.online ? "pulse pulse-live" : "pulse pulse-dead") : "pulse pulse-dead"}
        aria-hidden="true"
      />
      <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ash">
        {realmName}
        {pulse?.online ? <span className="ml-2 text-ash-bright">{pulse.playersOnline}</span> : null}
      </span>
    </a>
  );
}
