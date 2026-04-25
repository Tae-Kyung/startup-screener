"use client";

import { useState } from "react";
import { X, Loader2, CheckCheck, XCircle, ClipboardCheck } from "lucide-react";
import { ApplicantData } from "@/lib/excel-utils";
import { finalizeApplicantAction } from "@/app/actions/index";
import { StatusBadge } from "./status-badge";
import type { Language } from "@/lib/translations";
import { translations } from "@/lib/translations";
import { toast } from "sonner";

interface ApplicantDetailProps {
  applicant: ApplicantData;
  lang: Language;
  onClose: () => void;
  onUpdate: (updated: ApplicantData) => void;
}

export function ApplicantDetail({ applicant, lang, onClose, onUpdate }: ApplicantDetailProps) {
  const [modalTab, setModalTab] = useState<'reasoning' | 'raw' | 'finalize'>('reasoning');
  const [finalizeComment, setFinalizeComment] = useState("");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const t = translations[lang];

  const handleFinalize = async (finalStatus: 'Approved' | 'Rejected') => {
    if (!finalizeComment.trim()) return;
    setIsFinalizing(true);
    try {
      await finalizeApplicantAction(applicant.id, finalStatus, finalizeComment);
      const now = new Date().toISOString();
      const updated = { ...applicant, finalStatus, confirmComment: finalizeComment, confirmedAt: now };
      onUpdate(updated);
      setFinalizeComment("");
      toast.success(lang === 'ko' ? '확정 처리 완료' : 'Finalization complete');
    } catch (error: any) {
      toast.error(lang === 'ko' ? `확정 처리 실패: ${error.message}` : `Finalization failed: ${error.message}`);
    } finally {
      setIsFinalizing(false);
    }
  };

  return (
    <div className="w-[440px] shrink-0 rounded-2xl border bg-card shadow-xl flex flex-col overflow-hidden animate-in slide-in-from-right-4 duration-300">
      {/* Header */}
      <div className="p-5 border-b bg-accent/20 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-black text-lg shrink-0">
            {applicant.name.charAt(0)}
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-black tracking-tight truncate">{applicant.name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{applicant.taskNumber}</span>
              {applicant.historyType && (
                <>
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                  <span className="text-[10px] font-black text-primary uppercase tracking-widest">{applicant.historyType}</span>
                </>
              )}
            </div>
            <div className="flex gap-1.5 mt-1.5">
              <StatusBadge status={applicant.llmStatus} />
              <StatusBadge status={applicant.finalStatus} />
            </div>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl hover:bg-accent transition-all shrink-0">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b text-[10px] font-black uppercase tracking-[0.2em] shrink-0">
        {(['reasoning', 'finalize', 'raw'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setModalTab(tab)}
            className={`flex-1 px-3 py-3 border-b-2 transition-all ${modalTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {tab === 'reasoning'
              ? (lang === 'ko' ? 'AI 근거' : 'AI Reasoning')
              : tab === 'finalize'
                ? (lang === 'ko' ? '확정' : 'Finalize')
                : (lang === 'ko' ? '원본' : 'Raw')}
            {tab === 'finalize' && applicant.finalStatus === 'Pending' && (
              <span className="ml-1 px-1 py-0.5 rounded bg-orange-500/20 text-orange-500 text-[8px]">!</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-5">
        {modalTab === 'reasoning' && <ReasoningTab applicant={applicant} lang={lang} />}
        {modalTab === 'finalize' && (
          <div className="space-y-5 animate-in slide-in-from-left-4 duration-300">
            <div className="p-4 rounded-xl bg-accent/20 border space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{t.details.finalizeDesc}</p>
              <div className="flex items-center gap-2">
                <StatusBadge status={applicant.finalStatus} />
                {applicant.confirmedAt && (
                  <span className="text-[10px] text-muted-foreground">
                    {t.details.alreadyFinalized}{new Date(applicant.confirmedAt).toLocaleString('ko-KR')}
                  </span>
                )}
              </div>
              {applicant.confirmComment && (
                <div className="p-3 rounded-xl bg-background/50 border text-sm italic text-foreground/80">
                  &quot;{applicant.confirmComment}&quot;
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{t.details.finalizeComment}</label>
              <textarea
                className="w-full h-24 px-4 py-3 rounded-xl border bg-background focus:ring-4 focus:ring-primary/10 outline-none transition-all font-medium text-sm resize-none"
                placeholder={t.details.finalizeCommentPlaceholder}
                value={finalizeComment}
                onChange={e => setFinalizeComment(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleFinalize('Approved')}
                disabled={!finalizeComment.trim() || isFinalizing}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500 text-white font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isFinalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                {t.details.approveBtn}
              </button>
              <button
                onClick={() => handleFinalize('Rejected')}
                disabled={!finalizeComment.trim() || isFinalizing}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-rose-500 text-white font-black text-xs uppercase tracking-widest shadow-lg shadow-rose-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isFinalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                {t.details.rejectBtn}
              </button>
            </div>
          </div>
        )}

        {modalTab === 'raw' && (
          <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
            <div className="rounded-xl border bg-accent/5 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-accent/30 border-b">
                  <tr className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    <th className="px-4 py-2.5 border-r">Key</th>
                    <th className="px-4 py-2.5">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-muted/10 font-medium">
                  {applicant.raw
                    ? Object.entries(applicant.raw).map(([k, v]) => (
                      <tr key={k} className="hover:bg-accent/20">
                        <td className="px-4 py-2.5 border-r font-black text-primary/60">{k}</td>
                        <td className="px-4 py-2.5 truncate max-w-[200px]" title={String(v)}>{String(v)}</td>
                      </tr>
                    ))
                    : <tr><td colSpan={2} className="px-4 py-8 text-center italic opacity-50">No raw data.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReasoningTab({ applicant, lang }: { applicant: ApplicantData; lang: Language }) {
  let reasoningText = applicant.llmReasoning || '';
  let checkpoints: Array<{ criterion: string; document: string; finding: string; result: string }> | null = null;
  try {
    const parsed = JSON.parse(reasoningText);
    if (parsed?.checkpoints) {
      reasoningText = parsed.reasoning || '';
      checkpoints = parsed.checkpoints;
    }
  } catch { /* plain text */ }

  const resultColor = (r: string) =>
    r === '적합' ? 'bg-emerald-500/10 text-emerald-600'
    : r === '부적합' ? 'bg-rose-500/10 text-rose-600'
    : 'bg-orange-500/10 text-orange-600';

  return (
    <div className="space-y-4 animate-in slide-in-from-left-4 duration-300">
      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 rounded-xl bg-accent/20 border text-center">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">AI (LLM)</p>
          <StatusBadge status={applicant.llmStatus} />
        </div>
        <div className="p-3 rounded-xl bg-accent/20 border text-center">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Final</p>
          <StatusBadge status={applicant.finalStatus} />
        </div>
      </div>

      {checkpoints && checkpoints.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-4 w-[3px] bg-primary rounded-full" />
            <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              {lang === 'ko' ? '서류 검토 체크포인트' : 'Document Checkpoints'}
            </h4>
          </div>
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-accent/40 border-b">
                <tr className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2 text-left">{lang === 'ko' ? '항목' : 'Item'}</th>
                  <th className="px-2 py-2 text-left">{lang === 'ko' ? '서류' : 'Doc'}</th>
                  <th className="px-2 py-2 text-left">{lang === 'ko' ? '확인내용' : 'Finding'}</th>
                  <th className="px-2 py-2 text-center">{lang === 'ko' ? '결과' : 'Result'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-muted/10">
                {checkpoints.map((cp, idx) => (
                  <tr key={idx} className="hover:bg-accent/10 transition-colors">
                    <td className="px-2 py-2 font-bold text-foreground text-[10px]">{cp.criterion}</td>
                    <td className="px-2 py-2 text-muted-foreground text-[10px]">{cp.document}</td>
                    <td className="px-2 py-2 text-foreground/80 text-[10px]">{cp.finding}</td>
                    <td className="px-2 py-2 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${resultColor(cp.result)}`}>
                        {cp.result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-4 w-[3px] bg-primary rounded-full" />
          <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            {lang === 'ko' ? '종합 판단 근거' : 'Summary'}
          </h4>
        </div>
        <div className="p-4 rounded-xl bg-accent/20 border-l-4 border-primary">
          <p className="text-sm font-medium leading-relaxed text-foreground/90 italic">
            &quot;{reasoningText || (lang === 'ko' ? '분석 데이터가 없습니다.' : 'No reasoning available.')}&quot;
          </p>
        </div>
      </div>
    </div>
  );
}
