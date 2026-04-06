const { supabaseAdmin } = require('../supabase');

async function setupDatabase() {
    if (!supabaseAdmin) {
        console.error('❌ SUPABASE_SERVICE_ROLE_KEY が設定されていないため、テーブル作成を実行できません。');
        return;
    }

    console.log('Creating reports table...');

    const { error } = await supabaseAdmin.rpc('exec_sql', {
        query: `
            CREATE TABLE IF NOT EXISTS reports (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                report_name TEXT NOT NULL,
                message_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'unresolved', -- unresolved, answered, resolved
                reporter_id TEXT NOT NULL,
                responder_id TEXT,
                approver_id TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
            );
        `
    });

    if (error) {
        // exec_sql が定義されていない場合（デフォルトではない）は、SQL Editorでの実行を促すメッセージを出すか、
        // 簡易的なテーブル操作を試みる必要があります。
        console.log('⚠️ RPC "exec_sql" が定義されていない可能性があります。Supabase ダッシュボードの SQL Editor で以下の SQL を実行してください:');
        console.log(`
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_name TEXT NOT NULL,
    message_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unresolved',
    reporter_id TEXT NOT NULL,
    responder_id TEXT,
    approver_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
        `);
    } else {
        console.log('✅ reports テーブルが正常に作成されました（または既に存在します）。');
    }
}

setupDatabase();
