"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { deleteProjectAction } from "@/app/actions/index";
import type { Language } from "@/lib/translations";
import { translations } from "@/lib/translations";
import { toast } from "sonner";

interface DeleteProjectModalProps {
  project: any;
  lang: Language;
  onClose: () => void;
  onDeleted: (projectId: string) => void;
}

export function DeleteProjectModal({ project, lang, onClose, onDeleted }: DeleteProjectModalProps) {
  const [confirmInput, setConfirmInput] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const t = translations[lang];

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await deleteProjectAction(project.id);
      if (res.success) {
        onDeleted(project.id);
        onClose();
        toast.success(lang === 'ko' ? '프로젝트가 삭제되었습니다.' : 'Project deleted.');
      }
    } catch (error: any) {
      toast.error(lang === 'ko' ? `삭제 실패: ${error.message}` : `Delete failed: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-md animate-in fade-in" />
      <div className="relative w-full max-w-md rounded-[2.5rem] border-2 border-rose-500/30 bg-card shadow-2xl p-10 animate-in zoom-in-95">
        <div className="flex items-center gap-4 mb-6">
          <div className="h-14 w-14 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center">
            <Trash2 className="h-7 w-7" />
          </div>
          <div>
            <h3 className="text-2xl font-black tracking-tight text-rose-500">{t.projects.deleteConfirmTitle}</h3>
            <p className="text-sm text-muted-foreground font-medium mt-1">{t.projects.deleteConfirmDesc}</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-rose-500/5 border border-rose-500/20 mb-6">
          <p className="text-sm font-black text-rose-600 truncate">{project.title}</p>
        </div>

        <div className="space-y-3 mb-8">
          <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            {t.projects.deleteConfirmLabel}
          </label>
          <input
            type="text"
            autoFocus
            className="w-full px-5 py-4 rounded-2xl border-2 bg-background focus:ring-4 focus:ring-rose-500/10 focus:border-rose-500/50 outline-none transition-all font-bold"
            value={confirmInput}
            onChange={e => setConfirmInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && confirmInput === project.title && handleDelete()}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={onClose}
            className="px-6 py-4 rounded-2xl border font-black uppercase tracking-widest text-[10px] hover:bg-accent transition-all"
          >
            {lang === 'ko' ? '취소' : 'Cancel'}
          </button>
          <button
            onClick={handleDelete}
            disabled={confirmInput !== project.title || isDeleting}
            className="px-6 py-4 rounded-2xl bg-rose-500 text-white font-black uppercase tracking-widest text-[10px] shadow-xl shadow-rose-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-rose-600"
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {t.projects.deleteConfirmBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
