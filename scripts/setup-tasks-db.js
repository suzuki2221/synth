const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function setup() {
  console.log('Creating tasks table...');

  // SQL to create the tasks table
  // Since we cannot run raw SQL easily via the client without RPC,
  // we'll assume the user might need to run this in the SQL Editor or we use a trick.
  // However, GEMINI.md says: "RPC (Remote Procedure Call) の利用: 複雑な SQL 実行が必要な場合は、Supabase ダッシュボードで作成されたファンクションを supabase.rpc() で呼び出します。"
  // But usually, we can try to do a dummy insert to see if it exists, but that's not good.
  // I'll provide the SQL and attempt to run it if an 'exec_sql' RPC exists, 
  // otherwise I'll just explain.
  
  const sql = `
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      details TEXT,
      deadline DATE,
      role_id TEXT,
      total_role_count INTEGER DEFAULT 0,
      completed_user_ids TEXT[] DEFAULT '{}',
      announcement_channel_id TEXT,
      vc_completed_id TEXT,
      vc_expired_id TEXT,
      vc_finished_id TEXT,
      status TEXT DEFAULT 'pending',
      guild_id TEXT,
      creator_id TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;

  console.log('Please execute the following SQL in your Supabase SQL Editor:');
  console.log(sql);
  
  // Try to use a common pattern for local setup if possible, but for now, I'll just log it.
  console.log('\nOnce done, you can proceed with the bot implementation.');
}

setup();
