const { Events, EmbedBuilder } = require('discord.js');
const { supabaseAdmin } = require('../supabase');
const { getRoleMemberCount } = require('../functions/taskUtils');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);

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
                let currentTotal = 1;

                if (task.role_id) {
                    currentTotal = await getRoleMemberCount(guild, task.role_id);
                } else if (task.user_id) {
                    currentTotal = 1;
                }

                const completedCount = task.completed_user_ids ? task.completed_user_ids.length : 0;
                await db.from('tasks').update({ total_role_count: currentTotal }).eq('id', task.id);

                const channel = await guild.channels.fetch(task.announcement_channel_id).catch(() => null);
                if (channel) {
                    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => []);
                    const taskMsg = messages.find(m => m.embeds.length > 0 && m.embeds[0].title.includes(task.name));
                    
                    if (taskMsg) {
                        const targetMention = task.role_id ? `<@&${task.role_id}>` : `<@${task.user_id}>`;
                        const embed = EmbedBuilder.from(taskMsg.embeds[0]);
                        const fields = [...embed.data.fields];
                        
                        // 割り当て先フィールドの更新
                        const targetIdx = fields.findIndex(f => f.name === '割り当て先');
                        if (targetIdx !== -1) fields[targetIdx].value = targetMention;

                        // 進捗フィールドの更新
                        const progressIdx = fields.findIndex(f => f.name === '進捗');
                        if (progressIdx !== -1) fields[progressIdx].value = `✅ ${completedCount} / ${currentTotal} 人完了`;
                        
                        embed.setFields(fields);
                        await taskMsg.edit({ embeds: [embed] });
                    }
                }
                
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (e) {
                console.warn(`タスク ${task.id} の同期中にエラーが発生しました:`, e.message);
            }
        }
        console.log('タスクの同期が完了しました。');
    },
};
