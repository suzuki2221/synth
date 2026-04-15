const { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, EmbedBuilder } = require('discord.js');
const { supabaseAdmin } = require('../supabase');

const CATEGORY_FINISHED = '1493584384010485903';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('task-done')
        .setDescription('タスクを終了したタスクとしてマークします')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(option =>
            option.setName('id')
                .setDescription('タスクID')
                .setRequired(true)),
    async execute(interaction) {
        const shortId = interaction.options.getString('id');

        await interaction.deferReply();

        const db = supabaseAdmin || require('../supabase').supabase;

        const { data: task, error: fetchError } = await db
            .from('tasks')
            .select('*')
            .eq('id', shortId)
            .single();

        if (fetchError || !task) {
            return interaction.editReply('タスクが見つかりませんでした。IDを確認してください。');
        }

        if (task.status === 'finished') {
            return interaction.editReply('このタスクは既に終了しています。');
        }

        try {
            // 1. アナウンスチャンネルを移動し、ロール全員に見えるようにする
            const announcementChannelId = task.announcement_channel_id;
            let announcementChannel;
            try {
                announcementChannel = await interaction.guild.channels.fetch(announcementChannelId);
            } catch (e) {
                console.warn(`アナウンスチャンネル ${announcementChannelId} が見つかりません。`);
            }

            if (announcementChannel) {
                await announcementChannel.setParent(CATEGORY_FINISHED, { lockPermissions: false });
                
                // @everyone の閲覧を禁止
                await announcementChannel.permissionOverwrites.edit(interaction.guild.id, {
                    ViewChannel: false,
                });

                // 既存のオーバーライトを更新して、ロール全員が見れる（発言不可）ようにする
                await announcementChannel.permissionOverwrites.edit(task.role_id, {
                    ViewChannel: true,
                    SendMessages: false,
                });
                
                // 完了済みEmbedにステータス追加（任意）
                try {
                    const messages = await announcementChannel.messages.fetch({ limit: 50 });
                    const taskMsg = messages.find(m => m.embeds.length > 0 && m.embeds[0].title.includes(task.name));
                    if (taskMsg) {
                        const finishedEmbed = EmbedBuilder.from(taskMsg.embeds[0])
                            .setTitle(`[終了] ${task.name}`)
                            .setColor(0x7F8C8D); // 灰色
                        await taskMsg.edit({ embeds: [finishedEmbed], components: [] });
                    }
                } catch (e) {
                    console.error('Embed編集エラー:', e);
                }
            }

            // 2. ボイスチャンネルをすべて削除
            const vcIds = [task.vc_completed_id, task.vc_expired_id, task.vc_finished_id];
            for (const vcId of vcIds) {
                if (vcId) {
                    try {
                        const vc = await interaction.guild.channels.fetch(vcId);
                        if (vc) await vc.delete();
                    } catch (e) {
                        console.warn(`VC ${vcId} の削除に失敗しました:`, e.message);
                    }
                }
            }

            // 3. Supabase更新
            await db
                .from('tasks')
                .update({ status: 'finished' })
                .eq('id', shortId);

            await interaction.editReply(`✅ タスク「${task.name}」を終了しました。`);
        } catch (err) {
            console.error('Task Done Error:', err);
            await interaction.editReply('タスクの終了処理中にエラーが発生しました。');
        }
    },
};
