'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export async function cleanupStorageAction(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: taskFolders } = await adminSupabase.storage
    .from('pdf-temp')
    .list(user.id, { limit: 200 });

  if (!taskFolders?.length) return;

  await Promise.all(taskFolders.map(async (tf) => {
    const prefix = `${user.id}/${tf.name}`;
    const { data: files } = await adminSupabase.storage
      .from('pdf-temp')
      .list(prefix, { limit: 200 });

    if (files?.length) {
      await adminSupabase.storage
        .from('pdf-temp')
        .remove(files.map(f => `${prefix}/${f.name}`));
    }
  }));
}

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

  const createUrlWithRetry = async (path: string) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { data, error } = await adminSupabase.storage
        .from('pdf-temp')
        .createSignedUploadUrl(path);
      if (!error && data) return { path, signedUrl: data.signedUrl, token: data.token };
      if (attempt < 3 && (error as { status?: number })?.status === 502) {
        await new Promise(r => setTimeout(r, 500 * attempt));
        continue;
      }
      throw new Error(`업로드 URL 생성 실패: ${error?.message}`);
    }
    throw new Error('업로드 URL 생성 실패: 최대 재시도 초과');
  };

  const results: Array<{ path: string; signedUrl: string; token: string }> = [];
  for (let i = 0; i < paths.length; i += 5) {
    const chunk = paths.slice(i, i + 5);
    const chunkResults = await Promise.all(chunk.map(createUrlWithRetry));
    results.push(...chunkResults);
  }

  return results;
}
