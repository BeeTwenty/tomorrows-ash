export function StatTile({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string | null;
  accent?: boolean;
}) {
  return (
    <div className={`panel ${accent ? "panel-warm" : ""} px-4 py-4`}>
      <p className="eyebrow text-[0.625rem]">{label}</p>
      <p
        className={`numeric mt-2 text-2xl leading-none ${accent ? "text-ember" : "text-bone"}`}
      >
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-xs text-ash">{sub}</p> : null}
    </div>
  );
}
