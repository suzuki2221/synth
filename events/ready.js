const { Events, EmbedBuilder } = require('discord.js');
const { supabaseAdmin } = require('../supabase');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);

        // --- 起動時に未完了タスクの進捗を再計算して同期 ---
        const db = supabaseAdmin || require('../supabase').supabase;
        const { data: tasks, error } = await db
            .from('tasks')
            .select('*')
            .eq('status', 'pending');

        if (error) {
            console.error('起動時のタスク取得エラー:', error);
            return;
        }

        console.log(`${tasks.length} 件の未完了タスクを同期中...`);

        for (const task of tasks) {
            try {
                const guild = await client.guilds.fetch(task.guild_id);
                const channel = await guild.channels.fetch(task.announcement_channel_id);
                const role = await guild.roles.fetch(task.role_id);
                
                await guild.members.fetch({ role: task.role_id }); // ロール所属メンバーのみを取得
                const currentTotal = role.members.size;
                const completedCount = task.completed_user_ids ? task.completed_user_ids.length : 0;

                // データベースを更新
                await db.from('tasks').update({ total_role_count: currentTotal }).eq('id', task.id);

                // Embedを更新
                const messages = await channel.messages.fetch({ limit: 50 });
                const taskMsg = messages.find(m => m.embeds.length > 0 && m.embeds[0].title.includes(task.name));
                
                if (taskMsg) {
                    const embed = EmbedBuilder.from(taskMsg.embeds[0]);
                    const fields = [...embed.data.fields];
                    const progressFieldIndex = fields.findIndex(f => f.name === '進捗');
                    if (progressFieldIndex !== -1) {
                        fields[progressFieldIndex].value = `✅ ${completedCount} / ${currentTotal} 人完了`;
                        embed.setFields(fields);
                        await taskMsg.edit({ embeds: [embed] });
                    }
                }
            } catch (e) {
                console.warn(`タスク ${task.id} の同期に失敗しました:`, e.message);
            }
        }
        console.log('タスクの同期が完了しました。');
    },
};
