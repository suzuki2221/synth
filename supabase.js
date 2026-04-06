require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[WARNING] Supabase URL or Anon Key is missing in .env');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 管理者用クライアント (RLSをバイパス、DDLの実行などはSQL Editor経由が基本ですが、RPCなどを利用可能にするための設定)
let supabaseAdmin = null;
if (supabaseServiceRoleKey) {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
}

module.exports = { supabase, supabaseAdmin };
