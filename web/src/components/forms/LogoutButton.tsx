import { logoutAction } from "@/app/actions";

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button type="submit" className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ash transition-colors hover:text-ember">
        Sign out
      </button>
    </form>
  );
}
