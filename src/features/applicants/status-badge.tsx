import { cn } from "@/lib/utils";

const colorMap: Record<string, string> = {
  Pass: 'bg-emerald-500/10 text-emerald-600',
  Fail: 'bg-rose-500/10 text-rose-600',
  Approved: 'bg-emerald-500/10 text-emerald-600',
  Rejected: 'bg-rose-500/10 text-rose-600',
  Pending: 'bg-orange-500/10 text-orange-600',
};

export function StatusBadge({ status }: { status: string | undefined }) {
  const s = status || 'Pending';
  return (
    <span className={cn("px-2 py-0.5 rounded text-[9px] font-black uppercase", colorMap[s] || colorMap['Pending'])}>
      {s}
    </span>
  );
}
