const { supabaseAdmin } = require('../supabase');

async function setupDatabase() {
    if (!supabaseAdmin) {
        console.error('❌ SUPABASE_SERVICE_ROLE_KEY が設定されていないため、テーブル作成を実行できません。');
        return;
    }

    console.log('Updating database tables...');

    const { error } = await supabaseAdmin.rpc('exec_sql', {
        query: `
            -- reports テーブル
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

            -- recruitments テーブル
            CREATE TABLE IF NOT EXISTS recruitments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                voice_channel_id TEXT NOT NULL,
                game_name TEXT NOT NULL,
                target_role_id TEXT NOT NULL,
                recruiter_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open', -- open, closed
                later_users TEXT[] DEFAULT '{}',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
            );
        `
    });

    if (error) {
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

CREATE TABLE IF NOT EXISTS recruitments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    voice_channel_id TEXT NOT NULL,
    game_name TEXT NOT NULL,
    target_role_id TEXT NOT NULL,
    recruiter_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    later_users TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
        `);
    } else {
        console.log('✅ データベーステーブルが正常に作成/更新されました。');
    }
}

setupDatabase();

