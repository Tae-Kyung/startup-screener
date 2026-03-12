import { NextRequest } from 'next/server';
import { parseExcel } from '@/lib/excel-utils';
import { analyzePDFsWithOpenAI } from '@/lib/llm-engine';
import { createClient } from '@/lib/supabase/server';

// Vercel Pro / self-hosted 에서 최대 5분 허용
export const maxDuration = 300;

type ProgressEvent =
  | { type: 'start'; total: number }
  | { type: 'progress'; current: number; total: number; taskNumber: string }
  | { type: 'task_error'; taskNumber: string; message: string }
  | { type: 'complete'; summary: { total: number; pass: number; fail: number; pending: number } }
  | { type: 'error'; message: string };

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };

      try {
        // ── 인증 ──────────────────────────────────────────────────
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          send({ type: 'error', message: '로그인이 필요합니다.' });
          controller.close();
          return;
        }

        // ── projectId ──────────────────────────────────────────────
        const projectId = new URL(request.url).searchParams.get('projectId');
        if (!projectId) {
          send({ type: 'error', message: 'projectId가 필요합니다.' });
          controller.close();
          return;
        }

        // ── 프로젝트 설정 로드 ─────────────────────────────────────
        const { data: project } = await supabase
          .from('screen_projects')
          .select('criteria, model, reference_date')
          .eq('id', projectId)
          .eq('user_id', user.id)
          .single();

        // ── FormData 파싱 ──────────────────────────────────────────
        const formData = await request.formData();
        const files = formData.getAll('files') as File[];

        if (files.length === 0) {
          send({ type: 'error', message: '파일이 없습니다.' });
          controller.close();
          return;
        }

        // ── 파일 분류: Excel vs PDF (task_number별 그룹화) ──────────
        let excelFile: File | null = null;
        const pdfsByTask = new Map<string, Array<{ name: string; file: File }>>();

        for (const file of files) {
          // file.name은 클라이언트에서 webkitRelativePath로 설정됨
          // 예: "screening/20318181/신청서.pdf"  또는  "screening/application.xlsx"
          const parts = file.name.replace(/\\/g, '/').split('/');
          const basename = parts[parts.length - 1];

          if (basename.endsWith('.xlsx')) {
            excelFile = file;
          } else if (basename.endsWith('.pdf') && parts.length >= 2) {
            // 과제번호 폴더명 = 마지막에서 두 번째 파트 (접미사 제거)
            const folderName = parts[parts.length - 2];
            const taskNumber = folderName.replace(/_.*$/, '');
            if (!pdfsByTask.has(taskNumber)) pdfsByTask.set(taskNumber, []);
            pdfsByTask.get(taskNumber)!.push({ name: basename, file });
          }
        }

        // ── Excel 파싱 → task_number별 메타데이터 맵 ──────────────
        const excelMap = new Map<string, ReturnType<typeof parseExcel>[number]>();
        if (excelFile) {
          const buf = Buffer.from(await excelFile.arrayBuffer());
          const refDate = project?.reference_date ? new Date(project.reference_date) : undefined;
          for (const app of parseExcel(buf, refDate)) {
            excelMap.set(app.taskNumber, app);
          }
        }

        // ── 기존 DB 레코드 조회 ────────────────────────────────────
        const { data: existing } = await supabase
          .from('screen_applicants')
          .select('task_number, id')
          .eq('project_id', projectId)
          .eq('user_id', user.id);
        const existingMap = new Map((existing || []).map((r: any) => [r.task_number, r.id]));

        const taskNumbers = Array.from(pdfsByTask.keys());
        send({ type: 'start', total: taskNumbers.length });

        let passCount = 0, failCount = 0, pendingCount = 0;

        // ── 배치 처리 (3건씩 병렬, 순서 보장) ────────────────────
        const BATCH = 3;
        for (let i = 0; i < taskNumbers.length; i += BATCH) {
          const batch = taskNumbers.slice(i, i + BATCH);

          await Promise.all(batch.map(async (taskNumber, bi) => {
            const pdfEntries = pdfsByTask.get(taskNumber)!;
            const excelData = excelMap.get(taskNumber) ?? null;

            send({ type: 'progress', current: i + bi + 1, total: taskNumbers.length, taskNumber });

            try {
              // PDF → base64
              const pdfFiles = await Promise.all(
                pdfEntries.map(async ({ name, file }) => ({
                  name,
                  base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
                }))
              );

              // OpenAI PDF 분석
              const llmResult = await analyzePDFsWithOpenAI(
                pdfFiles,
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

              if (finalStatus === 'Approved') passCount++;
              else if (finalStatus === 'Rejected') failCount++;
              else pendingCount++;

              const sanitizeBD = (bd?: string): string | null => {
                if (!bd) return null;
                if (/^\d{4}[\.\-]\d{2}[\.\-]\d{2}$/.test(bd)) return bd.replace(/\./g, '-');
                if (/^\d{8}$/.test(bd)) return `${bd.slice(0, 4)}-${bd.slice(4, 6)}-${bd.slice(6, 8)}`;
                return null;
              };

              const existingId = existingMap.get(taskNumber);
              if (existingId) {
                await supabase
                  .from('screen_applicants')
                  .update({
                    llm_status: llmResult.status,
                    llm_reasoning: llmResult.reasoning,
                    final_status: finalStatus,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', existingId);
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
                  llm_status: llmResult.status,
                  llm_reasoning: llmResult.reasoning,
                  final_status: finalStatus,
                  raw_data: excelData?.raw ?? null,
                });
              }
            } catch (err) {
              console.error(`[${taskNumber}] 처리 오류:`, err);
              send({
                type: 'task_error',
                taskNumber,
                message: err instanceof Error ? err.message : '알 수 없는 오류',
              });
              pendingCount++;
            }
          }));
        }

        send({
          type: 'complete',
          summary: { total: taskNumbers.length, pass: passCount, fail: failCount, pending: pendingCount },
        });
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : '서버 오류' }) + '\n'
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}
