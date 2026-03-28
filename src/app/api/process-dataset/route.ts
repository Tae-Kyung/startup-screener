import { NextRequest, NextResponse } from 'next/server';
import type { ApplicantData } from '@/lib/excel-utils';
import { analyzePDFsWithOpenAI } from '@/lib/llm-engine';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { perfLog } from '@/lib/perf-logger';
import OpenAI from 'openai';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const projectId = new URL(request.url).searchParams.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'projectId가 필요합니다.' }, { status: 400 });

  const { taskNumber, excelData, pdfPaths, prefetched } = await request.json() as {
    taskNumber: string;
    excelData: Omit<ApplicantData, 'raw'> | null;
    pdfPaths: Array<{ name: string; storagePath: string }>;
    prefetched?: {
      project: { criteria: string | null; model: string | null; reference_date: string | null } | null;
      existing: { id: string; llm_status: string; final_status: string } | null;
    };
  };

  const _t0 = Date.now();

  // ── 프로젝트 설정: 사전 조회 값 우선 ────────────────────────────
  let project = prefetched?.project;
  if (project === undefined) {
    const { data } = await supabase
      .from('screen_projects')
      .select('criteria, model, reference_date')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();
    project = data ?? null;
  }

  // ── 프로젝트 존재 확인 (FK 제약 사전 차단) ─────────────────────
  // project가 null이면 해당 projectId가 없거나 다른 유저 소유 → INSERT 시 FK 위반 발생
  if (project === null) {
    const adminSupabaseCheck = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: projectExists } = await adminSupabaseCheck
      .from('screen_projects')
      .select('id')
      .eq('id', projectId)
      .maybeSingle();
    if (!projectExists) {
      perfLog(`[PERF][${taskNumber}] 오류: projectId(${projectId})가 DB에 존재하지 않음`);
      return NextResponse.json({ error: '유효하지 않은 프로젝트입니다.' }, { status: 400 });
    }
  }

  // ── 기존 레코드: 항상 최신 DB 상태로 확인 (중복 처리 방지) ────────
  // prefetched.existing은 처리 시작 전 조회된 캐시라 stale할 수 있음
  // LLM 호출 전 반드시 DB에서 현재 상태를 확인해 중복 실행 차단
  const { data: existing } = await supabase
    .from('screen_applicants')
    .select('id, llm_status, final_status')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .eq('task_number', taskNumber)
    .maybeSingle();
  const existingId = existing?.id ?? null;

  // ── 이미 처리된 과제는 스킵 ──────────────────────────────────
  if (existing?.llm_status === 'Pass' || existing?.llm_status === 'Fail') {
    perfLog(`[PERF][${taskNumber}] 중복 요청 차단 (이미 ${existing.llm_status})`);
    return NextResponse.json({
      pass: existing.final_status === 'Approved' ? 1 : 0,
      fail: existing.final_status === 'Rejected' ? 1 : 0,
      pending: 0,
      skipped: true,
    });
  }

  const sanitizeBD = (bd?: string): string | null => {
    if (!bd) return null;
    if (/^\d{4}[\.\-]\d{2}[\.\-]\d{2}$/.test(bd)) return bd.replace(/\./g, '-');
    if (/^\d{8}$/.test(bd)) return `${bd.slice(0, 4)}-${bd.slice(4, 6)}-${bd.slice(6, 8)}`;
    return null;
  };

  const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const openaiFileIds: string[] = [];
  let pass = 0, fail = 0, pending = 0;

  try {
    // 1. Supabase Storage 다운로드 → OpenAI Files API 업로드
    const _tu = Date.now();
    const pdfsForAnalysis = await Promise.all(pdfPaths.map(async ({ name, storagePath }) => {
      let urlData: { signedUrl: string } | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
        const { data, error: urlError } = await adminSupabase.storage
          .from('pdf-temp')
          .createSignedUrl(storagePath, 120);
        if (!urlError && data?.signedUrl) { urlData = data; break; }
      }
      if (!urlData?.signedUrl) throw new Error(`Signed URL 생성 실패: ${name}`);

      let buffer: ArrayBuffer | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
        const res = await fetch(urlData.signedUrl);
        if (res.ok) { buffer = await res.arrayBuffer(); break; }
        if (attempt === 2) throw new Error(`PDF 다운로드 실패: ${name} (HTTP ${res.status})`);
      }

      const uploaded = await openaiClient.files.create({
        file: new File([buffer!], name, { type: 'application/pdf' }),
        purpose: 'user_data',
      });
      openaiFileIds.push(uploaded.id);
      return { name, fileId: uploaded.id };
    }));
    perfLog(`[PERF][${taskNumber}] OpenAI 파일 업로드: ${Date.now() - _tu}ms (${pdfPaths.length}개)`);

    // Supabase 파일 즉시 삭제
    if (pdfPaths.length > 0) {
      await adminSupabase.storage.from('pdf-temp').remove(pdfPaths.map(p => p.storagePath));
    }

    // 2. LLM 분석
    const _tl = Date.now();
    const llmResult = await analyzePDFsWithOpenAI(
      pdfsForAnalysis,
      {
        taskNumber,
        historyType: excelData?.historyType,
        locationHeadquarters: excelData?.locationHeadquarters,
        residence: excelData?.residence,
        birthDate: excelData?.birthDate,
      },
      project?.criteria ?? undefined,
      project?.model || 'gpt-4o'
    );
    perfLog(`[PERF][${taskNumber}] LLM 분석: ${Date.now() - _tl}ms → ${llmResult.status}`);

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

    const ext = llmResult.extractedData ?? {};
    const resolvedName           = ext.name             || excelData?.name             || `지원자_${taskNumber}`;
    const resolvedEnterpriseName = ext.enterpriseName   || excelData?.enterpriseName   || null;
    const resolvedHistoryType    = ext.historyType      || excelData?.historyType      || null;
    const resolvedLocation       = ext.locationHeadquarters || excelData?.locationHeadquarters || null;
    const resolvedResidence      = ext.residence        || excelData?.residence        || null;
    const resolvedBirthDate      = sanitizeBD(ext.birthDate || excelData?.birthDate);

    const { calculateAge, checkRegional } = await import('@/lib/excel-utils');
    const refDate = project?.reference_date ? new Date(project.reference_date) : undefined;
    const resolvedAge = resolvedBirthDate ? calculateAge(resolvedBirthDate, refDate) : (excelData?.age ?? null);
    const resolvedIsYouth = resolvedAge != null && resolvedAge > 0 ? resolvedAge <= 39 : (excelData?.isYouth ?? null);
    const resolvedIsRegional = resolvedHistoryType?.includes('예비')
      ? checkRegional(resolvedResidence ?? '')
      : checkRegional(resolvedLocation ?? '');

    const _td = Date.now();
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
        raw_data: null,
      });
      if (error) throw error;
    }
    perfLog(`[PERF][${taskNumber}] DB 저장: ${Date.now() - _td}ms | 총 서버 처리: ${Date.now() - _t0}ms`);

  } catch (err) {
    pending++;
    const errMsg = err instanceof Error ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err));
    perfLog(`[PERF][${taskNumber}] 처리 오류: ${errMsg}`);
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
          raw_data: null,
        });
      }
    } catch { /* DB fallback 실패 무시 */ }
  } finally {
    await Promise.allSettled(
      openaiFileIds.map(id => openaiClient.files.delete(id))
    );
  }

  return NextResponse.json({ pass, fail, pending });
}
