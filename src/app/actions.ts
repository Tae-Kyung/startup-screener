'use server';

import { parseExcel, ApplicantData } from '@/lib/excel-utils';
import { simulateLLMCheck, LLMResult, analyzePDFsWithOpenAI } from '@/lib/llm-engine';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

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
    .order('task_number', { ascending: true });

  if (error) throw error;
  if (!applicants || applicants.length === 0) return { success: false, error: '데이터가 없습니다.' };

  // ── 헬퍼 ──────────────────────────────────────────────────────
  const parseReasoning = (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.checkpoints) return parsed as { reasoning: string; checkpoints: Array<{ criterion: string; document: string; finding: string; result: string }> };
    } catch { /* plain text */ }
    return null;
  };

  const llmKo  = (v: string) => v === 'Pass' ? '적합' : v === 'Fail' ? '부적합' : '검토필요';
  const finalKo = (v: string) => v === 'Approved' ? '승인' : v === 'Rejected' ? '반려' : '검토중';

  // ── 색상 팔레트 ───────────────────────────────────────────────
  const C = {
    headerBg:   '1F3864',  // 진남색 헤더
    headerFont: 'FFFFFF',
    approved:   'D9F2E6',  // 연초록 (승인)
    rejected:   'FDDEDE',  // 연빨강 (반려)
    pending:    'FFF9DB',  // 연노랑 (검토중)
    passFont:   '1E7E34',  // 진초록 글씨
    failFont:   'C0392B',  // 진빨강 글씨
    pendFont:   'B7791F',  // 주황 글씨
    border:     'BDC3C7',
    subHeader:  'D6E4F0',  // 소제목행 배경
  } as const;

  const borderThin = (color = C.border) => ({
    top:    { style: 'thin' as const, color: { argb: color } },
    bottom: { style: 'thin' as const, color: { argb: color } },
    left:   { style: 'thin' as const, color: { argb: color } },
    right:  { style: 'thin' as const, color: { argb: color } },
  });

  const rowBg = (finalStatus: string) =>
    finalStatus === 'Approved' ? C.approved : finalStatus === 'Rejected' ? C.rejected : C.pending;

  const statusFont = (val: string) =>
    val === '적합' || val === '승인' ? C.passFont : val === '부적합' || val === '반려' ? C.failFont : C.pendFont;

  const applyHeader = (row: ExcelJS.Row) => {
    row.height = 26;
    row.eachCell(cell => {
      cell.font      = { bold: true, color: { argb: C.headerFont }, size: 11 };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headerBg } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border    = borderThin();
    });
  };

  const applyDataCell = (cell: ExcelJS.Cell, bg: string) => {
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    cell.border    = borderThin();
    cell.alignment = { vertical: 'middle', wrapText: true };
  };

  // ── 워크북 생성 ───────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AI 서류 심사 시스템';
  wb.created = new Date();

  // ════════════════════════════════════════════════════════════════
  // Sheet 1: 지원자 요약
  // ════════════════════════════════════════════════════════════════
  const ws1 = wb.addWorksheet('지원자 요약');
  ws1.columns = [
    { key: 'no',           header: 'No.',       width: 6  },
    { key: 'task_number',  header: '과제번호',   width: 14 },
    { key: 'name',         header: '성명',       width: 10 },
    { key: 'enterprise',   header: '기업명',     width: 24 },
    { key: 'history_type', header: '창업유형',   width: 14 },
    { key: 'hq',           header: '본점 소재지', width: 24 },
    { key: 'residence',    header: '거주지',     width: 24 },
    { key: 'birth_date',   header: '생년월일',   width: 13 },
    { key: 'age',          header: '나이',       width: 7  },
    { key: 'is_youth',     header: '청년여부',   width: 10 },
    { key: 'is_regional',  header: '권역여부',   width: 10 },
    { key: 'llm_status',   header: 'AI 판단',    width: 10 },
    { key: 'final_status', header: '최종상태',   width: 10 },
    { key: 'fail_items',   header: '부적합 항목', width: 34 },
    { key: 'reasoning',    header: '종합 판단 근거', width: 54 },
    { key: 'comment',      header: '확정 의견',  width: 30 },
  ];

  applyHeader(ws1.getRow(1));
  ws1.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];
  ws1.autoFilter = { from: 'A1', to: { row: 1, column: ws1.columns.length } };

  applicants.forEach((a: any, idx: number) => {
    const parsed    = parseReasoning(a.llm_reasoning || '');
    const failItems = parsed?.checkpoints?.filter(c => c.result === '부적합').map(c => c.criterion).join(', ') || '-';
    const llmLabel  = llmKo(a.llm_status || '');
    const finalLabel = finalKo(a.final_status || '');

    const row = ws1.addRow({
      no:           idx + 1,
      task_number:  a.task_number,
      name:         a.name || '-',
      enterprise:   a.enterprise_name || '-',
      history_type: a.history_type || '-',
      hq:           a.location_headquarters || '-',
      residence:    a.residence || '-',
      birth_date:   a.birth_date || '-',
      age:          a.age != null ? a.age : '-',
      is_youth:     a.is_youth === true ? '청년' : a.is_youth === false ? '비청년' : '-',
      is_regional:  a.is_regional === true ? '권역내' : a.is_regional === false ? '권역외' : '-',
      llm_status:   llmLabel,
      final_status: finalLabel,
      fail_items:   failItems,
      reasoning:    parsed?.reasoning || a.llm_reasoning || '-',
      comment:      a.confirm_comment || '-',
    });

    const bg = rowBg(a.final_status || '');
    row.height = 20;
    row.eachCell(cell => applyDataCell(cell, bg));

    // AI판단·최종상태 컬럼 글씨 색상
    const llmCell   = row.getCell('llm_status');
    const finalCell = row.getCell('final_status');
    llmCell.font   = { bold: true, color: { argb: statusFont(llmLabel) } };
    finalCell.font = { bold: true, color: { argb: statusFont(finalLabel) } };
    // 과제번호 가운데 정렬
    row.getCell('no').alignment          = { horizontal: 'center', vertical: 'middle' };
    row.getCell('task_number').alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell('age').alignment         = { horizontal: 'center', vertical: 'middle' };
    row.getCell('is_youth').alignment    = { horizontal: 'center', vertical: 'middle' };
    row.getCell('is_regional').alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell('llm_status').alignment  = { horizontal: 'center', vertical: 'middle' };
    row.getCell('final_status').alignment= { horizontal: 'center', vertical: 'middle' };
  });

  // ════════════════════════════════════════════════════════════════
  // Sheet 2: 체크포인트 상세
  // ════════════════════════════════════════════════════════════════
  const ws2 = wb.addWorksheet('체크포인트 상세');
  ws2.columns = [
    { key: 'task_number',  header: '과제번호',   width: 14 },
    { key: 'name',         header: '성명',       width: 10 },
    { key: 'enterprise',   header: '기업명',     width: 24 },
    { key: 'final_status', header: '최종상태',   width: 10 },
    { key: 'criterion',    header: '심사 항목',  width: 18 },
    { key: 'document',     header: '확인 서류',  width: 30 },
    { key: 'finding',      header: '확인 내용',  width: 54 },
    { key: 'result',       header: '결과',       width: 10 },
  ];

  applyHeader(ws2.getRow(1));
  ws2.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];
  ws2.autoFilter = { from: 'A1', to: { row: 1, column: ws2.columns.length } };

  for (const a of applicants as any[]) {
    const parsed      = parseReasoning(a.llm_reasoning || '');
    const finalLabel  = finalKo(a.final_status || '');
    const bg          = rowBg(a.final_status || '');

    const cpList = parsed?.checkpoints?.length
      ? parsed.checkpoints
      : [{ criterion: '종합 분석', document: '-', finding: a.llm_reasoning || '-', result: a.llm_status === 'Pass' ? '적합' : a.llm_status === 'Fail' ? '부적합' : '확인불가' }];

    for (const cp of cpList) {
      const row = ws2.addRow({
        task_number:  a.task_number,
        name:         a.name || '-',
        enterprise:   a.enterprise_name || '-',
        final_status: finalLabel,
        criterion:    cp.criterion,
        document:     cp.document,
        finding:      cp.finding,
        result:       cp.result,
      });

      row.height = 20;
      row.eachCell(cell => applyDataCell(cell, bg));

      // 결과 컬럼 색상
      const resultCell = row.getCell('result');
      const resultColor =
        cp.result === '적합'  ? C.passFont :
        cp.result === '부적합' ? C.failFont : C.pendFont;
      resultCell.font      = { bold: true, color: { argb: resultColor } };
      resultCell.alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell('task_number').alignment  = { horizontal: 'center', vertical: 'middle' };
      row.getCell('final_status').alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell('final_status').font = { bold: true, color: { argb: statusFont(finalLabel) } };
    }
  }

  // ── 컬럼 너비 자동 조정 (내용 기준) ──────────────────────────
  const autoFitColumns = (ws: ExcelJS.Worksheet) => {
    ws.columns.forEach(col => {
      if (!col.key || !col.eachCell) return;
      let maxLen = col.header ? String(col.header).length : 10;
      col.eachCell({ includeEmpty: false }, (cell: ExcelJS.Cell) => {
        const val = cell.value != null ? String(cell.value) : '';
        const lines = val.split('\n');
        const len = lines.reduce((m: number, l: string) => Math.max(m, l.length), 0);
        maxLen = Math.max(maxLen, len);
      });
      col.width = Math.min(Math.max(maxLen + 2, 8), 60);
    });
  };
  autoFitColumns(ws1);
  autoFitColumns(ws2);

  // ── base64로 반환 ─────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const filename = `${project?.title || 'screening'}_심사결과_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return { success: true, data: base64 as string, filename };
}

// ----------------------------------------------------------------
// Supabase pdf-temp 버킷에서 해당 유저의 잔여 파일 전체 삭제
// ----------------------------------------------------------------
export async function cleanupStorageAction(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 유저 폴더 아래 과제번호 폴더 목록
  const { data: taskFolders } = await adminSupabase.storage
    .from('pdf-temp')
    .list(user.id, { limit: 200 });

  if (!taskFolders?.length) return;

  for (const tf of taskFolders) {
    const prefix = `${user.id}/${tf.name}`;
    const { data: files } = await adminSupabase.storage
      .from('pdf-temp')
      .list(prefix, { limit: 200 });

    if (files?.length) {
      await adminSupabase.storage
        .from('pdf-temp')
        .remove(files.map(f => `${prefix}/${f.name}`));
    }
  }
}

// ----------------------------------------------------------------
// Excel 데이터로 기존 레코드의 빈 필드 일괄 업데이트
// ----------------------------------------------------------------
export async function syncExcelDataAction(
  excelBase64: string,
  projectId: string
): Promise<{ updated: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');

  const { data: project } = await supabase
    .from('screen_projects')
    .select('reference_date')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  const buf = Buffer.from(excelBase64, 'base64');
  const refDate = project?.reference_date ? new Date(project.reference_date) : undefined;
  const applicants = parseExcel(buf, refDate);

  const sanitizeBD = (bd?: string): string | null => {
    if (!bd) return null;
    if (/^\d{4}[\.\-]\d{2}[\.\-]\d{2}$/.test(bd)) return bd.replace(/\./g, '-');
    if (/^\d{8}$/.test(bd)) return `${bd.slice(0, 4)}-${bd.slice(4, 6)}-${bd.slice(6, 8)}`;
    return null;
  };

  let updated = 0;
  for (const app of applicants) {
    const { error } = await supabase
      .from('screen_applicants')
      .update({
        name: app.name || undefined,
        birth_date: sanitizeBD(app.birthDate) ?? undefined,
        enterprise_name: app.enterpriseName || undefined,
        history_type: app.historyType || undefined,
        location_headquarters: app.locationHeadquarters || undefined,
        residence: app.residence || undefined,
        age: app.age ?? undefined,
        is_youth: app.isYouth ?? undefined,
        is_regional: app.isRegional ?? undefined,
        raw_data: app.raw ?? undefined,
      })
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .eq('task_number', app.taskNumber);
    if (!error) updated++;
  }

  return { updated };
}

// ----------------------------------------------------------------
// 업로드 전 스킵 여부 사전 조회 (이미 Pass/Fail인 과제 필터링)
// ----------------------------------------------------------------
export async function getSkippedTasksAction(
  taskNumbers: string[],
  projectId: string
): Promise<Set<string>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');

  const { data } = await supabase
    .from('screen_applicants')
    .select('task_number, llm_status')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .in('task_number', taskNumbers)
    .in('llm_status', ['Pass', 'Fail']);

  return new Set((data ?? []).map((r: any) => String(r.task_number)));
}

// ----------------------------------------------------------------
// PDF 업로드용 Signed Upload URL 생성 (서비스 롤 키 사용)
// ----------------------------------------------------------------
export async function getSignedUploadUrlsAction(
  paths: string[]
): Promise<Array<{ path: string; signedUrl: string; token: string }>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const results = await Promise.all(paths.map(async (path) => {
    const { data, error } = await adminSupabase.storage
      .from('pdf-temp')
      .createSignedUploadUrl(path);
    if (error || !data) {
      console.error('[getSignedUploadUrlsAction] URL 생성 실패:', path, error);
      throw new Error(`업로드 URL 생성 실패: ${error?.message}`);
    }
    return { path, signedUrl: data.signedUrl, token: data.token };
  }));

  return results;
}

// ----------------------------------------------------------------
// PDF 서류 AI 심사 (Supabase Storage 경유 - Vercel 용량 제한 우회)
// ----------------------------------------------------------------
export async function processDatasetAction(payload: {
  taskNumber: string;
  excelBase64: string | null;
  pdfPaths: Array<{ name: string; storagePath: string }>;
  projectId: string;
}): Promise<{ pass: number; fail: number; pending: number; skipped?: boolean }> {
  const { taskNumber, excelBase64, pdfPaths, projectId } = payload;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');

  const { data: project } = await supabase
    .from('screen_projects')
    .select('criteria, model, reference_date')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  // ── Excel 파싱 ───────────────────────────────────────────────
  const excelMap = new Map<string, ReturnType<typeof parseExcel>[number]>();
  if (excelBase64) {
    const buf = Buffer.from(excelBase64, 'base64');
    const refDate = project?.reference_date ? new Date(project.reference_date) : undefined;
    for (const app of parseExcel(buf, refDate)) {
      excelMap.set(app.taskNumber, app);
    }
  }

  // ── 기존 DB 레코드 확인 ──────────────────────────────────────
  const { data: existing } = await supabase
    .from('screen_applicants')
    .select('id, llm_status, final_status')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .eq('task_number', taskNumber)
    .single();
  const existingId = existing?.id ?? null;

  // ── 이미 처리된 과제는 스킵 ──────────────────────────────────
  if (existing?.llm_status === 'Pass' || existing?.llm_status === 'Fail') {
    return {
      pass: existing.final_status === 'Approved' ? 1 : 0,
      fail: existing.final_status === 'Rejected' ? 1 : 0,
      pending: 0,
      skipped: true,
    };
  }

  const sanitizeBD = (bd?: string): string | null => {
    if (!bd) return null;
    if (/^\d{4}[\.\-]\d{2}[\.\-]\d{2}$/.test(bd)) return bd.replace(/\./g, '-');
    if (/^\d{8}$/.test(bd)) return `${bd.slice(0, 4)}-${bd.slice(4, 6)}-${bd.slice(6, 8)}`;
    return null;
  };

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let pass = 0, fail = 0, pending = 0;
  const excelData = excelMap.get(taskNumber) ?? null;
  const openaiFileIds: string[] = [];

  try {
    // 1. Supabase signed URL 생성 → OpenAI Files API 업로드
    const pdfsForAnalysis = await Promise.all(pdfPaths.map(async ({ name, storagePath }) => {
      // 업로드 직후 일시적으로 파일이 조회 안 될 수 있으므로 최대 3회 재시도
      let urlData: { signedUrl: string } | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
        const { data, error: urlError } = await adminSupabase.storage
          .from('pdf-temp')
          .createSignedUrl(storagePath, 120);
        if (!urlError && data?.signedUrl) { urlData = data; break; }
        console.warn(`[processDatasetAction][${taskNumber}] Signed URL 재시도 ${attempt + 1}:`, storagePath, urlError);
      }
      if (!urlData?.signedUrl) {
        console.error(`[processDatasetAction][${taskNumber}] Signed URL 생성 실패:`, storagePath);
        throw new Error(`Signed URL 생성 실패: ${name}`);
      }

      const res = await fetch(urlData!.signedUrl);
      if (!res.ok) {
        console.error(`[processDatasetAction][${taskNumber}] PDF 다운로드 실패:`, name, res.status);
        throw new Error(`PDF 다운로드 실패: ${name} (HTTP ${res.status})`);
      }
      const buffer = await res.arrayBuffer();

      const uploaded = await openaiClient.files.create({
        file: new File([buffer], name, { type: 'application/pdf' }),
        purpose: 'user_data',
      });
      openaiFileIds.push(uploaded.id);
      return { name, fileId: uploaded.id };
    }));

    // OpenAI 업로드 완료 즉시 Supabase 파일 삭제 (타임아웃 대비)
    if (pdfPaths.length > 0) {
      await adminSupabase.storage.from('pdf-temp').remove(pdfPaths.map(p => p.storagePath));
    }

    // 2. LLM 분석
    const llmResult = await analyzePDFsWithOpenAI(
      pdfsForAnalysis,
      {
        taskNumber,
        historyType: excelData?.historyType,
        locationHeadquarters: excelData?.locationHeadquarters,
        residence: excelData?.residence,
        birthDate: excelData?.birthDate,
      },
      project?.criteria,
      project?.model || 'gpt-4o'
    );

    const finalStatus =
      llmResult.status === 'Pass' ? 'Approved'
      : llmResult.status === 'Fail' ? 'Rejected'
      : 'Pending';

    if (finalStatus === 'Approved') pass++;
    else if (finalStatus === 'Rejected') fail++;
    else pending++;

    const llmReasoningToStore = llmResult.checkpoints
      ? JSON.stringify({ reasoning: llmResult.reasoning, checkpoints: llmResult.checkpoints })
      : llmResult.reasoning;

    // PDF 추출 데이터 우선, 없으면 Excel 데이터 사용
    const ext = llmResult.extractedData ?? {};
    const resolvedName             = ext.name             || excelData?.name             || `지원자_${taskNumber}`;
    const resolvedEnterpriseName   = ext.enterpriseName   || excelData?.enterpriseName   || null;
    const resolvedHistoryType      = ext.historyType      || excelData?.historyType      || null;
    const resolvedLocation         = ext.locationHeadquarters || excelData?.locationHeadquarters || null;
    const resolvedResidence        = ext.residence        || excelData?.residence        || null;
    const resolvedBirthDate        = sanitizeBD(ext.birthDate || excelData?.birthDate);

    // 나이/청년/권역 계산 (생년월일 기반)
    const { calculateAge, checkRegional } = await import('@/lib/excel-utils');
    const refDate = project?.reference_date ? new Date(project.reference_date) : undefined;
    const resolvedAge = resolvedBirthDate ? calculateAge(resolvedBirthDate, refDate) : (excelData?.age ?? null);
    const resolvedIsYouth = resolvedAge != null && resolvedAge > 0 ? resolvedAge <= 39 : (excelData?.isYouth ?? null);
    const resolvedIsRegional = resolvedHistoryType?.includes('예비')
      ? checkRegional(resolvedResidence ?? '')
      : checkRegional(resolvedLocation ?? '');

    if (existingId) {
      const { error } = await supabase.from('screen_applicants').update({
        name: resolvedName,
        enterprise_name: resolvedEnterpriseName,
        history_type: resolvedHistoryType,
        location_headquarters: resolvedLocation,
        residence: resolvedResidence,
        birth_date: resolvedBirthDate,
        age: resolvedAge,
        is_youth: resolvedIsYouth,
        is_regional: resolvedIsRegional,
        llm_status: llmResult.status,
        llm_reasoning: llmReasoningToStore,
        final_status: finalStatus,
        updated_at: new Date().toISOString(),
      }).eq('id', existingId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('screen_applicants').insert({
        project_id: projectId,
        user_id: user.id,
        task_number: taskNumber,
        name: resolvedName,
        birth_date: resolvedBirthDate,
        enterprise_name: resolvedEnterpriseName,
        history_type: resolvedHistoryType,
        location_headquarters: resolvedLocation,
        residence: resolvedResidence,
        age: resolvedAge,
        is_youth: resolvedIsYouth,
        is_regional: resolvedIsRegional,
        rule_status: null,
        llm_status: llmResult.status,
        llm_reasoning: llmReasoningToStore,
        final_status: finalStatus,
        raw_data: excelData?.raw ?? null,
      });
      if (error) throw error;
    }
  } catch (err) {
    pending++;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[processDatasetAction][${taskNumber}] 처리 실패:`, err);
    try {
      if (existingId) {
        await supabase.from('screen_applicants').update({
          llm_status: 'Pending',
          llm_reasoning: `처리 오류: ${errMsg}. 수동 확인이 필요합니다.`,
          final_status: 'Pending',
          updated_at: new Date().toISOString(),
        }).eq('id', existingId);
      } else {
        await supabase.from('screen_applicants').insert({
          project_id: projectId,
          user_id: user.id,
          task_number: taskNumber,
          name: excelData?.name || `지원자_${taskNumber}`,
          birth_date: sanitizeBD(excelData?.birthDate),
          enterprise_name: excelData?.enterpriseName ?? null,
          history_type: excelData?.historyType ?? null,
          location_headquarters: excelData?.locationHeadquarters ?? null,
          residence: excelData?.residence ?? null,
          age: excelData?.age ?? null,
          is_youth: excelData?.isYouth ?? null,
          is_regional: excelData?.isRegional ?? null,
          rule_status: null,
          llm_status: 'Pending',
          llm_reasoning: `처리 오류: ${errMsg}. 수동 확인이 필요합니다.`,
          final_status: 'Pending',
          raw_data: excelData?.raw ?? null,
        });
      }
    } catch { /* DB fallback 실패 무시 */ }
  } finally {
    // 3. 분석 완료 후 즉시 삭제 (성공/실패 무관)
    // OpenAI 파일 삭제 (Supabase는 업로드 직후 이미 삭제됨)
    await Promise.allSettled(
      openaiFileIds.map(id => openaiClient.files.delete(id))
    );
  }

  return { pass, fail, pending };
}
