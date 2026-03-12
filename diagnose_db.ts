import { createClient } from './src/lib/supabase/server';

async function diagnose() {
  const supabase = await createClient();
  
  console.log("Checking screen_projects table...");
  const { data: cols, error: colError } = await supabase
    .rpc('get_table_columns', { table_name: 'screen_projects' });
    
  if (colError) {
    console.log("RPC get_table_columns failed, trying direct select with limit 0...");
    const { data, error } = await supabase.from('screen_projects').select('*').limit(0);
    if (error) {
      console.error("Direct select failed:", error);
    } else {
      console.log("Available columns in screen_projects:", Object.keys(data[0] || {}));
    }
  } else {
    console.log("Columns in screen_projects:", cols);
  }

  console.log("\nChecking for Project ID in screen_applicants...");
  const { data: applicants, error: appError } = await supabase.from('screen_applicants').select('*').limit(0);
  if (appError) {
      console.error("Applicants select failed:", appError);
  } else {
      console.log("Available columns in screen_applicants:", Object.keys(applicants[0] || {}));
  }
}

diagnose();
