"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { createProjectAction } from "@/app/actions/index";
import type { Language } from "@/lib/translations";
import { translations } from "@/lib/translations";

interface CreateProjectModalProps {
  lang: Language;
  onClose: () => void;
  onCreated: (project: any) => void;
}

export function CreateProjectModal({ lang, onClose, onCreated }: CreateProjectModalProps) {
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const t = translations[lang];

  const handleCreate = async () => {
    if (!title.trim()) return;
    setIsCreating(true);
    try {
      const res = await createProjectAction(title);
      if (res.success) {
        onCreated(res.data);
        onClose();
      }
    } catch (e) {
      console.error("Failed to create project", e);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-md animate-in fade-in" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-[2.5rem] border bg-card shadow-2xl p-10 animate-in zoom-in-95 text-center">
        <h3 className="text-3xl font-black tracking-tight mb-2">{t.projects.new}</h3>
        <div className="space-y-6 text-left mt-8">
          <div className="space-y-2.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground pl-1">Project Title</label>
            <input
              type="text"
              autoFocus
              placeholder={t.projects.placeholder}
              className="w-full px-5 py-4 rounded-2xl border bg-background focus:ring-4 focus:ring-primary/10 outline-none transition-all font-bold text-lg"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mt-12">
          <button onClick={onClose} className="px-6 py-4 rounded-2xl border font-black uppercase tracking-widest text-[10px] hover:bg-accent transition-all">
            {lang === 'ko' ? '취소' : 'Cancel'}
          </button>
          <button
            onClick={handleCreate}
            disabled={!title.trim() || isCreating}
            className="px-6 py-4 rounded-2xl bg-primary text-primary-foreground font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {t.projects.create}
          </button>
        </div>
      </div>
    </div>
  );
}
