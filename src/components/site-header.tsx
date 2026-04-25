"use client";

import { useState } from "react";
import {
  Loader2, Globe, LogOut, FolderOpen, Download, FolderKanban,
  ChevronRight, Plus, Trash2, Settings,
} from "lucide-react";
import type { Language } from "@/lib/translations";
import { translations } from "@/lib/translations";

interface SiteHeaderProps {
  email: string;
  lang: Language;
  selectedProject: any | null;
  hasData: boolean;
  isFolderProcessing: boolean;
  isExporting: boolean;
  isProcessing: boolean;
  folderProgress: { current: number; total: number } | null;
  onLangToggle: () => void;
  onLogout: () => void;
  onExport: () => void;
  onFolderUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  folderInputRef: React.RefObject<HTMLInputElement | null>;
  // mobile project selector
  projects: any[];
  onSelectProject: (p: any) => void;
  onNewProject: () => void;
  onDeleteProject: (e: React.MouseEvent, p: any) => void;
  onSettings: () => void;
}

export function SiteHeader({
  email, lang, selectedProject, hasData,
  isFolderProcessing, isExporting, isProcessing, folderProgress,
  onLangToggle, onLogout, onExport, onFolderUpload, folderInputRef,
  projects, onSelectProject, onNewProject, onDeleteProject, onSettings,
}: SiteHeaderProps) {
  const t = translations[lang];

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between px-4 md:px-6 py-3 border-b bg-background/95 backdrop-blur-sm shrink-0">
      {/* Left: current project name */}
      <div className="flex items-center gap-3 min-w-0">
        {selectedProject ? (
          <div className="min-w-0">
            <div className="text-base font-black tracking-tight leading-none truncate">{selectedProject.title}</div>
            <div className="text-[10px] text-muted-foreground font-medium mt-0.5">{email}</div>
          </div>
        ) : (
          <div>
            <div className="text-base font-black tracking-tight leading-none">{t.dashboard}</div>
            <div className="text-[10px] text-muted-foreground font-medium mt-0.5">{email}</div>
          </div>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        {/* Mobile project selector (md:hidden) */}
        <MobileProjectSelector
          projects={projects}
          selectedProject={selectedProject}
          lang={lang}
          onSelectProject={onSelectProject}
          onNewProject={onNewProject}
          onDeleteProject={onDeleteProject}
        />

        {/* Folder upload */}
        <label className="inline-flex items-center justify-center rounded-xl bg-primary px-3 py-2 text-sm font-black text-primary-foreground shadow-md shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer gap-2">
          {isFolderProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
          <span className="hidden sm:inline">
            {isFolderProcessing
              ? (folderProgress && folderProgress.total > 0 ? `${folderProgress.current}/${folderProgress.total}` : t.folderProcessing)
              : t.folderUploadBtn}
          </span>
          <input
            ref={(el) => {
              (folderInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
              if (el) el.setAttribute('webkitdirectory', '');
            }}
            type="file"
            className="hidden"
            multiple
            onChange={onFolderUpload}
            disabled={isProcessing || isFolderProcessing}
          />
        </label>

        {/* Export */}
        {selectedProject && hasData && (
          <button onClick={onExport} disabled={isExporting} className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-background/50 hover:bg-accent transition-all text-sm font-bold disabled:opacity-50">
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="hidden lg:inline">{lang === 'ko' ? '결과다운로드' : 'Export'}</span>
          </button>
        )}

        {/* Settings (mobile only) */}
        {selectedProject && (
          <button onClick={onSettings} className="md:hidden flex items-center gap-2 px-3 py-2 rounded-xl border bg-background/50 hover:bg-accent transition-all text-sm font-bold">
            <Settings className="h-4 w-4" />
          </button>
        )}

        {/* Language */}
        <button onClick={onLangToggle} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border bg-background/50 backdrop-blur-sm hover:bg-accent transition-all text-xs font-bold">
          <Globe className="h-4 w-4" />
          {lang.toUpperCase()}
        </button>

        {/* Logout */}
        <button onClick={onLogout} className="p-2 rounded-xl border bg-background/50 text-muted-foreground hover:text-rose-500 hover:bg-rose-50 transition-all shadow-sm">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function MobileProjectSelector({
  projects, selectedProject, lang, onSelectProject, onNewProject, onDeleteProject,
}: {
  projects: any[]; selectedProject: any; lang: Language;
  onSelectProject: (p: any) => void; onNewProject: () => void;
  onDeleteProject: (e: React.MouseEvent, p: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const t = translations[lang];

  return (
    <div className="relative md:hidden">
      <button
        onClick={() => setOpen(!open)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-background/50 hover:bg-accent transition-all text-sm font-bold shadow-sm"
      >
        <FolderKanban className="h-4 w-4 text-primary" />
        <span className="max-w-[100px] truncate">{selectedProject?.title || t.projects.title}</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground rotate-90" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-card border rounded-2xl shadow-2xl animate-in zoom-in-95 slide-in-from-top-2 duration-200 z-50 p-2">
          <div className="max-h-60 overflow-auto py-2">
            {projects.map(p => (
              <div key={p.id} className="group relative">
                <button
                  onClick={() => { onSelectProject(p); setOpen(false); }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-3 pr-10 ${selectedProject?.id === p.id ? 'bg-primary/10 text-primary' : 'hover:bg-accent'}`}
                >
                  <div className={`h-2 w-2 rounded-full ${selectedProject?.id === p.id ? 'bg-primary' : 'bg-transparent'}`} />
                  <span className="truncate">{p.title}</span>
                </button>
                <button
                  onClick={e => { onDeleteProject(e, p); setOpen(false); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-muted-foreground/40 hover:text-rose-500 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => { onNewProject(); setOpen(false); }}
            className="w-full mt-2 flex items-center justify-center gap-2 p-3 rounded-xl bg-accent hover:bg-primary/10 hover:text-primary transition-all text-xs font-bold"
          >
            <Plus className="h-3.5 w-3.5" />{t.projects.new}
          </button>
        </div>
      )}
    </div>
  );
}
