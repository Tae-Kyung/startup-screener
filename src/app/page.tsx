"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, Rocket, ChevronRight, FolderOpen, Plus, AlertCircle } from "lucide-react";
import {
  getProjectsAction, getProjectApplicantsAction,
  runMigrationAction, getSignedUploadUrlsAction, syncExcelDataAction,
  cleanupStorageAction, prefetchForProcessingAction, exportCheckpointsAction,
} from "./actions/index";
import { ApplicantData } from "@/lib/excel-utils";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { User } from "@supabase/supabase-js";
import { toast } from "sonner";

import { type Language, translations } from "@/lib/translations";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { ApplicantTable } from "@/features/applicants/applicant-table";
import { ApplicantDetail } from "@/features/applicants/applicant-detail";
import { StatsCards } from "@/features/analytics/stats-cards";
import { SettingsModal } from "@/features/projects/settings-modal";
import { CreateProjectModal } from "@/features/projects/create-project-modal";
import { DeleteProjectModal } from "@/features/projects/delete-project-modal";
import { UploadSummaryModal, type UploadSummary } from "@/features/processing/upload-summary-modal";
import { ProgressBanner } from "@/features/processing/progress-banner";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<ApplicantData[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lang, setLang] = useState<Language>('ko');
  const [selectedApplicant, setSelectedApplicant] = useState<ApplicantData | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);

  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [schemaError, setSchemaError] = useState<{ message: string; sql: string } | null>(null);

  const [deleteConfirmProject, setDeleteConfirmProject] = useState<any | null>(null);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const [isFolderProcessing, setIsFolderProcessing] = useState(false);
  const [folderProgress, setFolderProgress] = useState<{ current: number; total: number; taskNumber: string; skipped: number } | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setIsSessionLoading(false);
      if (session?.user) loadProjects();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProjects();
        runMigrationAction().then(res => {
          if (!res.success) setSchemaError({ message: res.error as string, sql: (res as any).sql });
        });
      } else {
        setProjects([]);
        setSelectedProject(null);
        setData([]);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const loadProjects = async () => {
    try {
      const res = await getProjectsAction();
      if (res.success) {
        setProjects(res.data || []);
        if (res.data?.length && !selectedProject) {
          const savedId = localStorage.getItem('selectedProjectId');
          const toSelect = (savedId && res.data.find((p: any) => p.id === savedId)) || res.data[0];
          handleSelectProject(toSelect);
        }
      }
    } catch (e) {
      console.error("Failed to load projects", e);
    }
  };

  const handleSelectProject = async (project: any) => {
    setSelectedProject(project);
    localStorage.setItem('selectedProjectId', project.id);
    setIsProjectLoading(true);
    try {
      const res = await getProjectApplicantsAction(project.id);
      if (res.success) setData(res.data);
    } catch (e) {
      console.error("Failed to load applicants", e);
    } finally {
      setIsProjectLoading(false);
    }
  };

  const handleDeleteProject = (e: React.MouseEvent, project: any) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteConfirmProject(project);
  };

  const handleLogout = async () => { await supabase.auth.signOut(); };

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (!selectedProject) {
      toast.warning(lang === 'ko' ? "먼저 프로젝트를 생성하거나 선택해주세요." : "Please create or select a project first.");
      return;
    }

    let excelFile: File | null = null;
    const taskGroups = new Map<string, File[]>();

    for (const file of files) {
      const path = (file as any).webkitRelativePath || file.name;
      const parts = path.replace(/\\/g, '/').split('/');
      const basename = parts[parts.length - 1];

      if (basename.endsWith('.xlsx')) {
        excelFile = file;
      } else if (basename.endsWith('.pdf') && parts.length >= 2) {
        let taskNumber = '';
        for (let i = parts.length - 2; i >= 0; i--) {
          const m = parts[i].match(/^\d*\.?\s*\(?(\d{5,})\)?/);
          if (m) { taskNumber = m[1]; break; }
        }
        if (!taskNumber) {
          const folderName = parts[parts.length - 2];
          taskNumber = folderName.match(/^\(?(\d+)\)?/)?.[1] ?? folderName.replace(/_.*$/, '');
        }
        if (!taskGroups.has(taskNumber)) taskGroups.set(taskNumber, []);
        taskGroups.get(taskNumber)!.push(file);
      }
    }

    const taskNumbers = Array.from(taskGroups.keys());
    if (taskNumbers.length === 0) {
      toast.warning(lang === 'ko' ? "PDF 파일이 있는 과제번호 폴더를 찾을 수 없습니다." : "No task folders with PDFs found.");
      return;
    }

    const pdfCount = Array.from(taskGroups.values()).reduce((sum, arr) => sum + arr.length, 0);
    const confirmMsg = lang === 'ko'
      ? `${taskNumbers.length}개 과제, PDF ${pdfCount}개를 AI 심사하시겠습니까?`
      : `Start AI screening for ${taskNumbers.length} tasks (${pdfCount} PDFs)?`;
    if (!confirm(confirmMsg)) return;

    setIsFolderProcessing(true);
    setFolderProgress({ current: 0, total: taskNumbers.length, taskNumber: '', skipped: 0 });

    let pass = 0, fail = 0, pending = 0, skipped = 0;
    let completed = 0;

    const toBase64 = (file: File): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

    try {
      const { error: sessionError } = await supabase.auth.refreshSession();
      if (sessionError) { toast.error('세션이 만료되었습니다. 페이지를 새로고침한 후 다시 시도해주세요.'); return; }

      await cleanupStorageAction().catch(() => {});

      const sharedExcelBase64 = excelFile ? await toBase64(excelFile) : null;
      let excelDataByTask: Record<string, any> = {};
      if (sharedExcelBase64) {
        const syncResult = await syncExcelDataAction(sharedExcelBase64, selectedProject.id).catch(() => ({ updated: 0, excelDataByTask: {} }));
        excelDataByTask = syncResult.excelDataByTask;
      }

      const { project: prefetchedProject, existingMap } = await prefetchForProcessingAction(taskNumbers, selectedProject.id);

      const alreadyDoneSet = new Set(
        Object.entries(existingMap)
          .filter(([, r]) => r.llm_status === 'Pass' || r.llm_status === 'Fail')
          .map(([tn]) => tn)
      );
      if (alreadyDoneSet.size > 0) { skipped += alreadyDoneSet.size; completed += alreadyDoneSet.size; }

      const CONCURRENCY = 4;
      const queue = taskNumbers.filter(t => !alreadyDoneSet.has(t));

      const processTask = async (taskNumber: string) => {
        try {
          const allPdfFiles = taskGroups.get(taskNumber)!;
          const pdfFiles = [...allPdfFiles]
            .sort((a, b) => { const aStd = /^\d/.test(a.name) ? 0 : 1; const bStd = /^\d/.test(b.name) ? 0 : 1; if (aStd !== bStd) return aStd - bStd; return a.size - b.size; })
            .slice(0, 20);

          const paths = pdfFiles.map((file, idx) => {
            const ext = file.name.lastIndexOf('.') >= 0 ? file.name.slice(file.name.lastIndexOf('.')) : '.pdf';
            return `${user!.id}/${taskNumber}/${Date.now()}_${idx}${ext}`;
          });
          const signedUrls = await getSignedUploadUrlsAction(paths);

          const pdfPaths = await Promise.all(pdfFiles.map(async (file, idx) => {
            const { token, path: storagePath } = signedUrls[idx];
            let uploadError: any = null;
            for (let attempt = 0; attempt < 3; attempt++) {
              if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
              const { error } = await supabase.storage.from('pdf-temp').uploadToSignedUrl(storagePath, token, file);
              if (!error) { uploadError = null; break; }
              uploadError = error;
            }
            if (uploadError) throw new Error(`PDF 업로드 실패 (${file.name}): ${uploadError.message}`);
            return { name: file.name, storagePath };
          }));

          const resp = await fetch(`/api/process-dataset?projectId=${selectedProject.id}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskNumber, excelData: excelDataByTask[taskNumber] ?? null, pdfPaths, prefetched: { project: prefetchedProject, existing: existingMap[taskNumber] ?? null } }),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
          const result = await resp.json();
          if (result.skipped) { skipped++; }
          else { pass += result.pass; fail += result.fail; pending += result.pending; }
        } catch (err: any) {
          console.error(`[${taskNumber}] 처리 오류:`, err);
          if (err?.message?.includes('로그인이 필요합니다')) { queue.length = 0; toast.error('세션이 만료되었습니다.'); return; }
          pending++;
        }
        completed++;
        setFolderProgress({ current: completed, total: taskNumbers.length, taskNumber, skipped });
      };

      const workers = Array.from({ length: Math.min(CONCURRENCY, taskNumbers.length) }, async () => {
        while (queue.length > 0) { const tn = queue.shift()!; await processTask(tn); }
      });
      await Promise.allSettled(workers);
      setUploadSummary({ total: taskNumbers.length, newCount: taskNumbers.length, duplicateCount: 0, pass, fail, pending });
      await handleSelectProject(selectedProject);
    } catch (error: any) {
      toast.error(lang === 'ko' ? `처리 실패: ${error.message}` : `Failed: ${error.message}`);
    } finally {
      setIsFolderProcessing(false);
      setFolderProgress(null);
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const handleExport = async () => {
    if (!selectedProject) return;
    setIsExporting(true);
    try {
      const result = await exportCheckpointsAction(selectedProject.id);
      if (!result.success || !result.data) { toast.error(lang === 'ko' ? '데이터가 없습니다.' : 'No data.'); return; }
      const link = document.createElement('a');
      link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.data}`;
      link.download = result.filename!;
      link.click();
      toast.success(lang === 'ko' ? '다운로드 완료' : 'Download complete');
    } catch (error: any) {
      toast.error(`Export failed: ${error.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const t = translations[lang];
  const stats = {
    total: data.length,
    pass: data.filter(a => a.finalStatus === 'Approved').length,
    fail: data.filter(a => a.finalStatus === 'Rejected').length,
    pending: data.filter(a => (a.finalStatus || 'Pending') === 'Pending').length,
  };

  if (isSessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 pt-24 max-w-7xl mx-auto w-full animate-in fade-in duration-1000">
        <div className="text-center space-y-12 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-bold animate-bounce mb-4">
            <Rocket className="h-4 w-4" />
            <span>Next Generation AI Screening</span>
          </div>
          <h1 className="text-6xl font-black tracking-tight leading-[1.1] text-foreground">{t.hero.title}</h1>
          <p className="text-xl text-muted-foreground leading-relaxed">{t.hero.subtitle}</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8">
          <Link href="/auth" className="w-full sm:w-auto px-10 py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-lg shadow-xl shadow-primary/20 hover:scale-[1.05] active:scale-[0.95] transition-all flex items-center justify-center gap-2">
            {t.hero.getStarted}
            <ChevronRight className="h-5 w-5" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar (desktop) */}
      <AppSidebar
        projects={projects}
        selectedProject={selectedProject}
        lang={lang}
        onSelectProject={handleSelectProject}
        onNewProject={() => setShowNewProjectModal(true)}
        onDeleteProject={handleDeleteProject}
        onSettings={() => setShowSettingsModal(true)}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        <SiteHeader
          email={user.email || ''}
          lang={lang}
          selectedProject={selectedProject}
          hasData={data.length > 0}
          isFolderProcessing={isFolderProcessing}
          isExporting={isExporting}
          isProcessing={isProcessing}
          folderProgress={folderProgress}
          onLangToggle={() => setLang(lang === 'ko' ? 'en' : 'ko')}
          onLogout={handleLogout}
          onExport={handleExport}
          onFolderUpload={handleFolderUpload}
          folderInputRef={folderInputRef}
          projects={projects}
          onSelectProject={handleSelectProject}
          onNewProject={() => setShowNewProjectModal(true)}
          onDeleteProject={handleDeleteProject}
          onSettings={() => setShowSettingsModal(true)}
        />

        <div className="flex-1 flex flex-col p-4 md:p-6 gap-3 max-w-[1600px] mx-auto w-full">
          {/* Schema error */}
          {schemaError && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex flex-col gap-3">
              <div className="flex items-center gap-3 text-rose-600">
                <AlertCircle className="h-5 w-5" />
                <p className="text-sm font-black">{schemaError.message}</p>
              </div>
              <div className="bg-zinc-950 p-4 rounded-xl overflow-auto max-h-40">
                <code className="text-[10px] text-zinc-400 font-mono whitespace-pre">{schemaError.sql}</code>
              </div>
            </div>
          )}

          {/* Progress */}
          {isFolderProcessing && folderProgress && folderProgress.total > 0 && (
            <ProgressBanner progress={folderProgress} lang={lang} />
          )}

          {/* Content */}
          {selectedProject ? (
            <div className="flex-1 flex gap-4 min-h-0 flex-col">
              {/* Stats Cards */}
              {data.length > 0 && (
                <StatsCards
                  total={stats.total}
                  pass={stats.pass}
                  fail={stats.fail}
                  pending={stats.pending}
                  lang={lang}
                  onPendingClick={() => setStatusFilter('pending')}
                />
              )}

              {/* Table + Detail */}
              <div className="flex-1 flex gap-4 min-h-0">
                <div className="flex-1 flex flex-col gap-3 min-h-0">
                  <ApplicantTable
                    applicants={data}
                    isLoading={isProjectLoading}
                    lang={lang}
                    searchQuery={searchQuery}
                    statusFilter={statusFilter}
                    selectedApplicantId={selectedApplicant?.id ?? null}
                    onSearchChange={setSearchQuery}
                    onStatusFilterChange={setStatusFilter}
                    onSelectApplicant={setSelectedApplicant}
                    onFolderUploadClick={() => folderInputRef.current?.click()}
                  />
                </div>

                {selectedApplicant && (
                  <ApplicantDetail
                    applicant={selectedApplicant}
                    lang={lang}
                    onClose={() => setSelectedApplicant(null)}
                    onUpdate={(updated) => {
                      setSelectedApplicant(updated);
                      setData(data.map(a => a.id === updated.id ? updated : a));
                    }}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center py-24 text-muted-foreground">
              <div className="p-6 rounded-3xl bg-primary/5 border-2 border-dashed border-primary/20 mb-6">
                <FolderOpen className="h-16 w-16 text-primary/30" />
              </div>
              <p className="text-xl font-black text-foreground/70 mb-2">
                {lang === 'ko' ? '프로젝트를 선택하세요' : 'Select a Project'}
              </p>
              <p className="text-sm text-muted-foreground/70 text-center max-w-xs mb-6">
                {lang === 'ko'
                  ? '좌측 사이드바에서 프로젝트를 선택하거나 새 프로젝트를 생성하세요.'
                  : 'Select a project from the sidebar or create a new one.'}
              </p>
              <button
                onClick={() => setShowNewProjectModal(true)}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-black text-sm shadow-lg shadow-primary/20 hover:scale-[1.02] transition-all"
              >
                <Plus className="h-4 w-4" />
                {t.projects.new}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {uploadSummary && (
        <UploadSummaryModal summary={uploadSummary} lang={lang} onClose={() => setUploadSummary(null)} />
      )}
      {deleteConfirmProject && (
        <DeleteProjectModal
          project={deleteConfirmProject} lang={lang}
          onClose={() => setDeleteConfirmProject(null)}
          onDeleted={(id) => {
            setProjects(projects.filter(p => p.id !== id));
            if (selectedProject?.id === id) { setSelectedProject(null); setData([]); }
          }}
        />
      )}
      {showSettingsModal && selectedProject && (
        <SettingsModal
          project={selectedProject} lang={lang}
          onClose={() => setShowSettingsModal(false)}
          onProjectUpdated={(updated) => { setSelectedProject(updated); setProjects(projects.map(p => p.id === updated.id ? updated : p)); }}
          onProjectsRefresh={setProjects}
          onReEvaluated={() => handleSelectProject(selectedProject)}
        />
      )}
      {showNewProjectModal && (
        <CreateProjectModal
          lang={lang}
          onClose={() => setShowNewProjectModal(false)}
          onCreated={(project) => {
            setProjects([project, ...projects]);
            localStorage.setItem('selectedProjectId', project.id);
            setSelectedProject(project);
            setData([]);
          }}
        />
      )}
    </div>
  );
}
