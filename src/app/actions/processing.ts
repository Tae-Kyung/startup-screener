'use server';

import { parseExcel, ApplicantData } from '@/lib/excel-utils';
import { simulateLLMCheck, LLMResult, analyzePDFsWithOpenAI } from '@/lib/llm-engine';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

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

function llmToFinalStatus(
  llmStatus: 'Pass' | 'Fail' | 'Pending'
): 'Approved' | 'Rejected' | 'Pending' {
  if (llmStatus === 'Pass') return 'Approved';
  if (llmStatus === 'Fail') return 'Rejected';
  return 'Pending';
}

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

export async function processExcelAction(formData: FormData, projectId: string) {
  const file = formData.get('file') as File;
  if (!file) throw new Error('No file provided');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data: project } = await supabase
    .from('screen_projects')
    .select('criteria, prompt, model, reference_date')
    .eq('id', projectId)
    .single();

  const referenceDate = project?.reference_date
    ? new Date(project.reference_date)
    : undefined;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const applicants = parseExcel(buffer, referenceDate);

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

  const processedApplicants = newApplicants.map((applicant, i) => {
    const { status: llmStatus, reasoning: llmReasoning } = llmResults[i];
    const finalStatus = llmToFinalStatus(llmStatus);
    return { ...applicant, llmStatus, llmReasoning, finalStatus };
  });

  const sanitizeBirthDate = (bd: string): string | null => {
    if (!bd) return null;
    if (/^\d{4}[\.\-]\d{2}[\.\-]\d{2}$/.test(bd)) return bd.replace(/\./g, '-');
    if (/^\d{8}$/.test(bd))
      return `${bd.substring(0, 4)}-${bd.substring(4, 6)}-${bd.substring(6, 8)}`;
    return null;
  };

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

  const updates = applicants.map((app, i) => {
    const { status: llmStatus, reasoning: llmReasoning } = llmResults[i];
    const finalStatus = llmToFinalStatus(llmStatus);
    return {
      id: app.id,
      rule_status: null,
      llm_status: llmStatus,
      llm_reasoning: llmReasoning,
      final_status: finalStatus,
      updated_at: new Date().toISOString(),
    };
  });

  const { error: updateError } = await supabase
    .from('screen_applicants')
    .upsert(updates);

  if (updateError) throw updateError;
  return { success: true, count: updates.length };
}

export async function syncExcelDataAction(
  excelBase64: string,
  projectId: string
): Promise<{ updated: number; excelDataByTask: Record<string, Omit<ApplicantData, 'raw'>> }> {
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

  const excelDataByTask: Record<string, Omit<ApplicantData, 'raw'>> = {};
  for (const { raw: _raw, ...rest } of applicants) {
    excelDataByTask[rest.taskNumber] = rest;
  }

  const sanitizeBD = (bd?: string): string | null => {
    if (!bd) return null;
    if (/^\d{4}[\.\-]\d{2}[\.\-]\d{2}$/.test(bd)) return bd.replace(/\./g, '-');
    if (/^\d{8}$/.test(bd)) return `${bd.slice(0, 4)}-${bd.slice(4, 6)}-${bd.slice(6, 8)}`;
    return null;
  };

  const results = await Promise.all(applicants.map(app =>
    supabase
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
      .eq('task_number', app.taskNumber)
  ));
  const updated = results.filter(r => !r.error).length;

  return { updated, excelDataByTask };
}

export async function prefetchForProcessingAction(
  taskNumbers: string[],
  projectId: string
): Promise<{
  project: { criteria: string | null; model: string | null; reference_date: string | null } | null;
  existingMap: Record<string, { id: string; llm_status: string; final_status: string }>;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');

  const { data: project } = await supabase
    .from('screen_projects')
    .select('criteria, model, reference_date')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  const { data: existing } = await supabase
    .from('screen_applicants')
    .select('task_number, id, llm_status, final_status')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .in('task_number', taskNumbers);

  const existingMap: Record<string, { id: string; llm_status: string; final_status: string }> = {};
  for (const row of (existing ?? [])) {
    existingMap[row.task_number] = { id: row.id, llm_status: row.llm_status, final_status: row.final_status };
  }

  return { project: project ?? null, existingMap };
}

export async function processDatasetAction(payload: {
  taskNumber: string;
  excelBase64: string | null;
  excelData?: Omit<ApplicantData, 'raw'> | null;
  pdfPaths: Array<{ name: string; storagePath: string }>;
  projectId: string;
  prefetched?: {
    project: { criteria: string | null; model: string | null; reference_date: string | null } | null;
    existing: { id: string; llm_status: string; final_status: string } | null;
  };
}): Promise<{ pass: number; fail: number; pending: number; skipped?: boolean }> {
  const { taskNumber, excelBase64, excelData: excelDataParam, pdfPaths, projectId, prefetched } = payload;
  const _t0 = Date.now();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');

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

  const excelMap = new Map<string, ReturnType<typeof parseExcel>[number]>();
  if (excelDataParam) {
    excelMap.set(taskNumber, excelDataParam as ReturnType<typeof parseExcel>[number]);
  } else if (excelBase64) {
    const buf = Buffer.from(excelBase64, 'base64');
    const refDate = project?.reference_date ? new Date(project.reference_date) : undefined;
    for (const app of parseExcel(buf, refDate)) {
      excelMap.set(app.taskNumber, app);
    }
  }

  let existing = prefetched?.existing !== undefined ? prefetched.existing : undefined;
  if (existing === undefined) {
    const { data } = await supabase
      .from('screen_applicants')
      .select('id, llm_status, final_status')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .eq('task_number', taskNumber)
      .single();
    existing = data ?? null;
  }
  const existingId = existing?.id ?? null;

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
    const _tu = Date.now();
    const pdfsForAnalysis = await Promise.all(pdfPaths.map(async ({ name, storagePath }) => {
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
        throw new Error(`Signed URL 생성 실패: ${name}`);
      }

      const res = await fetch(urlData!.signedUrl);
      if (!res.ok) throw new Error(`PDF 다운로드 실패: ${name} (HTTP ${res.status})`);
      const buffer = await res.arrayBuffer();

      const uploaded = await openaiClient.files.create({
        file: new File([buffer], name, { type: 'application/pdf' }),
        purpose: 'user_data',
      });
      openaiFileIds.push(uploaded.id);
      return { name, fileId: uploaded.id };
    }));
    console.log(`[PERF][${taskNumber}] OpenAI 파일 업로드: ${Date.now() - _tu}ms (${pdfPaths.length}개)`);

    if (pdfPaths.length > 0) {
      await adminSupabase.storage.from('pdf-temp').remove(pdfPaths.map(p => p.storagePath));
    }

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
    console.log(`[PERF][${taskNumber}] LLM 분석: ${Date.now() - _tl}ms → ${llmResult.status}`);

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
    const resolvedName             = ext.name             || excelData?.name             || `지원자_${taskNumber}`;
    const resolvedEnterpriseName   = ext.enterpriseName   || excelData?.enterpriseName   || null;
    const resolvedHistoryType      = ext.historyType      || excelData?.historyType      || null;
    const resolvedLocation         = ext.locationHeadquarters || excelData?.locationHeadquarters || null;
    const resolvedResidence        = ext.residence        || excelData?.residence        || null;
    const resolvedBirthDate        = sanitizeBD(ext.birthDate || excelData?.birthDate);

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
        raw_data: excelData?.raw ?? null,
      });
      if (error) throw error;
    }
    console.log(`[PERF][${taskNumber}] DB 저장: ${Date.now() - _td}ms | 총 서버 처리: ${Date.now() - _t0}ms`);
  } catch (err) {
    pending++;
    const errMsg = err instanceof Error ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err));
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
    await Promise.allSettled(
      openaiFileIds.map(id => openaiClient.files.delete(id))
    );
  }

  return { pass, fail, pending };
}
