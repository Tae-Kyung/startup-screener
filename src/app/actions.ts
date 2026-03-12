'use server';

import { parseExcel, ApplicantData } from '@/lib/excel-utils';
import { simulateLLMCheck, LLMResult } from '@/lib/llm-engine';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

// ----------------------------------------------------------------
// 유틸: 배치 처리 (Rate Limit 방지용 5건씩 순차 처리)
// ----------------------------------------------------------------
async function runInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ----------------------------------------------------------------
// 유틸: LLM 결과 → final_status 매핑
// ----------------------------------------------------------------
function llmToFinalStatus(
  llmStatus: 'Pass' | 'Fail' | 'Pending'
): 'Approved' | 'Rejected' | 'Pending' {
  if (llmStatus === 'Pass') return 'Approved';
  if (llmStatus === 'Fail') return 'Rejected';
  return 'Pending';
}

// ----------------------------------------------------------------
// 유틸: LLM 호출 재시도 래퍼 (최대 2회)
// ----------------------------------------------------------------
async function callLLMWithRetry(
  ...args: Parameters<typeof simulateLLMCheck>
): Promise<LLMResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await simulateLLMCheck(...args);
    } catch (e) {
      lastError = e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return {
    status: 'Pending',
    reasoning: `LLM 호출 실패 (재시도 2회): ${lastError instanceof Error ? lastError.message : '알 수 없는 오류'}`,
  };
}

// ================================================================
// 프로젝트 관리
// ================================================================

export async function createProjectAction(title: string, description?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data, error } = await supabase
    .from('screen_projects')
    .insert([{ title, description, user_id: user.id }])
    .select()
    .single();

  if (error) throw error;
  return { success: true, data };
}

export async function deleteProjectAction(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { error } = await supabase
    .from('screen_projects')
    .delete()
    .eq('id', projectId)
    .eq('user_id', user.id);

  if (error) throw error;
  return { success: true };
}

export async function getProjectsAction() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data, error } = await supabase
    .from('screen_projects')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return { success: true, data };
}

export async function getProjectApplicantsAction(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data, error } = await supabase
    .from('screen_applicants')
    .select('*')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const formattedData = (data || []).map((app: any) => ({
    id: app.id,
    name: app.name,
    taskNumber: app.task_number,
    birthDate: app.birth_date,
    enterpriseName: app.enterprise_name,
    historyType: app.history_type,
    locationHeadquarters: app.location_headquarters,
    residence: app.residence,
    age: app.age,
    isYouth: app.is_youth,
    isRegional: app.is_regional,
    ruleStatus: app.rule_status,
    llmStatus: app.llm_status,
    llmReasoning: app.llm_reasoning,
    finalStatus: app.final_status,
    confirmedBy: app.confirmed_by,
    confirmedAt: app.confirmed_at,
    confirmComment: app.confirm_comment,
    raw: app.raw_data,
  }));

  return { success: true, data: formattedData };
}

// ================================================================
// 엑셀 처리 (업로드 → 파싱 → LLM → 크로스체크 → DB 저장)
// ================================================================

export async function processExcelAction(formData: FormData, projectId: string) {
  const file = formData.get('file') as File;
  if (!file) throw new Error('No file provided');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // 프로젝트 설정 로드
  const { data: project } = await supabase
    .from('screen_projects')
    .select('criteria, prompt, model, reference_date')
    .eq('id', projectId)
    .single();

  const referenceDate = project?.reference_date
    ? new Date(project.reference_date)
    : undefined;

  // 엑셀 파싱
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const applicants = parseExcel(buffer, referenceDate);

  // 중복 감지: 기존 task_number 조회
  const { data: existing } = await supabase
    .from('screen_applicants')
    .select('task_number')
    .eq('project_id', projectId);

  const existingTaskNumbers = new Set((existing || []).map((r: any) => r.task_number));
  const newApplicants = applicants.filter(a => !existingTaskNumbers.has(a.taskNumber));
  const duplicateCount = applicants.length - newApplicants.length;

  if (newApplicants.length === 0) {
    return {
      success: true,
      data: [],
      summary: {
        total: applicants.length,
        newCount: 0,
        duplicateCount,
        pass: 0,
        fail: 0,
        pending: 0,
        youthPassRatio: 0,
      },
    };
  }

  // LLM 배치 처리 (5건씩)
  const llmResults = await runInBatches(newApplicants, 5, (applicant) =>
    callLLMWithRetry(
      applicant.name,
      applicant.historyType,
      applicant.locationHeadquarters,
      applicant.residence,
      applicant.birthDate,
      project?.criteria,
      project?.prompt,
      project?.model
    )
  );

  // LLM 결과 조합 (규칙 엔진 미사용)
  const processedApplicants = newApplicants.map((applicant, i) => {
    const { status: llmStatus, reasoning: llmReasoning } = llmResults[i];
    const finalStatus = llmToFinalStatus(llmStatus);
    return { ...applicant, llmStatus, llmReasoning, finalStatus };
  });

  // 생년월일 포맷 정규화 (Postgres DATE 타입 대응)
  const sanitizeBirthDate = (bd: string): string | null => {
    if (!bd) return null;
    if (/^\d{4}[\.\-]\d{2}[\.\-]\d{2}$/.test(bd)) return bd.replace(/\./g, '-');
    if (/^\d{8}$/.test(bd))
      return `${bd.substring(0, 4)}-${bd.substring(4, 6)}-${bd.substring(6, 8)}`;
    return null;
  };

  // DB 저장
  const dbApplicants = processedApplicants.map(app => ({
    project_id: projectId,
    user_id: user.id,
    task_number: app.taskNumber,
    name: app.name,
    birth_date: sanitizeBirthDate(app.birthDate),
    enterprise_name: app.enterpriseName,
    history_type: app.historyType,
    location_headquarters: app.locationHeadquarters,
    residence: app.residence,
    age: app.age,
    is_youth: app.isYouth,
    is_regional: app.isRegional,
    rule_status: null,
    llm_status: app.llmStatus,
    llm_reasoning: app.llmReasoning,
    final_status: app.finalStatus,
    raw_data: app.raw,
  }));

  const { error: insertError } = await supabase
    .from('screen_applicants')
    .insert(dbApplicants);

  if (insertError) {
    console.error('Supabase Insert Error:', insertError);
    throw new Error(`DB 저장 실패: ${insertError.message}`);
  }

  // 요약 통계
  const passCount = processedApplicants.filter(a => a.finalStatus === 'Approved').length;
  const failCount = processedApplicants.filter(a => a.finalStatus === 'Rejected').length;
  const pendingCount = processedApplicants.filter(a => a.finalStatus === 'Pending').length;
  const passApplicants = processedApplicants.filter(a => a.finalStatus === 'Approved');
  const youthPassRatio = passApplicants.length > 0
    ? Math.round((passApplicants.filter(a => a.isYouth).length / passApplicants.length) * 100)
    : 0;

  return {
    success: true,
    data: JSON.parse(JSON.stringify(processedApplicants)),
    summary: {
      total: applicants.length,
      newCount: newApplicants.length,
      duplicateCount,
      pass: passCount,
      fail: failCount,
      pending: pendingCount,
      youthPassRatio,
    },
  };
}

// ================================================================
// 수동 확정 워크플로우
// ================================================================

export async function finalizeApplicantAction(
  applicantId: string,
  finalStatus: 'Approved' | 'Rejected',
  comment: string
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { error } = await supabase
    .from('screen_applicants')
    .update({
      final_status: finalStatus,
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
      confirm_comment: comment,
      updated_at: new Date().toISOString(),
    })
    .eq('id', applicantId)
    .eq('user_id', user.id);

  if (error) throw error;
  return { success: true };
}

// ================================================================
// 프로젝트 설정 업데이트
// ================================================================

export async function updateProjectSettingsAction(
  projectId: string,
  settings: { criteria?: string; prompt?: string; model?: string; reference_date?: string }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { error } = await supabase
    .from('screen_projects')
    .update({ ...settings, updated_at: new Date().toISOString() })
    .eq('id', projectId)
    .eq('user_id', user.id);

  if (error) throw error;
  return { success: true };
}

// ================================================================
// 재평가 (기준 변경 후 전체 재심사)
// ================================================================

export async function reEvaluateApplicantsAction(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data: project } = await supabase
    .from('screen_projects')
    .select('criteria, prompt, model, reference_date')
    .eq('id', projectId)
    .single();

  const { data: applicants, error: fetchError } = await supabase
    .from('screen_applicants')
    .select('*')
    .eq('project_id', projectId)
    .eq('user_id', user.id);

  if (fetchError) throw fetchError;
  if (!applicants || applicants.length === 0) return { success: true, count: 0 };

  // LLM 배치 처리 (5건씩)
  const llmResults = await runInBatches(applicants, 5, (app) =>
    callLLMWithRetry(
      app.name,
      app.history_type,
      app.location_headquarters,
      app.residence,
      app.birth_date,
      project?.criteria,
      project?.prompt,
      project?.model
    )
  );

  // LLM 결과로 업데이트 목록 생성 (규칙 엔진 미사용)
  const updates = applicants.map((app, i) => {
    const { status: llmStatus, reasoning: llmReasoning } = llmResults[i];
    const finalStatus = llmToFinalStatus(llmStatus);
    return {
      id: app.id,
      rule_status: null,
      llm_status: llmStatus,
      llm_reasoning: llmReasoning,
      final_status: finalStatus,
      // 재평가 시 수동 확정은 초기화하지 않음 (confirmed_by/at/comment 유지)
      updated_at: new Date().toISOString(),
    };
  });

  const { error: updateError } = await supabase
    .from('screen_applicants')
    .upsert(updates);

  if (updateError) throw updateError;
  return { success: true, count: updates.length };
}

// ================================================================
// 스키마 마이그레이션 체크
// ================================================================

export async function runMigrationAction() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  try {
    const { error: checkError } = await supabase
      .from('screen_projects')
      .select('criteria, updated_at')
      .limit(1);

    if (checkError && checkError.code === '42703') {
      return {
        success: false,
        error: 'DB 스키마 불일치: 누락된 컬럼이 있습니다. docs/schema.sql 및 docs/migration_v2.sql을 Supabase SQL Editor에서 실행하세요.',
        sql: '-- docs/schema.sql 과 docs/migration_v2.sql 파일을 순서대로 실행하세요.',
      };
    }
  } catch (e) {
    console.error('Migration check error:', e);
  }

  return { success: true, message: 'Schema is up to date.' };
}

// ================================================================
// 체크포인트 엑셀 다운로드
// ================================================================

export async function exportCheckpointsAction(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data: project } = await supabase
    .from('screen_projects')
    .select('title')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  const { data: applicants, error } = await supabase
    .from('screen_applicants')
    .select('*')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) throw error;
  if (!applicants || applicants.length === 0) return { success: false, error: '데이터가 없습니다.' };

  // ── llm_reasoning 파싱 헬퍼 ──────────────────────────────────
  const parseReasoning = (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.checkpoints) return parsed as { reasoning: string; checkpoints: Array<{ criterion: string; document: string; finding: string; result: string }> };
    } catch { /* plain text */ }
    return null;
  };

  // ── Sheet 1: 지원자 요약 ──────────────────────────────────────
  const summaryRows = applicants.map((a: any) => {
    const parsed = parseReasoning(a.llm_reasoning || '');
    const failItems = parsed?.checkpoints?.filter(c => c.result === '부적합').map(c => c.criterion).join(', ') || '';
    return {
      '과제번호': a.task_number,
      '성명': a.name,
      '기업명': a.enterprise_name || '',
      '창업유형': a.history_type || '',
      '소재지': a.location_headquarters || '',
      '거주지': a.residence || '',
      '청년여부': a.is_youth ? '청년' : '비청년',
      'AI판단': a.llm_status || '',
      '최종상태': a.final_status || '',
      '부적합 항목': failItems,
      '종합판단근거': parsed?.reasoning || a.llm_reasoning || '',
      '확정자': a.confirmed_by ? '확정됨' : '',
      '확정의견': a.confirm_comment || '',
    };
  });

  // ── Sheet 2: 체크포인트 상세 ──────────────────────────────────
  const checkpointRows: object[] = [];
  for (const a of applicants as any[]) {
    const parsed = parseReasoning(a.llm_reasoning || '');
    if (parsed?.checkpoints?.length) {
      for (const cp of parsed.checkpoints) {
        checkpointRows.push({
          '과제번호': a.task_number,
          '성명': a.name,
          '기업명': a.enterprise_name || '',
          'AI판단': a.llm_status || '',
          '최종상태': a.final_status || '',
          '심사항목': cp.criterion,
          '확인서류': cp.document,
          '확인내용': cp.finding,
          '결과': cp.result,
        });
      }
    } else {
      // 체크포인트 없는 경우 (엑셀 기반 분석)
      checkpointRows.push({
        '과제번호': a.task_number,
        '성명': a.name,
        '기업명': a.enterprise_name || '',
        'AI판단': a.llm_status || '',
        '최종상태': a.final_status || '',
        '심사항목': '(텍스트 분석)',
        '확인서류': '-',
        '확인내용': a.llm_reasoning || '',
        '결과': a.llm_status === 'Pass' ? '적합' : a.llm_status === 'Fail' ? '부적합' : '확인불가',
      });
    }
  }

  // ── 워크북 생성 ───────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  // 컬럼 너비 설정
  wsSummary['!cols'] = [
    { wch: 12 }, { wch: 8 }, { wch: 20 }, { wch: 12 }, { wch: 20 },
    { wch: 20 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 30 },
    { wch: 50 }, { wch: 8 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, '지원자 요약');

  const wsCheckpoints = XLSX.utils.json_to_sheet(checkpointRows);
  wsCheckpoints['!cols'] = [
    { wch: 12 }, { wch: 8 }, { wch: 20 }, { wch: 8 }, { wch: 8 },
    { wch: 15 }, { wch: 25 }, { wch: 50 }, { wch: 8 },
  ];
  XLSX.utils.book_append_sheet(wb, wsCheckpoints, '체크포인트 상세');

  // ── base64로 반환 ─────────────────────────────────────────────
  const buf = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const filename = `${project?.title || 'screening'}_체크포인트_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return { success: true, data: buf as string, filename };
}
