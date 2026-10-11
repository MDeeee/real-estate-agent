import type { DocumentStatus, IngestResult } from "@/lib/admin-schemas";

const tones = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-border/60 text-muted",
} as const;

type Tone = keyof typeof tones;

function Badge({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

const statusTone: Record<DocumentStatus, Tone> = {
  INDEXED: "success",
  PENDING: "warning",
  FAILED: "danger",
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  return <Badge tone={statusTone[status]}>{status}</Badge>;
}

const outcomeTone: Record<IngestResult["outcome"], Tone> = {
  created: "success",
  updated: "success",
  unchanged: "neutral",
  failed: "danger",
};

export function OutcomeBadge({ outcome }: { outcome: IngestResult["outcome"] }) {
  return <Badge tone={outcomeTone[outcome]}>{outcome}</Badge>;
}
