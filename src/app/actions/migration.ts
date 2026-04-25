'use server';

import { createClient } from '@/lib/supabase/server';

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
