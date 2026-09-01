import { Shell } from "@/components/Shell";
import { requireSession } from "@/lib/authz";

/**
 * Every page inside this group is behind a live, fully-authenticated session.
 *
 * The layout's guard is not what protects them - a layout in the App Router is
 * not a reliable authorisation point, because a client-side navigation can
 * render a page without re-running it. Each page calls the guard itself. This
 * one exists so the frame knows who it is drawing for.
 */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requireSession();
  return <Shell actor={actor}>{children}</Shell>;
}
