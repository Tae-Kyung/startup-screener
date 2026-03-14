"use client";

import { useState, useEffect, useRef } from "react";
import {
  Upload, FileText, CheckCircle2, AlertCircle, BarChart3, Users, Loader2, Globe,
  ChevronRight, X, Info, LogOut, LayoutDashboard, Rocket, ShieldCheck, Plus,
  FolderKanban, Trash2, Settings, Save, CheckCheck, XCircle, ClipboardCheck,
  FolderOpen,
  Download,
} from "lucide-react";
import {
  createProjectAction, getProjectsAction, getProjectApplicantsAction,
  processExcelAction, deleteProjectAction, updateProjectSettingsAction,
  runMigrationAction, reEvaluateApplicantsAction, finalizeApplicantAction,
  exportCheckpointsAction,
} from "./actions";
import { ApplicantData } from "@/lib/excel-utils";
import { DEFAULT_PROMPT_TEMPLATE } from "@/lib/prompt-defaults";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { User } from "@supabase/supabase-js";

type Language = 'ko' | 'en';

const translations = {
  ko: {
    hero: {
      title: "혁신적인 요건 검토 솔루션",
      subtitle: "AI 기반 엔진을 활용하여 지원 자격을 맞춤형으로 심사하세요.",
      getStarted: "로그인하여 시작하기",
    },
    dashboard: "프로젝트 대시보드",
    logout: "로그아웃",
    projects: {
      title: "내 프로젝트",
      new: "새 프로젝트 생성",
      empty: "생성된 프로젝트가 없습니다.",
      create: "프로젝트 생성",
      placeholder: "프로젝트 제목 입력...",
      descPlaceholder: "간단한 설명 (선택)...",
      switching: "프로젝트 전환 중...",
      allApplicants: "전체 지원자",
      delete: "프로젝트 삭제",
      deleteConfirmTitle: "프로젝트 영구 삭제",
      deleteConfirmDesc: "이 작업은 되돌릴 수 없습니다. 프로젝트 내 모든 지원자 데이터가 영구적으로 삭제됩니다.",
      deleteConfirmLabel: "확인을 위해 프로젝트명을 입력하세요:",
      deleteConfirmBtn: "영구 삭제",
      settings: "심사 기준 설정",
      settingsDesc: "AI가 지원자를 평가할 때 사용할 구체적인 기준과 모델을 설정합니다.",
      criteriaLabel: "심사 기준 ({criteria} 플레이스홀더에 주입)",
      criteriaPlaceholder: "예: 1. 업력 7년 이내\n2. 충청권 소재 기업...",
      promptLabel: "AI 프롬프트 (실제 전송 내용)",
      promptPlaceholder: "",
      promptResetBtn: "기본값으로 초기화",
      promptHint: "* {criteria} {type} {location} {residence} {birthDate} 플레이스홀더 사용 가능. {name} → 자동 마스킹.",
      modelLabel: "AI 모델 선택 (Model)",
      referenceDateLabel: "나이 계산 기준일 (공고일 / 선택사항)",
      referenceDatePlaceholder: "미입력 시 업로드 당일 기준",
      save: "기준 저장",
      saveOnly: "설정만 저장",
      saveAndReEval: "저장 및 다시 평가",
      reEvaluating: "재평가 중...",
    },
    uploadBtn: "엑셀만 업로드",
    folderUploadBtn: "dataset 폴더 업로드 (PDF 분석)",
    processing: "처리 중...",
    folderProcessing: "서류 분석 중...",
    folderProgress: (current: number, total: number, taskNumber: string) =>
      `분석 중 ${current}/${total}: 과제번호 ${taskNumber}`,
    stats: {
      total: "전체 지원자",
      passed: "심사 적격 (Approved)",
      pending: "검토 필요 (Pending)",
      youthRatioAll: "청년 비중 (전체)",
      youthRatioPass: "청년 비중 (Approved)",
      totalDesc: "전체 처리된 인원",
      passedDesc: "크로스체크 통과",
      pendingDesc: "사람의 검토 필요",
      target: "목표: 50%",
    },
    table: {
      title: "지원 내역",
      name: "성명 / 과제번호",
      enterprise: "기업명",
      history: "업력 유형",
      llmStatus: "AI 판단",
      finalStatus: "최종 상태",
      action: "상세",
      youth: "청년",
      empty: "데이터가 없습니다",
      emptySub: "엑셀 파일을 업로드하여 심사를 시작하세요",
    },
    filter: {
      all: "전체 상태",
      approved: "Approved",
      rejected: "Rejected",
      pending: "Pending (검토 필요)",
    },
    details: {
      title: "심사 통계",
      llmComplete: "AI 심사 완료율",
      regional: "충청권 업체",
      reasoningTitle: "AI 심사 근거",
      reasoningSub: "설정된 기준에 따른 AI의 판단 논리입니다.",
      finalizeTitle: "최종 확정",
      finalizeDesc: "현재 최종 상태: ",
      finalizeComment: "확정 근거 코멘트",
      finalizeCommentPlaceholder: "확정 사유를 입력하세요 (필수)...",
      approveBtn: "적격 확정 (Approved)",
      rejectBtn: "부적격 확정 (Rejected)",
      finalizing: "처리 중...",
      alreadyFinalized: "확정자: ",
      close: "닫기",
    },
    uploadSummary: {
      title: "업로드 처리 완료",
      total: "총 지원자",
      newCount: "신규 처리",
      duplicateCount: "중복 건 (스킵)",
      pass: "Approved",
      fail: "Rejected",
      pending: "Pending",
      youthPassRatio: "Approved 중 청년 비중",
      confirm: "확인",
    },
  },
  en: {
    hero: {
      title: "Custom AI Screening",
      subtitle: "Screen startup qualifications using dynamic AI-driven engines.",
      getStarted: "Sign in to Get Started",
    },
    dashboard: "Project Dashboard",
    logout: "Logout",
    projects: {
      title: "My Projects",
      new: "Create New Project",
      empty: "No projects found.",
      create: "Create Project",
      placeholder: "Enter project title...",
      descPlaceholder: "Short description (optional)...",
      switching: "Switching project...",
      allApplicants: "All Applicants",
      delete: "Delete Project",
      deleteConfirmTitle: "Permanently Delete Project",
      deleteConfirmDesc: "This action is irreversible. All applicant data in this project will be permanently removed.",
      deleteConfirmLabel: "Type the project name to confirm:",
      deleteConfirmBtn: "Delete Permanently",
      settings: "Project Settings",
      settingsDesc: "Configure the specific criteria and model the AI will use to evaluate applicants.",
      criteriaLabel: "Screening Criteria (injected into {criteria})",
      criteriaPlaceholder: "e.g. 1. Within 7 years of operation\n2. Based in Chungcheong region...",
      promptLabel: "AI Prompt (actual content sent to LLM)",
      promptPlaceholder: "",
      promptResetBtn: "Reset to default",
      promptHint: "* Placeholders: {criteria} {type} {location} {residence} {birthDate}. {name} → auto-masked.",
      modelLabel: "AI Model Selection",
      referenceDateLabel: "Age Reference Date (Announcement Date / Optional)",
      referenceDatePlaceholder: "Defaults to upload date if empty",
      save: "Save Criteria",
      saveOnly: "Save Only",
      saveAndReEval: "Save & Re-evaluate",
      reEvaluating: "Re-evaluating...",
    },
    uploadBtn: "Upload Excel Only",
    folderUploadBtn: "Upload dataset Folder (PDF Analysis)",
    processing: "Processing...",
    folderProcessing: "Analyzing documents...",
    folderProgress: (current: number, total: number, taskNumber: string) =>
      `Analyzing ${current}/${total}: Task ${taskNumber}`,
    stats: {
      total: "Total Applicants",
      passed: "Approved",
      pending: "Pending Review",
      youthRatioAll: "Youth Ratio (All)",
      youthRatioPass: "Youth Ratio (Approved)",
      totalDesc: "Total processed",
      passedDesc: "Cross-check passed",
      pendingDesc: "Requires human review",
      target: "Target: 50%",
    },
    table: {
      title: "Applications",
      name: "Name / Task No.",
      enterprise: "Enterprise",
      history: "History",
      llmStatus: "AI Judgment",
      finalStatus: "Final Status",
      action: "Detail",
      youth: "Youth",
      empty: "No data available",
      emptySub: "Upload an excel file to get started",
    },
    filter: {
      all: "All Status",
      approved: "Approved",
      rejected: "Rejected",
      pending: "Pending (Review)",
    },
    details: {
      title: "Review Statistics",
      llmComplete: "AI Review Completion",
      regional: "Regional Business",
      reasoningTitle: "Detailed AI Reasoning",
      reasoningSub: "AI logic based on custom project criteria.",
      finalizeTitle: "Manual Finalization",
      finalizeDesc: "Current final status: ",
      finalizeComment: "Confirmation Comment",
      finalizeCommentPlaceholder: "Enter reason for this decision (required)...",
      approveBtn: "Approve (Eligible)",
      rejectBtn: "Reject (Ineligible)",
      finalizing: "Processing...",
      alreadyFinalized: "Confirmed by: ",
      close: "Close",
    },
    uploadSummary: {
      title: "Upload Complete",
      total: "Total Applicants",
      newCount: "New Processed",
      duplicateCount: "Duplicates (Skipped)",
      pass: "Approved",
      fail: "Rejected",
      pending: "Pending",
      youthPassRatio: "Youth in Approved",
      confirm: "OK",
    },
  },
};

interface UploadSummary {
  total: number;
  newCount: number;
  duplicateCount: number;
  pass: number;
  fail: number;
  pending: number;
  youthPassRatio: number;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<ApplicantData[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lang, setLang] = useState<Language>('ko');
  const [selectedApplicant, setSelectedApplicant] = useState<ApplicantData | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);

  // Project state
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [projectCriteria, setProjectCriteria] = useState("");
  const [projectPrompt, setProjectPrompt] = useState("");
  const [projectModel, setProjectModel] = useState("gpt-4o");
  const [projectReferenceDate, setProjectReferenceDate] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isReEvaluating, setIsReEvaluating] = useState(false);
  const [isUpdatingCriteria, setIsUpdatingCriteria] = useState(false);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [modalTab, setModalTab] = useState<'reasoning' | 'raw' | 'finalize'>('reasoning');
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [schemaError, setSchemaError] = useState<{ message: string; sql: string } | null>(null);

  // 삭제 확인 모달
  const [deleteConfirmProject, setDeleteConfirmProject] = useState<any | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  // 업로드 결과 요약
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);

  // 수동 확정
  const [finalizeComment, setFinalizeComment] = useState("");
  const [isFinalizing, setIsFinalizing] = useState(false);

  // 엑셀 다운로드
  const [isExporting, setIsExporting] = useState(false);

  // dataset 폴더 업로드 (PDF 분석)
  const [isFolderProcessing, setIsFolderProcessing] = useState(false);
  const [folderProgress, setFolderProgress] = useState<{ current: number; total: number; taskNumber: string } | null>(null);
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
        if (res.data?.length && !selectedProject) handleSelectProject(res.data[0]);
      }
    } catch (e) {
      console.error("Failed to load projects", e);
    }
  };

  const handleSelectProject = async (project: any) => {
    setSelectedProject(project);
    setProjectCriteria(project.criteria || "");
    setProjectPrompt(project.prompt || DEFAULT_PROMPT_TEMPLATE);
    setProjectModel(project.model || "gpt-4o");
    setProjectReferenceDate(project.reference_date || "");
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

  const handleCreateProject = async () => {
    if (!newProjectTitle.trim()) return;
    setIsCreatingProject(true);
    try {
      const res = await createProjectAction(newProjectTitle);
      if (res.success) {
        setProjects([res.data, ...projects]);
        setSelectedProject(res.data);
        setProjectCriteria("");
        setData([]);
        setShowNewProjectModal(false);
        setNewProjectTitle("");
      }
    } catch (e) {
      console.error("Failed to create project", e);
    } finally {
      setIsCreatingProject(false);
    }
  };

  // 삭제 확인 모달 열기
  const handleDeleteProject = (e: React.MouseEvent, project: any) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteConfirmProject(project);
    setDeleteConfirmInput("");
    setShowProjectDropdown(false);
  };

  // 실제 삭제 실행
  const confirmDeleteProject = async () => {
    if (!deleteConfirmProject) return;
    setIsDeletingProject(true);
    try {
      const res = await deleteProjectAction(deleteConfirmProject.id);
      if (res.success) {
        setProjects(projects.filter(p => p.id !== deleteConfirmProject.id));
        if (selectedProject?.id === deleteConfirmProject.id) {
          setSelectedProject(null);
          setData([]);
        }
        setDeleteConfirmProject(null);
        setDeleteConfirmInput("");
      }
    } catch (error: any) {
      alert(lang === 'ko' ? `삭제 실패: ${error.message}` : `Delete failed: ${error.message}`);
    } finally {
      setIsDeletingProject(false);
    }
  };

  const handleUpdateCriteria = async (shouldReEvaluate = false) => {
    if (!selectedProject) return;
    setIsUpdatingCriteria(true);
    try {
      // 기본값과 동일한 프롬프트는 undefined로 저장 (DB에 빈값으로 클리어)
      const promptToSave = projectPrompt === DEFAULT_PROMPT_TEMPLATE ? undefined : (projectPrompt || undefined);
      const res = await updateProjectSettingsAction(selectedProject.id, {
        criteria: projectCriteria,
        prompt: promptToSave,
        model: projectModel,
        reference_date: projectReferenceDate || undefined,
      });
      if (res.success) {
        const updated = { ...selectedProject, criteria: projectCriteria, prompt: promptToSave, model: projectModel, reference_date: projectReferenceDate };
        setSelectedProject(updated);
        setProjects(projects.map(p => p.id === selectedProject.id ? updated : p));

        if (shouldReEvaluate) {
          setIsReEvaluating(true);
          try {
            const reEvalRes = await reEvaluateApplicantsAction(selectedProject.id);
            if (reEvalRes.success) {
              alert(lang === 'ko' ? `${reEvalRes.count}명 재평가 완료.` : `${reEvalRes.count} applicants re-evaluated.`);
              handleSelectProject(updated);
            }
          } catch (error: any) {
            alert(lang === 'ko' ? "재평가 중 오류가 발생했습니다." : "Error during re-evaluation.");
          } finally {
            setIsReEvaluating(false);
          }
        } else {
          alert(lang === 'ko' ? "설정이 저장되었습니다." : "Settings saved.");
        }
        setShowSettingsModal(false);
        const projectsRes = await getProjectsAction();
        if (projectsRes.success) setProjects(projectsRes.data);
      }
    } catch (error: any) {
      if (error.code === '42703' || error.message?.includes('column')) {
        const migRes = await runMigrationAction();
        if (!migRes.success) setSchemaError({ message: migRes.error || "Schema error", sql: migRes.sql || "" });
      } else {
        alert(lang === 'ko' ? "설정 저장에 실패했습니다." : "Failed to save settings.");
      }
    } finally {
      setIsUpdatingCriteria(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!selectedProject) {
      alert(lang === 'ko' ? "먼저 프로젝트를 생성하거나 선택해주세요." : "Please create or select a project first.");
      return;
    }
    setIsProcessing(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const result = await processExcelAction(formData, selectedProject.id);
      if (result.success) {
        if (result.summary) setUploadSummary(result.summary as UploadSummary);
        handleSelectProject(selectedProject);
      }
    } catch (error: any) {
      alert(lang === 'ko' ? `처리 실패: ${error.message || "엑셀 형식을 확인하세요."}` : `Processing failed: ${error.message || "Check Excel format."}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // dataset 폴더 업로드 (PDF 분석) 핸들러
  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (!selectedProject) {
      alert(lang === 'ko' ? "먼저 프로젝트를 생성하거나 선택해주세요." : "Please create or select a project first.");
      return;
    }

    // ── 클라이언트에서 파일을 과제번호별로 그룹화 ──────────────────
    let excelFile: File | null = null;
    const taskGroups = new Map<string, File[]>();

    for (const file of files) {
      const path = (file as any).webkitRelativePath || file.name;
      const parts = path.replace(/\\/g, '/').split('/');
      const basename = parts[parts.length - 1];

      if (basename.endsWith('.xlsx')) {
        excelFile = file;
      } else if (basename.endsWith('.pdf') && parts.length >= 2) {
        const folderName = parts[parts.length - 2];
        const taskNumber = folderName.replace(/_.*$/, '');
        if (!taskGroups.has(taskNumber)) taskGroups.set(taskNumber, []);
        taskGroups.get(taskNumber)!.push(file);
      }
    }

    const taskNumbers = Array.from(taskGroups.keys());
    if (taskNumbers.length === 0) {
      alert(lang === 'ko' ? "PDF 파일이 있는 과제번호 폴더를 찾을 수 없습니다." : "No task folders with PDFs found.");
      return;
    }

    const pdfCount = Array.from(taskGroups.values()).reduce((sum, arr) => sum + arr.length, 0);
    const confirmMsg = lang === 'ko'
      ? `${taskNumbers.length}개 과제, PDF ${pdfCount}개를 AI 심사하시겠습니까?`
      : `Start AI screening for ${taskNumbers.length} tasks (${pdfCount} PDFs)?`;
    if (!confirm(confirmMsg)) return;

    setIsFolderProcessing(true);
    setFolderProgress({ current: 0, total: taskNumbers.length, taskNumber: '' });

    let pass = 0, fail = 0, pending = 0;
    let completed = 0;

    try {
      // ── 최대 3개 동시 병렬 처리 (worker pool) ────────────────────
      const CONCURRENCY = 3;
      const queue = [...taskNumbers];

      const toBase64 = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

      const processTask = async (taskNumber: string) => {
        const [excelBase64, ...pdfEntries] = await Promise.all([
          excelFile ? toBase64(excelFile) : Promise.resolve(null),
          ...taskGroups.get(taskNumber)!.map(async (f) => ({
            name: f.name,
            base64: await toBase64(f),
          })),
        ]);

        try {
          const body = JSON.stringify({
            taskNumber,
            excelBase64,
            excelName: excelFile?.name ?? null,
            pdfs: pdfEntries,
          });

          // 실패 시 1회 재시도
          let res: Response | null = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              res = await fetch(`/api/process-dataset?projectId=${selectedProject.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
              });
              if (res.ok) break;
              if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
            } catch (fetchErr) {
              if (attempt === 1) throw fetchErr;
              await new Promise(r => setTimeout(r, 1000));
            }
          }
          if (!res || !res.ok) throw new Error(`HTTP ${res?.status ?? 'unknown'}`);

          const text = await res.text();
          for (const line of text.split('\n').filter(Boolean)) {
            try {
              const ev = JSON.parse(line);
              if (ev.type === 'complete') {
                pass += ev.summary.pass;
                fail += ev.summary.fail;
                pending += ev.summary.pending;
              }
            } catch { /* skip */ }
          }
        } catch (err: any) {
          console.error(`[${taskNumber}] 오류:`, err);
          pending++;
        }

        completed++;
        setFolderProgress({ current: completed, total: taskNumbers.length, taskNumber });
      };

      const workers = Array.from({ length: Math.min(CONCURRENCY, taskNumbers.length) }, async () => {
        while (queue.length > 0) {
          const taskNumber = queue.shift()!;
          await processTask(taskNumber);
        }
      });

      await Promise.allSettled(workers);

      setUploadSummary({
        total: taskNumbers.length,
        newCount: taskNumbers.length,
        duplicateCount: 0,
        pass,
        fail,
        pending,
        youthPassRatio: 0,
      });
      await handleSelectProject(selectedProject);
    } catch (error: any) {
      alert(lang === 'ko' ? `처리 실패: ${error.message}` : `Failed: ${error.message}`);
    } finally {
      setIsFolderProcessing(false);
      setFolderProgress(null);
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  // 체크포인트 엑셀 다운로드
  const handleExport = async () => {
    if (!selectedProject) return;
    setIsExporting(true);
    try {
      const result = await exportCheckpointsAction(selectedProject.id);
      if (!result.success || !result.data) {
        alert(lang === 'ko' ? '다운로드 실패: 데이터가 없습니다.' : 'Export failed: no data.');
        return;
      }
      const link = document.createElement('a');
      link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.data}`;
      link.download = result.filename!;
      link.click();
    } catch (error: any) {
      alert(lang === 'ko' ? `다운로드 실패: ${error.message}` : `Export failed: ${error.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  // 수동 확정 처리
  const handleFinalize = async (finalStatus: 'Approved' | 'Rejected') => {
    if (!selectedApplicant || !finalizeComment.trim()) return;
    setIsFinalizing(true);
    try {
      await finalizeApplicantAction(selectedApplicant.id, finalStatus, finalizeComment);
      // 로컬 상태 업데이트 (재로드 없이)
      const now = new Date().toISOString();
      const updatedApplicant = { ...selectedApplicant, finalStatus, confirmComment: finalizeComment, confirmedAt: now };
      setSelectedApplicant(updatedApplicant);
      setData(data.map(a => a.id === selectedApplicant.id ? updatedApplicant : a));
      setFinalizeComment("");
    } catch (error: any) {
      alert(lang === 'ko' ? `확정 처리 실패: ${error.message}` : `Finalization failed: ${error.message}`);
    } finally {
      setIsFinalizing(false);
    }
  };

  const t = translations[lang];

  const filteredApplicants = data.filter(app => {
    const matchesSearch =
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (app.taskNumber && app.taskNumber.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus =
      statusFilter === 'all' ||
      (app.finalStatus || 'Pending').toLowerCase() === statusFilter.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  const passApplicants = data.filter(a => a.finalStatus === 'Approved');
  const stats = {
    total: data.length,
    pass: passApplicants.length,
    pending: data.filter(a => a.finalStatus === 'Pending').length,
    youthAll: data.length > 0 ? Math.round((data.filter(a => a.isYouth).length / data.length) * 100) : 0,
    youthPass: passApplicants.length > 0
      ? Math.round((passApplicants.filter(a => a.isYouth).length / passApplicants.length) * 100)
      : 0,
  };

  const statusBadge = (status: string | undefined, type: 'rule' | 'llm' | 'final') => {
    const s = status || 'Pending';
    const colorMap: Record<string, string> = {
      Pass: 'bg-emerald-500/10 text-emerald-600',
      Fail: 'bg-rose-500/10 text-rose-600',
      Approved: 'bg-emerald-500/10 text-emerald-600',
      Rejected: 'bg-rose-500/10 text-rose-600',
      Pending: 'bg-orange-500/10 text-orange-600',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${colorMap[s] || colorMap['Pending']}`}>
        {s}
      </span>
    );
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
          <h1 className="text-6xl font-black tracking-tight leading-[1.1] text-foreground">
            {t.hero.title}
          </h1>
          <p className="text-xl text-muted-foreground leading-relaxed">{t.hero.subtitle}</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8">
          <Link
            href="/auth"
            className="w-full sm:w-auto px-10 py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-lg shadow-xl shadow-primary/20 hover:scale-[1.05] active:scale-[0.95] transition-all flex items-center justify-center gap-2"
          >
            {t.hero.getStarted}
            <ChevronRight className="h-5 w-5" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-8 p-8 pt-6 max-w-7xl mx-auto w-full animate-in fade-in duration-700">

      {/* Schema Migration Banner */}
      {schemaError && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex flex-col gap-3">
          <div className="flex items-center gap-3 text-rose-600">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm font-black">{schemaError.message}</p>
          </div>
          <div className="bg-zinc-950 p-4 rounded-xl overflow-auto max-h-40">
            <code className="text-[10px] text-zinc-400 font-mono whitespace-pre">{schemaError.sql}</code>
          </div>
          <p className="text-[10px] text-muted-foreground italic">
            {lang === 'ko' ? "* 위 SQL을 복사하여 Supabase SQL Editor에서 실행하면 해결됩니다." : "* Run the SQL above in Supabase SQL Editor."}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LayoutDashboard className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-3xl font-black tracking-tight text-foreground">{t.dashboard}</h2>
            <div className="text-xs text-muted-foreground font-bold mt-1">{user.email}</div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Project Selector */}
          <div className="relative">
            <button
              onClick={() => setShowProjectDropdown(!showProjectDropdown)}
              onBlur={() => setTimeout(() => setShowProjectDropdown(false), 200)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border bg-background/50 backdrop-blur-sm hover:bg-accent transition-all text-sm font-bold shadow-sm"
            >
              <FolderKanban className="h-4 w-4 text-primary" />
              <span className="max-w-[120px] truncate">{selectedProject?.title || t.projects.title}</span>
            </button>
            {showProjectDropdown && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-card border rounded-2xl shadow-2xl animate-in zoom-in-95 slide-in-from-top-2 duration-200 z-50 p-2">
                <div className="p-3 border-b text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center justify-between">
                  <span>{t.projects.title}</span>
                  <span className="px-1.5 py-0.5 rounded bg-accent text-primary">{projects.length}</span>
                </div>
                <div className="max-h-60 overflow-auto py-2">
                  {projects.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-muted-foreground italic">{t.projects.empty}</div>
                  ) : (
                    projects.map(p => (
                      <div key={p.id} className="group relative">
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => { handleSelectProject(p); setShowProjectDropdown(false); }}
                          onKeyDown={e => { if (e.key === 'Enter') { handleSelectProject(p); setShowProjectDropdown(false); } }}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-3 pr-10 cursor-pointer ${selectedProject?.id === p.id ? 'bg-primary/10 text-primary' : 'hover:bg-accent'}`}
                        >
                          <div className={`h-2 w-2 rounded-full ${selectedProject?.id === p.id ? 'bg-primary' : 'bg-transparent'}`} />
                          <span className="truncate">{p.title}</span>
                        </div>
                        <button
                          onClick={e => handleDeleteProject(e, p)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-muted-foreground/40 hover:text-rose-500 hover:bg-rose-50 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all z-30"
                          title={t.projects.delete}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <button
                  onClick={() => { setShowNewProjectModal(true); setShowProjectDropdown(false); }}
                  className="w-full mt-2 flex items-center justify-center gap-2 p-3 rounded-xl bg-accent hover:bg-primary/10 hover:text-primary transition-all text-xs font-bold uppercase tracking-wide"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t.projects.new}
                </button>
              </div>
            )}
          </div>

          <button onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')} className="flex items-center gap-2 px-3 py-2.5 rounded-2xl border bg-background/50 backdrop-blur-sm hover:bg-accent transition-all text-xs font-bold">
            <Globe className="h-4 w-4" />
            {lang.toUpperCase()}
          </button>

          <button onClick={handleLogout} className="p-2.5 rounded-2xl border bg-background/50 text-muted-foreground hover:text-rose-500 hover:bg-rose-50 transition-all shadow-sm">
            <LogOut className="h-4 w-4" />
          </button>

          {/* 엑셀만 업로드 */}
          <label className="inline-flex items-center justify-center rounded-2xl border border-primary/40 bg-background/50 px-4 py-2.5 text-sm font-black text-primary shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer">
            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {isProcessing ? t.processing : t.uploadBtn}
            <input type="file" className="hidden" accept=".xlsx" onChange={handleUpload} disabled={isProcessing || isFolderProcessing} onClick={e => ((e.target as any).value = null)} />
          </label>

          {/* dataset 폴더 업로드 (PDF 분석) */}
          <label className="inline-flex items-center justify-center rounded-2xl bg-primary px-5 py-2.5 text-sm font-black text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer">
            {isFolderProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
            {isFolderProcessing
              ? (folderProgress && folderProgress.total > 0
                  ? `${folderProgress.current}/${folderProgress.total}`
                  : t.folderProcessing)
              : t.folderUploadBtn}
            <input
              ref={(el) => {
                (folderInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
                if (el) el.setAttribute('webkitdirectory', '');
              }}
              type="file"
              className="hidden"
              multiple
              onChange={handleFolderUpload}
              disabled={isProcessing || isFolderProcessing}
            />
          </label>
        </div>
      </div>

      {/* 폴더 처리 진행 배너 */}
      {isFolderProcessing && folderProgress && folderProgress.total > 0 && (
        <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 flex items-center gap-4">
          <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-primary">
              {t.folderProgress(folderProgress.current, folderProgress.total, folderProgress.taskNumber)}
            </p>
            <div className="mt-2 h-1.5 rounded-full bg-primary/10 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${Math.round((folderProgress.current / folderProgress.total) * 100)}%` }}
              />
            </div>
          </div>
          <span className="text-xs font-black text-primary/60 shrink-0">
            {Math.round((folderProgress.current / folderProgress.total) * 100)}%
          </span>
        </div>
      )}

      {/* Summary Metrics */}
      {selectedProject && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {data.length > 0 ? (
            <>
              <div className="p-6 rounded-3xl border bg-card/50 backdrop-blur-sm shadow-sm hover:shadow-md transition-all">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 rounded-xl bg-primary/10 text-primary"><Users className="h-5 w-5" /></div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total</span>
                </div>
                <p className="text-3xl font-black">{stats.total}</p>
                <p className="text-xs font-bold text-muted-foreground mt-1">{t.stats.total}</p>
              </div>
              <div className="p-6 rounded-3xl border bg-card/50 backdrop-blur-sm shadow-sm hover:shadow-md transition-all">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500"><CheckCircle2 className="h-5 w-5" /></div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Approved</span>
                </div>
                <p className="text-3xl font-black text-emerald-500">{stats.pass}</p>
                <p className="text-xs font-bold text-muted-foreground mt-1">{t.stats.passed}</p>
              </div>
              <div className="p-6 rounded-3xl border bg-card/50 backdrop-blur-sm shadow-sm hover:shadow-md transition-all">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 rounded-xl bg-orange-500/10 text-orange-500"><AlertCircle className="h-5 w-5" /></div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Pending</span>
                </div>
                <p className="text-3xl font-black text-orange-500">{stats.pending}</p>
                <p className="text-xs font-bold text-muted-foreground mt-1">{t.stats.pending}</p>
              </div>
              <div className="p-6 rounded-3xl border bg-card/50 backdrop-blur-sm shadow-sm hover:shadow-md transition-all">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500"><BarChart3 className="h-5 w-5" /></div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Youth/All</span>
                </div>
                <p className="text-3xl font-black">{stats.youthAll}%</p>
                <p className="text-xs font-bold text-muted-foreground mt-1">{t.stats.youthRatioAll}</p>
              </div>
              <div className={`p-6 rounded-3xl border backdrop-blur-sm shadow-sm hover:shadow-md transition-all ${stats.youthPass >= 50 ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-orange-500/5 border-orange-500/20'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-2 rounded-xl ${stats.youthPass >= 50 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-orange-500/10 text-orange-500'}`}><BarChart3 className="h-5 w-5" /></div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{t.stats.target}</span>
                </div>
                <p className={`text-3xl font-black ${stats.youthPass >= 50 ? 'text-emerald-500' : 'text-orange-500'}`}>{stats.youthPass}%</p>
                <p className="text-xs font-bold text-muted-foreground mt-1">{t.stats.youthRatioPass}</p>
              </div>
            </>
          ) : (
            <div className="md:col-span-4 p-6 rounded-3xl border border-dashed bg-accent/5 flex flex-col items-center justify-center text-center space-y-2">
              <div className="h-10 w-10 rounded-full bg-accent/20 flex items-center justify-center text-muted-foreground">
                <Upload className="h-5 w-5" />
              </div>
              <p className="text-sm font-bold text-muted-foreground">{t.table.empty}</p>
              <p className="text-[10px] text-muted-foreground/60 italic">{t.table.emptySub}</p>
            </div>
          )}
          <button
            onClick={() => setShowSettingsModal(true)}
            className={`p-6 rounded-3xl border bg-primary shadow-xl shadow-primary/20 text-primary-foreground group text-left hover:scale-[1.02] transition-all ${data.length > 0 ? '' : 'md:col-span-1'}`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 rounded-xl bg-white/20 text-white"><Settings className="h-5 w-5" /></div>
              <span className="text-[10px] font-black uppercase tracking-widest opacity-80">Settings</span>
            </div>
            <p className="text-lg font-black">{t.projects.settings}</p>
            <p className="text-[10px] font-bold opacity-80 mt-1 line-clamp-1">{projectCriteria || "No criteria set"}</p>
          </button>
        </div>
      )}

      {/* Main Content */}
      {selectedProject && (
        <div className="grid gap-6 lg:grid-cols-7">
          <div className="lg:col-span-4 space-y-4">
            {/* Search & Filter */}
            <div className="flex flex-col sm:flex-row items-center gap-3 p-3 rounded-2xl bg-card/50 border shadow-sm">
              <div className="relative flex-1 w-full">
                <FileText className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={lang === 'ko' ? "이름 또는 과제번호 검색..." : "Search name or task ID..."}
                  className="w-full pl-11 pr-4 py-2.5 rounded-xl border bg-background/50 focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm font-bold"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
              <select
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border bg-background/50 text-sm font-bold outline-none cursor-pointer"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
              >
                <option value="all">{t.filter.all}</option>
                <option value="approved">{t.filter.approved}</option>
                <option value="rejected">{t.filter.rejected}</option>
                <option value="pending">{t.filter.pending}</option>
              </select>
            </div>

            {/* Table */}
            <div className="rounded-3xl border bg-card/30 backdrop-blur-md shadow-sm overflow-hidden flex flex-col min-h-[400px]">
              <div className="p-6 border-b flex items-center justify-between">
                <h3 className="font-black text-lg uppercase tracking-tight">{t.table.title}</h3>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase bg-accent px-2 py-1 rounded">
                    {filteredApplicants.length} records
                  </span>
                  {data.length > 0 && (
                    <button
                      onClick={handleExport}
                      disabled={isExporting}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border border-primary/30 text-primary hover:bg-primary hover:text-white transition-all disabled:opacity-50"
                      title={lang === 'ko' ? '체크포인트 엑셀 다운로드' : 'Download Checkpoints Excel'}
                    >
                      {isExporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                      {lang === 'ko' ? '엑셀 다운로드' : 'Export Excel'}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-auto max-h-[600px]">
                {filteredApplicants.length > 0 ? (
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10 bg-card border-b">
                      <tr className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        <th className="px-4 py-4">{t.table.name}</th>
                        <th className="px-3 py-4">{t.table.llmStatus}</th>
                        <th className="px-3 py-4">{t.table.finalStatus}</th>
                        <th className="px-4 py-4 text-right">{t.table.action}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-muted/10">
                      {filteredApplicants.map(applicant => (
                          <tr key={applicant.id} className="group hover:bg-primary/5 transition-all">
                            <td className="px-4 py-4">
                              <div className="space-y-1">
                                <div className="font-black text-sm group-hover:text-primary transition-colors flex items-center gap-2">
                                  {applicant.name}
                                  {applicant.isYouth && <span className="px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-500 text-[9px]">{t.table.youth}</span>}
                                  {applicant.confirmedAt && <span className="px-1.5 py-0.5 rounded-md bg-violet-500/10 text-violet-500 text-[9px]"><ClipboardCheck className="h-2.5 w-2.5 inline" /></span>}
                                </div>
                                <div className="font-mono text-[10px] text-muted-foreground">{applicant.taskNumber}</div>
                              </div>
                            </td>
                            <td className="px-3 py-4">{statusBadge(applicant.llmStatus, 'llm')}</td>
                            <td className="px-3 py-4">{statusBadge(applicant.finalStatus, 'final')}</td>
                            <td className="px-4 py-4 text-right">
                              <button
                                onClick={() => { setSelectedApplicant(applicant); setModalTab('reasoning'); setFinalizeComment(""); }}
                                className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-primary hover:bg-primary hover:text-white transition-all"
                              >
                                {lang === 'ko' ? '상세' : 'Details'}
                              </button>
                            </td>
                          </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
                    <div className="p-4 rounded-full bg-accent/50 mb-4">
                      {isProjectLoading ? <Loader2 className="h-8 w-8 animate-spin" /> : <Info className="h-8 w-8 opacity-20" />}
                    </div>
                    <p className="font-bold">{isProjectLoading ? (lang === 'ko' ? "데이터 로드 중..." : "Loading...") : t.table.empty}</p>
                    <p className="text-sm italic">{t.table.emptySub}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Side stats */}
          <div className="lg:col-span-3 space-y-6">
            <div className="p-6 rounded-3xl border bg-card/50 shadow-sm space-y-6">
              <h3 className="font-black text-xl uppercase tracking-tighter border-b pb-4">{t.details.title}</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  <span>{t.details.llmComplete}</span>
                  <span className="text-primary">{stats.total > 0 ? Math.round((data.filter(a => a.llmStatus).length / stats.total) * 100) : 0}%</span>
                </div>
                <div className="h-2 w-full bg-accent rounded-full overflow-hidden">
                  <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${stats.total > 0 ? (data.filter(a => a.llmStatus).length / stats.total) * 100 : 0}%` }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl border bg-background/50 text-center">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">{t.details.regional}</p>
                  <p className="text-2xl font-black">{data.filter(a => a.isRegional).length}</p>
                </div>
                <div className="p-5 rounded-2xl border bg-background/50 text-center">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Pending</p>
                  <p className="text-2xl font-black text-orange-500">{stats.pending}</p>
                </div>
              </div>
              <div className="p-5 rounded-2xl bg-primary/5 border border-primary/20 space-y-2">
                <div className="flex items-center gap-2 text-primary">
                  <ShieldCheck className="h-5 w-5" />
                  <span className="text-xs font-black uppercase tracking-widest">AI Assisted Review</span>
                </div>
                <p className="text-sm font-medium leading-relaxed">
                  {lang === 'ko'
                    ? "AI가 설정된 심사 기준에 따라 모든 지원자를 분석했습니다. Pending 건을 필터링하여 검토하세요."
                    : "AI has analyzed all applicants based on your criteria. Filter by Pending to review flagged cases."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: 지원자 상세 (AI 근거 + 원본 데이터 + 수동 확정)
      ============================================================ */}
      {selectedApplicant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-md animate-in fade-in" onClick={() => setSelectedApplicant(null)} />
          <div className="relative w-full max-w-2xl rounded-[2.5rem] border bg-card shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-10 overflow-hidden">
            <div className="p-8 border-b bg-accent/20 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-black text-xl">
                  {selectedApplicant.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-2xl font-black tracking-tight">{selectedApplicant.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{selectedApplicant.taskNumber}</span>
                    <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                    <span className="text-xs font-black text-primary uppercase tracking-widest">{selectedApplicant.historyType}</span>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    {statusBadge(selectedApplicant.llmStatus, 'llm')}
                    {statusBadge(selectedApplicant.finalStatus, 'final')}
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedApplicant(null)} className="p-3 rounded-full hover:bg-accent transition-all">
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="p-8 space-y-6">
              {/* Tabs */}
              <div className="flex border-b text-[11px] font-black uppercase tracking-[0.2em]">
                {(['reasoning', 'finalize', 'raw'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setModalTab(tab)}
                    className={`px-5 py-4 border-b-2 transition-all ${modalTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                  >
                    {tab === 'reasoning'
                      ? (lang === 'ko' ? 'AI 근거' : 'AI Reasoning')
                      : tab === 'finalize'
                        ? (lang === 'ko' ? '최종 확정' : 'Finalize')
                        : (lang === 'ko' ? '원본 데이터' : 'Raw Data')}
                    {tab === 'finalize' && selectedApplicant.finalStatus === 'Pending' && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-500 text-[8px]">!</span>
                    )}
                  </button>
                ))}
              </div>

              {/* AI Reasoning Tab */}
              {modalTab === 'reasoning' && (() => {
                // llm_reasoning이 JSON이면 체크포인트 보고서, 아니면 텍스트 표시
                let reasoningText = selectedApplicant.llmReasoning || '';
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
                  <div className="space-y-5 animate-in slide-in-from-left-4 duration-300">
                    {/* 상태 뱃지 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-4 rounded-2xl bg-accent/20 border text-center">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">AI (LLM)</p>
                        {statusBadge(selectedApplicant.llmStatus, 'llm')}
                      </div>
                      <div className="p-4 rounded-2xl bg-accent/20 border text-center">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Final</p>
                        {statusBadge(selectedApplicant.finalStatus, 'final')}
                      </div>
                    </div>

                    {/* 체크포인트 보고서 */}
                    {checkpoints && checkpoints.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="h-5 w-[3px] bg-primary rounded-full" />
                          <h4 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                            {lang === 'ko' ? '서류 검토 체크포인트' : 'Document Checkpoints'}
                          </h4>
                        </div>
                        <div className="rounded-2xl border overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-accent/40 border-b">
                              <tr className="text-[9px] font-black uppercase tracking-wider text-muted-foreground">
                                <th className="px-3 py-2.5 text-left w-[22%]">{lang === 'ko' ? '심사 항목' : 'Item'}</th>
                                <th className="px-3 py-2.5 text-left w-[23%]">{lang === 'ko' ? '확인 서류' : 'Document'}</th>
                                <th className="px-3 py-2.5 text-left">{lang === 'ko' ? '확인 내용' : 'Finding'}</th>
                                <th className="px-3 py-2.5 text-center w-[14%]">{lang === 'ko' ? '결과' : 'Result'}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-muted/10">
                              {checkpoints.map((cp, idx) => (
                                <tr key={idx} className="hover:bg-accent/10 transition-colors">
                                  <td className="px-3 py-2.5 font-bold text-foreground">{cp.criterion}</td>
                                  <td className="px-3 py-2.5 text-muted-foreground">{cp.document}</td>
                                  <td className="px-3 py-2.5 text-foreground/80">{cp.finding}</td>
                                  <td className="px-3 py-2.5 text-center">
                                    <span className={`px-2 py-0.5 rounded text-[9px] font-black ${resultColor(cp.result)}`}>
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

                    {/* 종합 의견 */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-[3px] bg-primary rounded-full" />
                        <h4 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                          {lang === 'ko' ? '종합 판단 근거' : 'Summary'}
                        </h4>
                      </div>
                      <div className="p-5 rounded-2xl bg-accent/20 border-l-4 border-primary">
                        <p className="text-sm font-medium leading-relaxed text-foreground/90 italic">
                          "{reasoningText || (lang === 'ko' ? '분석 데이터가 없습니다.' : 'No reasoning available.')}"
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Finalize Tab */}
              {modalTab === 'finalize' && (
                <div className="space-y-6 animate-in slide-in-from-left-4 duration-300">
                  <div className="p-5 rounded-2xl bg-accent/20 border space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{t.details.finalizeDesc}</p>
                    <div className="flex items-center gap-2">
                      {statusBadge(selectedApplicant.finalStatus, 'final')}
                      {selectedApplicant.confirmedAt && (
                        <span className="text-[10px] text-muted-foreground">
                          {t.details.alreadyFinalized}{new Date(selectedApplicant.confirmedAt).toLocaleString('ko-KR')}
                        </span>
                      )}
                    </div>
                    {selectedApplicant.confirmComment && (
                      <div className="p-3 rounded-xl bg-background/50 border text-sm italic text-foreground/80">
                        "{selectedApplicant.confirmComment}"
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{t.details.finalizeComment}</label>
                    <textarea
                      className="w-full h-24 px-4 py-3 rounded-2xl border bg-background focus:ring-4 focus:ring-primary/10 outline-none transition-all font-medium text-sm resize-none"
                      placeholder={t.details.finalizeCommentPlaceholder}
                      value={finalizeComment}
                      onChange={e => setFinalizeComment(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleFinalize('Approved')}
                      disabled={!finalizeComment.trim() || isFinalizing}
                      className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl bg-emerald-500 text-white font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isFinalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                      {t.details.approveBtn}
                    </button>
                    <button
                      onClick={() => handleFinalize('Rejected')}
                      disabled={!finalizeComment.trim() || isFinalizing}
                      className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl bg-rose-500 text-white font-black text-xs uppercase tracking-widest shadow-lg shadow-rose-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isFinalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      {t.details.rejectBtn}
                    </button>
                  </div>
                </div>
              )}

              {/* Raw Data Tab */}
              {modalTab === 'raw' && (
                <div className="space-y-4 max-h-[400px] overflow-auto pr-2 animate-in slide-in-from-right-4 duration-300">
                  <div className="rounded-2xl border bg-accent/5 overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-accent/30 border-b">
                        <tr className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                          <th className="px-5 py-3 border-r">Key</th>
                          <th className="px-5 py-3">Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-muted/10 font-medium">
                        {selectedApplicant.raw
                          ? Object.entries(selectedApplicant.raw).map(([k, v]) => (
                            <tr key={k} className="hover:bg-accent/20">
                              <td className="px-5 py-3 border-r font-black text-primary/60">{k}</td>
                              <td className="px-5 py-3 truncate max-w-[200px]" title={String(v)}>{String(v)}</td>
                            </tr>
                          ))
                          : <tr><td colSpan={2} className="px-5 py-10 text-center italic opacity-50">No raw data.</td></tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="p-8 bg-accent/10 border-t flex justify-end">
              <button onClick={() => setSelectedApplicant(null)} className="px-8 py-3 rounded-2xl bg-zinc-900 text-white font-black uppercase tracking-widest text-[10px] shadow-xl hover:bg-zinc-800 transition-all">
                {t.details.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: 프로젝트 삭제 확인 (프로젝트명 재입력)
      ============================================================ */}
      {deleteConfirmProject && (
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
              <p className="text-sm font-black text-rose-600 truncate">{deleteConfirmProject.title}</p>
            </div>

            <div className="space-y-3 mb-8">
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                {t.projects.deleteConfirmLabel}
              </label>
              <input
                type="text"
                autoFocus
                className="w-full px-5 py-4 rounded-2xl border-2 bg-background focus:ring-4 focus:ring-rose-500/10 focus:border-rose-500/50 outline-none transition-all font-bold"
                value={deleteConfirmInput}
                onChange={e => setDeleteConfirmInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && deleteConfirmInput === deleteConfirmProject.title && confirmDeleteProject()}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => { setDeleteConfirmProject(null); setDeleteConfirmInput(""); }}
                className="px-6 py-4 rounded-2xl border font-black uppercase tracking-widest text-[10px] hover:bg-accent transition-all"
              >
                {lang === 'ko' ? '취소' : 'Cancel'}
              </button>
              <button
                onClick={confirmDeleteProject}
                disabled={deleteConfirmInput !== deleteConfirmProject.title || isDeletingProject}
                className="px-6 py-4 rounded-2xl bg-rose-500 text-white font-black uppercase tracking-widest text-[10px] shadow-xl shadow-rose-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-rose-600"
              >
                {isDeletingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {t.projects.deleteConfirmBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: 업로드 결과 요약
      ============================================================ */}
      {uploadSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-md animate-in fade-in" onClick={() => setUploadSummary(null)} />
          <div className="relative w-full max-w-md rounded-[2.5rem] border bg-card shadow-2xl p-10 animate-in zoom-in-95">
            <div className="flex items-center gap-4 mb-8">
              <div className="h-14 w-14 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h3 className="text-2xl font-black tracking-tight">{t.uploadSummary.title}</h3>
            </div>

            <div className="space-y-3 mb-8">
              {[
                { label: t.uploadSummary.total, value: uploadSummary.total, color: 'text-foreground' },
                { label: t.uploadSummary.newCount, value: uploadSummary.newCount, color: 'text-primary' },
                { label: t.uploadSummary.duplicateCount, value: uploadSummary.duplicateCount, color: 'text-muted-foreground' },
                { label: t.uploadSummary.pass, value: uploadSummary.pass, color: 'text-emerald-500' },
                { label: t.uploadSummary.fail, value: uploadSummary.fail, color: 'text-rose-500' },
                { label: t.uploadSummary.pending, value: uploadSummary.pending, color: 'text-orange-500' },
                { label: t.uploadSummary.youthPassRatio, value: `${uploadSummary.youthPassRatio}%`, color: uploadSummary.youthPassRatio >= 50 ? 'text-emerald-500' : 'text-orange-500' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between p-3 rounded-xl bg-accent/20">
                  <span className="text-sm font-bold text-muted-foreground">{label}</span>
                  <span className={`text-lg font-black ${color}`}>{value}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => setUploadSummary(null)}
              className="w-full px-8 py-4 rounded-2xl bg-primary text-primary-foreground font-black uppercase tracking-widest text-[11px] shadow-xl shadow-primary/20 hover:scale-[1.02] transition-all"
            >
              {t.uploadSummary.confirm}
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: 심사 기준 설정
      ============================================================ */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-md animate-in fade-in" onClick={() => setShowSettingsModal(false)} />
          <div className="relative w-full max-w-xl rounded-[2.5rem] border bg-card shadow-2xl p-10 animate-in zoom-in-95">
            <div className="flex items-center gap-4 mb-8">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><Settings className="h-7 w-7" /></div>
              <div>
                <h3 className="text-2xl font-black tracking-tight">{t.projects.settings}</h3>
                <p className="text-sm text-muted-foreground font-medium">{t.projects.settingsDesc}</p>
              </div>
            </div>

            <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
              {/* Model Selection */}
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
                      onClick={() => setProjectModel(m.id)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-2xl border-2 transition-all ${projectModel === m.id ? 'border-primary bg-primary/5 text-primary' : 'border-transparent bg-accent/20 text-muted-foreground hover:bg-accent/40'}`}
                    >
                      {m.icon}
                      <span className="text-xs font-bold">{m.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Reference Date */}
              <div className="space-y-2.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground pl-1">{t.projects.referenceDateLabel}</label>
                <input
                  type="date"
                  className="w-full px-5 py-4 rounded-2xl border bg-background focus:ring-4 focus:ring-primary/10 outline-none transition-all font-medium text-sm"
                  placeholder={t.projects.referenceDatePlaceholder}
                  value={projectReferenceDate}
                  onChange={e => setProjectReferenceDate(e.target.value)}
                />
                <p className="text-[9px] text-muted-foreground px-1 italic">
                  {lang === 'ko' ? '* 만 나이 계산 기준일 (공고일). 미입력 시 업로드 당일 기준.' : '* Age reference date. Defaults to upload date if empty.'}
                </p>
              </div>

              {/* Criteria */}
              <div className="space-y-2.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground pl-1">{t.projects.criteriaLabel}</label>
                <textarea
                  className="w-full h-40 px-5 py-4 rounded-2xl border bg-background focus:ring-4 focus:ring-primary/10 outline-none transition-all font-medium text-sm leading-relaxed resize-none"
                  placeholder={t.projects.criteriaPlaceholder}
                  value={projectCriteria}
                  onChange={e => setProjectCriteria(e.target.value)}
                />
              </div>

              {/* AI Prompt */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between pl-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{t.projects.promptLabel}</label>
                  <button
                    type="button"
                    onClick={() => setProjectPrompt(DEFAULT_PROMPT_TEMPLATE)}
                    className="text-[9px] font-bold text-primary hover:underline"
                  >
                    {t.projects.promptResetBtn}
                  </button>
                </div>
                <textarea
                  className="w-full h-72 px-5 py-4 rounded-2xl border bg-background focus:ring-4 focus:ring-primary/10 outline-none transition-all font-mono text-xs leading-relaxed resize-y"
                  value={projectPrompt}
                  onChange={e => setProjectPrompt(e.target.value)}
                />
                <p className="text-[9px] text-muted-foreground px-1 italic">
                  {t.projects.promptHint}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-8">
              <button
                onClick={() => handleUpdateCriteria(false)}
                disabled={isUpdatingCriteria || isReEvaluating}
                className="flex-1 px-8 py-3.5 rounded-2xl bg-zinc-100 text-zinc-900 font-bold text-sm hover:bg-zinc-200 transition-all disabled:opacity-50"
              >
                {isUpdatingCriteria && !isReEvaluating ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : t.projects.saveOnly}
              </button>
              <button
                onClick={() => handleUpdateCriteria(true)}
                disabled={isUpdatingCriteria || isReEvaluating}
                className="flex-[1.5] px-8 py-3.5 rounded-2xl bg-primary text-primary-foreground font-black uppercase tracking-widest text-[11px] shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isReEvaluating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                {isReEvaluating ? t.projects.reEvaluating : t.projects.saveAndReEval}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          MODAL: 새 프로젝트 생성
      ============================================================ */}
      {showNewProjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-md animate-in fade-in" onClick={() => setShowNewProjectModal(false)} />
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
                  value={newProjectTitle}
                  onChange={e => setNewProjectTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-12">
              <button onClick={() => setShowNewProjectModal(false)} className="px-6 py-4 rounded-2xl border font-black uppercase tracking-widest text-[10px] hover:bg-accent transition-all">
                {lang === 'ko' ? '취소' : 'Cancel'}
              </button>
              <button
                onClick={handleCreateProject}
                disabled={!newProjectTitle.trim() || isCreatingProject}
                className="px-6 py-4 rounded-2xl bg-primary text-primary-foreground font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isCreatingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {t.projects.create}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
