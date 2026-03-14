import { NextRequest, NextResponse } from 'next/server';
import { parseExcel } from '@/lib/excel-utils';
import { analyzePDFsWithOpenAI } from '@/lib/llm-engine';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    // ── 인증 ──────────────────────────────────────────────────────
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

    const projectId = new URL(request.url).searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ error: 'projectId가 필요합니다.' }, { status: 400 });

    // ── 프로젝트 설정 ──────────────────────────────────────────────
    const { data: project } = await supabase
      .from('screen_projects')
      .select('criteria, model, reference_date')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    // ── JSON 파싱 (FormData 대비 body 크기 제한 없음) ──────────────
    const { taskNumber, excelBase64, excelName, pdfs } = await request.json() as {
      taskNumber: string;
      excelBase64: string | null;
      excelName: string | null;
      pdfs: Array<{ name: string; base64: string }>;
    };

    // ── Excel 파싱 ─────────────────────────────────────────────────
    const excelMap = new Map<string, ReturnType<typeof parseExcel>[number]>();
    if (excelBase64) {
      const buf = Buffer.from(excelBase64, 'base64');
      const refDate = project?.reference_date ? new Date(project.reference_date) : undefined;
      for (const app of parseExcel(buf, refDate)) {
        excelMap.set(app.taskNumber, app);
      }
    }

    // ── 기존 DB 레코드 ─────────────────────────────────────────────
    const taskNumbers = [taskNumber];
    const { data: existing } = await supabase
      .from('screen_applicants')
      .select('task_number, id')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .in('task_number', taskNumbers);
    const existingMap = new Map((existing || []).map((r: any) => [r.task_number, r.id]));

    let pass = 0, fail = 0, pending = 0;

    const sanitizeBD = (bd?: string): string | null => {
      if (!bd) return null;
      if (/^\d{4}[\.\-]\d{2}[\.\-]\d{2}$/.test(bd)) return bd.replace(/\./g, '-');
      if (/^\d{8}$/.test(bd)) return `${bd.slice(0, 4)}-${bd.slice(4, 6)}-${bd.slice(6, 8)}`;
      return null;
    };

    // ── 과제번호별 처리 ────────────────────────────────────────────
    for (const tn of taskNumbers) {
      const excelData = excelMap.get(tn) ?? null;

      try {
        // base64가 이미 클라이언트에서 변환되어 전달됨
        const pdfFiles = pdfs.map(({ name, base64 }) => ({ name, base64 }));

        const llmResult = await analyzePDFsWithOpenAI(
          pdfFiles,
          {
            taskNumber: tn,
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

        const existingId = existingMap.get(tn);
        if (existingId) {
          const { error: updateErr } = await supabase
            .from('screen_applicants')
            .update({
              llm_status: llmResult.status,
              llm_reasoning: llmReasoningToStore,
              final_status: finalStatus,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingId);
          if (updateErr) throw updateErr;
        } else {
          const { error: insertErr } = await supabase.from('screen_applicants').insert({
            project_id: projectId,
            user_id: user.id,
            task_number: tn,
            name: excelData?.name || `지원자_${tn}`,
            birth_date: sanitizeBD(excelData?.birthDate),
            enterprise_name: excelData?.enterpriseName ?? null,
            history_type: excelData?.historyType ?? null,
            location_headquarters: excelData?.locationHeadquarters ?? null,
            residence: excelData?.residence ?? null,
            age: excelData?.age ?? null,
            is_youth: excelData?.isYouth ?? null,
            is_regional: excelData?.isRegional ?? null,
            rule_status: null,
            llm_status: llmResult.status,
            llm_reasoning: llmReasoningToStore,
            final_status: finalStatus,
            raw_data: excelData?.raw ?? null,
          });
          if (insertErr) throw insertErr;
        }
      } catch (err) {
        console.error(`[${tn}] 처리 오류:`, err);
        pending++;
        try {
          const existingId = existingMap.get(tn);
          const errMsg = err instanceof Error ? err.message : String(err);
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
              task_number: tn,
              name: excelData?.name || `지원자_${tn}`,
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
        } catch (dbErr) {
          console.error(`[${tn}] DB 저장 오류:`, dbErr);
        }
      }
    }

    // ── NDJSON 형태로 응답 (클라이언트 파서 호환) ──────────────────
    const body =
      JSON.stringify({ type: 'complete', summary: { total: taskNumbers.length, pass, fail, pending } }) + '\n';

    return new Response(body, {
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  } catch (err) {
    console.error('process-dataset error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 });
  }
}
