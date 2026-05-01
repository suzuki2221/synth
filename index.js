require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, REST, Routes, EmbedBuilder } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ]
});

client.commands = new Collection();
const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        commands.push(command.data.toJSON());
    }
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    } else {
        client.on(event.name, (...args) => event.execute(...args));
    }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);
        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );
        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        console.error('Failed to deploy commands:', error);
    }
})();

client.login(process.env.DISCORD_TOKEN);

// --- 期限切れタスクの自動監視 (1時間ごとに実行) ---
const cron = require('node-cron');
const { supabase, supabaseAdmin } = require('./supabase');
const { getRoleMemberCount } = require('./functions/taskUtils');

const db = supabaseAdmin || supabase;
const CATEGORY_EXPIRED = '1493584311549562961';

cron.schedule('0 * * * *', async () => {
    console.log('Checking for expired tasks...');
    const now = new Date().toISOString().split('T')[0];

    const { data: expiredTasks, error } = await db
        .from('tasks')
        .select('*')
        .eq('status', 'pending')
        .lt('deadline', now);

    if (error) {
        console.error('Error fetching expired tasks:', error);
        return;
    }

    for (const task of expiredTasks) {
        try {
            const guild = await client.guilds.fetch(task.guild_id);
            const channel = await guild.channels.fetch(task.announcement_channel_id).catch(() => null);
            
            if (channel) {
                // 完了状況の集計
                let members = [];
                if (task.role_id) {
                    const role = await guild.roles.fetch(task.role_id);
                    await guild.members.fetch({ role: task.role_id });
                    members = Array.from(role.members.values());
                } else if (task.user_id) {
                    const member = await guild.members.fetch(task.user_id).catch(() => null);
                    if (member) members = [member];
                }

                const completedIds = task.completed_user_ids || [];
                const completedCount = completedIds.length;
                const totalCount = members.length;
                const pendingCount = totalCount - completedCount;

                const completedList = members.filter(m => completedIds.includes(m.id)).map(m => m.user.tag).join('\n') || 'なし';
                const pendingList = members.filter(m => !completedIds.includes(m.id)).map(m => m.user.tag).join('\n') || 'なし';

                let summaryEmbed;
                if (pendingCount === 0 && totalCount > 0) {
                    // 全員完了お祝い
                    summaryEmbed = new EmbedBuilder()
                        .setTitle('🎊 祝・全員完了！')
                        .setDescription(`タスク「${task.name}」は、期限内に全員（${totalCount}名）が完了しました！お疲れ様でした！`)
                        .setColor(0xFFD700)
                        .addFields({ name: '完了メンバー', value: `\`\`\`\n${completedList}\n\`\`\`` });
                } else {
                    // 通常レポート
                    summaryEmbed = new EmbedBuilder()
                        .setTitle('📊 最終完了状況レポート')
                        .setDescription(`タスク「${task.name}」の期限が終了しました。`)
                        .addFields(
                            { name: '完了済', value: `\`\`\`diff\n+ ${completedCount}名\n${completedList}\n\`\`\``, inline: false },
                            { name: '未完了', value: `\`\`\`diff\n- ${pendingCount}名\n${pendingList}\n\`\`\``, inline: false }
                        )
                        .setColor(0x7F8C8D);
                }

                await channel.setParent(CATEGORY_EXPIRED, { lockPermissions: false });
                const reportMsg = await channel.send({ embeds: [summaryEmbed] });
                await reportMsg.crosspost().catch(() => {});
                
                // 元のEmbedの更新
                const messages = await channel.messages.fetch({ limit: 50 });
                const taskMsg = messages.find(m => m.embeds.length > 0 && m.embeds[0].title.includes(task.name));
                if (taskMsg) {
                    const expiredEmbed = EmbedBuilder.from(taskMsg.embeds[0])
                        .setTitle(`[終了] ${task.name}`)
                        .setColor(0x7F8C8D);
                    await taskMsg.edit({ embeds: [expiredEmbed], components: [] });
                }
            }

            await db.from('tasks').update({ status: 'expired' }).eq('id', task.id);
        } catch (e) {
            console.error(`Failed to expire task ${task.id}:`, e.message);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
});
