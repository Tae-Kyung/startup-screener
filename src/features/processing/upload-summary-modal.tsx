"use client";

import { CheckCircle2 } from "lucide-react";
import type { Language } from "@/lib/translations";
import { translations } from "@/lib/translations";

export interface UploadSummary {
  total: number;
  newCount: number;
  duplicateCount: number;
  pass: number;
  fail: number;
  pending: number;
}

interface UploadSummaryModalProps {
  summary: UploadSummary;
  lang: Language;
  onClose: () => void;
}

export function UploadSummaryModal({ summary, lang, onClose }: UploadSummaryModalProps) {
  const t = translations[lang];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-md animate-in fade-in" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-[2.5rem] border bg-card shadow-2xl p-10 animate-in zoom-in-95">
        <div className="flex items-center gap-4 mb-8">
          <div className="h-14 w-14 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h3 className="text-2xl font-black tracking-tight">{t.uploadSummary.title}</h3>
        </div>

        <div className="space-y-3 mb-8">
          {[
            { label: t.uploadSummary.total, value: summary.total, color: 'text-foreground' },
            { label: t.uploadSummary.newCount, value: summary.newCount, color: 'text-primary' },
            { label: t.uploadSummary.duplicateCount, value: summary.duplicateCount, color: 'text-muted-foreground' },
            { label: t.uploadSummary.pass, value: summary.pass, color: 'text-emerald-500' },
            { label: t.uploadSummary.fail, value: summary.fail, color: 'text-rose-500' },
            { label: t.uploadSummary.pending, value: summary.pending, color: 'text-orange-500' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center justify-between p-3 rounded-xl bg-accent/20">
              <span className="text-sm font-bold text-muted-foreground">{label}</span>
              <span className={`text-lg font-black ${color}`}>{value}</span>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full px-8 py-4 rounded-2xl bg-primary text-primary-foreground font-black uppercase tracking-widest text-[11px] shadow-xl shadow-primary/20 hover:scale-[1.02] transition-all"
        >
          {t.uploadSummary.confirm}
        </button>
      </div>
    </div>
  );
}
