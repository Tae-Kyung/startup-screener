"use client";

import { useState } from "react";
import { Settings, Loader2, Rocket, ShieldCheck } from "lucide-react";
import { updateProjectSettingsAction, reEvaluateApplicantsAction, getProjectsAction } from "@/app/actions/index";
import { DEFAULT_PROMPT_TEMPLATE } from "@/lib/prompt-defaults";
import type { Language } from "@/lib/translations";
import { translations } from "@/lib/translations";
import { toast } from "sonner";
import { runMigrationAction } from "@/app/actions/index";

interface SettingsModalProps {
  project: any;
  lang: Language;
  onClose: () => void;
  onProjectUpdated: (updated: any) => void;
  onProjectsRefresh: (projects: any[]) => void;
  onReEvaluated: () => void;
}

export function SettingsModal({ project, lang, onClose, onProjectUpdated, onProjectsRefresh, onReEvaluated }: SettingsModalProps) {
  const [criteria, setCriteria] = useState(project.criteria || "");
  const [prompt, setPrompt] = useState(project.prompt || DEFAULT_PROMPT_TEMPLATE);
  const [model, setModel] = useState(project.model || "gpt-4o");
  const [referenceDate, setReferenceDate] = useState(project.reference_date || "");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isReEvaluating, setIsReEvaluating] = useState(false);

  const t = translations[lang];

  const handleSave = async (shouldReEvaluate = false) => {
    setIsUpdating(true);
    try {
      const promptToSave = prompt === DEFAULT_PROMPT_TEMPLATE ? undefined : (prompt || undefined);
      const res = await updateProjectSettingsAction(project.id, {
        criteria,
        prompt: promptToSave,
        model,
        reference_date: referenceDate || undefined,
      });
      if (res.success) {
        const updated = { ...project, criteria, prompt: promptToSave, model, reference_date: referenceDate };
        onProjectUpdated(updated);

        if (shouldReEvaluate) {
          setIsReEvaluating(true);
          try {
            const reEvalRes = await reEvaluateApplicantsAction(project.id);
            if (reEvalRes.success) {
              toast.success(lang === 'ko' ? `${reEvalRes.count}명 재평가 완료.` : `${reEvalRes.count} applicants re-evaluated.`);
              onReEvaluated();
            }
          } catch {
            toast.error(lang === 'ko' ? "재평가 중 오류가 발생했습니다." : "Error during re-evaluation.");
          } finally {
            setIsReEvaluating(false);
          }
        } else {
          toast.success(lang === 'ko' ? "설정이 저장되었습니다." : "Settings saved.");
        }
        onClose();
        const projectsRes = await getProjectsAction();
        if (projectsRes.success) onProjectsRefresh(projectsRes.data);
      }
    } catch (error: any) {
      if (error.code === '42703' || error.code === 'PGRST204' || error.message?.includes('column')) {
        const migRes = await runMigrationAction();
        if (!migRes.success) toast.error(migRes.error || "Schema error");
      } else {
        toast.error(`${lang === 'ko' ? '설정 저장 실패' : 'Save failed'}: ${error.message}`);
      }
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-md animate-in fade-in" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-[2.5rem] border bg-card shadow-2xl p-10 animate-in zoom-in-95">
        <div className="flex items-center gap-4 mb-8">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><Settings className="h-7 w-7" /></div>
          <div>
            <h3 className="text-2xl font-black tracking-tight">{t.projects.settings}</h3>
            <p className="text-sm text-muted-foreground font-medium">{t.projects.settingsDesc}</p>
          </div>
        </div>

        <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
          <div className="space-y-2.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground pl-1">{t.projects.modelLabel}</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'gpt-4o', name: 'ChatGPT (GPT-4o)', icon: <Rocket className="h-4 w-4" /> },
                { id: 'claude-3-5-sonnet-20240620', name: 'Claude 3.5 Sonnet', icon: <ShieldCheck className="h-4 w-4" /> },
              ].map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModel(m.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl border-2 transition-all ${model === m.id ? 'border-primary bg-primary/5 text-primary' : 'border-transparent bg-accent/20 text-muted-foreground hover:bg-accent/40'}`}
                >
                  {m.icon}
                  <span className="text-xs font-bold">{m.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground pl-1">{t.projects.referenceDateLabel}</label>
            <input
              type="date"
              className="w-full px-5 py-4 rounded-2xl border bg-background focus:ring-4 focus:ring-primary/10 outline-none transition-all font-medium text-sm"
              value={referenceDate}
              onChange={e => setReferenceDate(e.target.value)}
            />
            <p className="text-[9px] text-muted-foreground px-1 italic">
              {lang === 'ko' ? '* 만 나이 계산 기준일 (공고일). 미입력 시 업로드 당일 기준.' : '* Age reference date. Defaults to upload date if empty.'}
            </p>
          </div>

          <div className="space-y-2.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground pl-1">{t.projects.criteriaLabel}</label>
            <textarea
              className="w-full h-40 px-5 py-4 rounded-2xl border bg-background focus:ring-4 focus:ring-primary/10 outline-none transition-all font-medium text-sm leading-relaxed resize-none"
              placeholder={t.projects.criteriaPlaceholder}
              value={criteria}
              onChange={e => setCriteria(e.target.value)}
            />
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between pl-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{t.projects.promptLabel}</label>
              <button type="button" onClick={() => setPrompt(DEFAULT_PROMPT_TEMPLATE)} className="text-[9px] font-bold text-primary hover:underline">
                {t.projects.promptResetBtn}
              </button>
            </div>
            <textarea
              className="w-full h-72 px-5 py-4 rounded-2xl border bg-background focus:ring-4 focus:ring-primary/10 outline-none transition-all font-mono text-xs leading-relaxed resize-y"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
            />
            <p className="text-[9px] text-muted-foreground px-1 italic">{t.projects.promptHint}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-8">
          <button
            onClick={() => handleSave(false)}
            disabled={isUpdating || isReEvaluating}
            className="flex-1 px-8 py-3.5 rounded-2xl bg-zinc-100 text-zinc-900 font-bold text-sm hover:bg-zinc-200 transition-all disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            {isUpdating && !isReEvaluating ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : t.projects.saveOnly}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={isUpdating || isReEvaluating}
            className="flex-[1.5] px-8 py-3.5 rounded-2xl bg-primary text-primary-foreground font-black uppercase tracking-widest text-[11px] shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isReEvaluating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {isReEvaluating ? t.projects.reEvaluating : t.projects.saveAndReEval}
          </button>
        </div>
      </div>
    </div>
  );
}
