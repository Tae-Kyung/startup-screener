'use server';

import { createClient } from '@/lib/supabase/server';

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
