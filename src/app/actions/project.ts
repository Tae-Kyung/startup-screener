'use server';

import { createClient } from '@/lib/supabase/server';

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
