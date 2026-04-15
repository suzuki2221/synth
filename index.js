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
    } else {
        console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
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

// 起動時にコマンドをデプロイ
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

const db = supabaseAdmin || supabase;
const CATEGORY_EXPIRED = '1493584311549562961';

cron.schedule('0 * * * *', async () => {
    console.log('Checking for expired tasks...');
    const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

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
            const channel = await guild.channels.fetch(task.announcement_channel_id);
            
            if (channel) {
                await channel.setParent(CATEGORY_EXPIRED, { lockPermissions: false });
                await channel.send('⏰ このタスクは期限切れになりました。');
                
                // Embedの更新
                const messages = await channel.messages.fetch({ limit: 50 });
                const taskMsg = messages.find(m => m.embeds.length > 0 && m.embeds[0].title.includes(task.name));
                if (taskMsg) {
                    const expiredEmbed = EmbedBuilder.from(taskMsg.embeds[0])
                        .setTitle(`[期限切れ] ${task.name}`)
                        .setColor("ff4d6b"); // 赤色
                    await taskMsg.edit({ embeds: [expiredEmbed] });
                }
            }

            await supabase
                .from('tasks')
                .update({ status: 'expired' })
                .eq('id', task.id);
            
            console.log(`Task ${task.id} marked as expired.`);
        } catch (e) {
            console.error(`Failed to expire task ${task.id}:`, e.message);
        }
    }
});
