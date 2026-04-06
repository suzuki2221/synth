const supabase = require('./supabase');

async function testConnection() {
    console.log('Connecting to Supabase...');
    
    // 任意のテーブルに対して空のクエリを投げ、接続を確認します。
    // テーブルが存在しなくても、認証エラーやURLエラーの切り分けが可能です。
    const { data, error } = await supabase
        .from('_test_connection') // 存在しない可能性が高い名前
        .select('*')
        .limit(1);

    if (error) {
        // PGRST116 は「結果が見つからない」等の正常な応答に近いエラーですが、
        // 401 Unauthorized や URL 不正などはここで検知できます。
        if (error.code === 'PGRST116' || error.message.includes('relation "_test_connection" does not exist')) {
            console.log('✅ Supabase に正常に到達しました！ (認証は有効です)');
        } else {
            console.error('❌ Supabase への接続に失敗しました:');
            console.error(`Error Code: ${error.code}`);
            console.error(`Message: ${error.message}`);
        }
    } else {
        console.log('✅ Supabase に正常に接続し、データの取得に成功しました！');
    }
}

testConnection();
