'use server';

import { createClient } from '@/lib/supabase/server';
import ExcelJS from 'exceljs';

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

  const parseReasoning = (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.checkpoints) return parsed as { reasoning: string; checkpoints: Array<{ criterion: string; document: string; finding: string; result: string }> };
    } catch { /* plain text */ }
    return null;
  };

  const llmKo  = (v: string) => v === 'Pass' ? '적합' : v === 'Fail' ? '부적합' : '검토필요';
  const finalKo = (v: string) => v === 'Approved' ? '승인' : v === 'Rejected' ? '반려' : '검토중';

  const C = {
    headerBg:   '1F3864',
    headerFont: 'FFFFFF',
    approved:   'D9F2E6',
    rejected:   'FDDEDE',
    pending:    'FFF9DB',
    passFont:   '1E7E34',
    failFont:   'C0392B',
    pendFont:   'B7791F',
    border:     'BDC3C7',
    subHeader:  'D6E4F0',
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

  const wb = new ExcelJS.Workbook();
  wb.creator = 'AI 서류 심사 시스템';
  wb.created = new Date();

  // Sheet 1: 지원자 요약
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
      no: idx + 1, task_number: a.task_number, name: a.name || '-',
      enterprise: a.enterprise_name || '-', history_type: a.history_type || '-',
      hq: a.location_headquarters || '-', residence: a.residence || '-',
      birth_date: a.birth_date || '-', age: a.age != null ? a.age : '-',
      is_youth: a.is_youth === true ? '청년' : a.is_youth === false ? '비청년' : '-',
      is_regional: a.is_regional === true ? '권역내' : a.is_regional === false ? '권역외' : '-',
      llm_status: llmLabel, final_status: finalLabel,
      fail_items: failItems, reasoning: parsed?.reasoning || a.llm_reasoning || '-',
      comment: a.confirm_comment || '-',
    });

    const bg = rowBg(a.final_status || '');
    row.height = 20;
    row.eachCell(cell => applyDataCell(cell, bg));

    const llmCell   = row.getCell('llm_status');
    const finalCell = row.getCell('final_status');
    llmCell.font   = { bold: true, color: { argb: statusFont(llmLabel) } };
    finalCell.font = { bold: true, color: { argb: statusFont(finalLabel) } };
    row.getCell('no').alignment          = { horizontal: 'center', vertical: 'middle' };
    row.getCell('task_number').alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell('age').alignment         = { horizontal: 'center', vertical: 'middle' };
    row.getCell('is_youth').alignment    = { horizontal: 'center', vertical: 'middle' };
    row.getCell('is_regional').alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell('llm_status').alignment  = { horizontal: 'center', vertical: 'middle' };
    row.getCell('final_status').alignment= { horizontal: 'center', vertical: 'middle' };
  });

  // Sheet 2: 체크포인트 상세
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
        task_number: a.task_number, name: a.name || '-', enterprise: a.enterprise_name || '-',
        final_status: finalLabel, criterion: cp.criterion, document: cp.document,
        finding: cp.finding, result: cp.result,
      });

      row.height = 20;
      row.eachCell(cell => applyDataCell(cell, bg));

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

  const buffer = await wb.xlsx.writeBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const filename = `${project?.title || 'screening'}_심사결과_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return { success: true, data: base64 as string, filename };
}
