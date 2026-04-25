"use client";

import { useState } from "react";
import {
  ShieldCheck, Plus, Trash2, FolderKanban, BarChart3, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Language } from "@/lib/translations";
import { translations } from "@/lib/translations";

interface AppSidebarProps {
  projects: any[];
  selectedProject: any | null;
  lang: Language;
  onSelectProject: (p: any) => void;
  onNewProject: () => void;
  onDeleteProject: (e: React.MouseEvent, p: any) => void;
  onSettings: () => void;
  collapsed?: boolean;
}

export function AppSidebar({
  projects, selectedProject, lang, onSelectProject,
  onNewProject, onDeleteProject, onSettings, collapsed,
}: AppSidebarProps) {
  const t = translations[lang];

  return (
    <aside className={cn(
      "hidden md:flex flex-col border-r bg-sidebar text-sidebar-foreground shrink-0 transition-all duration-300",
      collapsed ? "w-16" : "w-64",
    )}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b">
        <div className="h-8 w-8 rounded-xl bg-sidebar-primary/10 text-sidebar-primary flex items-center justify-center shrink-0">
          <ShieldCheck className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-sm font-black tracking-tight leading-none">{t.dashboard}</div>
            <div className="text-[10px] text-muted-foreground font-medium mt-0.5">AI Screening</div>
          </div>
        )}
      </div>

      {/* Projects */}
      <div className="flex-1 overflow-auto py-2">
        <div className="px-3 py-2">
          {!collapsed && (
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{t.projects.title}</span>
              <span className="text-[10px] font-bold text-muted-foreground bg-sidebar-accent px-1.5 py-0.5 rounded">{projects.length}</span>
            </div>
          )}
          <div className="space-y-0.5">
            {projects.map(p => (
              <div key={p.id} className="group relative">
                <button
                  onClick={() => onSelectProject(p)}
                  className={cn(
                    "w-full text-left rounded-lg transition-colors flex items-center gap-2",
                    collapsed ? "px-2 py-2 justify-center" : "px-3 py-2 pr-9",
                    selectedProject?.id === p.id
                      ? "bg-sidebar-primary/10 text-sidebar-primary font-bold"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <FolderKanban className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate text-sm">{p.title}</span>}
                </button>
                {!collapsed && (
                  <button
                    onClick={e => onDeleteProject(e, p)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground/30 hover:text-rose-500 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* New Project */}
        <div className="px-3 mt-1">
          <button
            onClick={onNewProject}
            className={cn(
              "w-full flex items-center gap-2 rounded-lg border border-dashed border-sidebar-border hover:border-sidebar-primary hover:text-sidebar-primary transition-all text-muted-foreground",
              collapsed ? "px-2 py-2 justify-center" : "px-3 py-2 text-xs font-bold"
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            {!collapsed && t.projects.new}
          </button>
        </div>
      </div>

      {/* Bottom: Settings */}
      {selectedProject && (
        <div className="border-t px-3 py-2">
          <button
            onClick={onSettings}
            className={cn(
              "w-full flex items-center gap-2 rounded-lg hover:bg-sidebar-accent transition-colors text-muted-foreground hover:text-sidebar-accent-foreground",
              collapsed ? "px-2 py-2 justify-center" : "px-3 py-2 text-sm font-medium"
            )}
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!collapsed && t.projects.settings}
          </button>
        </div>
      )}
    </aside>
  );
}
