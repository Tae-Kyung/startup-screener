"use client";

import { Loader2 } from "lucide-react";
import type { Language } from "@/lib/translations";
import { translations } from "@/lib/translations";

interface ProgressBannerProps {
  progress: { current: number; total: number; taskNumber: string; skipped: number };
  lang: Language;
}

export function ProgressBanner({ progress, lang }: ProgressBannerProps) {
  const t = translations[lang];
  const pct = Math.round((progress.current / progress.total) * 100);

  return (
    <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 flex items-center gap-4">
      <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-black text-primary">
          {t.folderProgress(progress.current, progress.total, progress.taskNumber, progress.skipped)}
        </p>
        <div className="mt-2 h-1.5 rounded-full bg-primary/10 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className="text-xs font-black text-primary/60 shrink-0">{pct}%</span>
    </div>
  );
}
