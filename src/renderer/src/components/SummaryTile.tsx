export function SummaryTile({
  label,
  value
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex min-h-[104px] flex-col justify-between rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase leading-4 tracking-wide text-slate-500 [overflow-wrap:anywhere]">
        {label}
      </p>
      <p className="mt-2 break-words text-xl font-semibold leading-tight tracking-normal text-slate-950">
        {value}
      </p>
    </div>
  );
}
