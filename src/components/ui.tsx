import type { ReactNode } from 'react';

const TONES = {
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  sky: 'bg-sky-100 text-sky-700',
  gray: 'bg-gray-100 text-gray-700',
} as const;
type Tone = keyof typeof TONES;

const STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'green' },
  on_leave: { label: 'On leave', tone: 'sky' },
  resigned: { label: 'Resigned', tone: 'gray' },
  present: { label: 'Present', tone: 'green' },
  late: { label: 'Late', tone: 'amber' },
  absent: { label: 'Absent', tone: 'red' },
  pending: { label: 'Pending', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
  not_in: { label: 'Not in yet', tone: 'amber' },
  upcoming: { label: 'Upcoming', tone: 'gray' },
  no_record: { label: 'No record', tone: 'gray' },
};

export const EMPLOYMENT_LABEL: Record<string, string> = {
  regular: 'Regular', probationary: 'Probationary', contractual: 'Contractual',
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: 'gray' as Tone };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[s.tone]}`}>
      {s.label}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-white ${className}`}>{children}</div>;
}

export function Avatar({ first, last, size = 'size-9 text-xs' }: { first: string; last: string; size?: string }) {
  return (
    <div className={`${size} shrink-0 rounded-full bg-violet-tint text-violet-text grid place-items-center font-semibold`}>
      {first[0]}{last[0]}
    </div>
  );
}

export const btnPrimary =
  'inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60';
export const btnSecondary =
  'inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-field bg-white px-4 text-sm font-semibold text-ink hover:border-violet-300';
export const inputCls =
  'h-11 w-full rounded-[10px] border border-field bg-white px-3.5 text-[15px] outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100';

export const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
export const fmtMonth = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
export const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) : '—';
export const fmtHours = (inIso: string | null, outIso: string | null) => {
  if (!inIso || !outIso) return '—';
  const mins = Math.max(0, Math.round((Date.parse(outIso) - Date.parse(inIso)) / 60_000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
};

export const statusLabel = (s: string) => STATUS[s]?.label ?? s;
export const peso = (n: number) =>
  `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;