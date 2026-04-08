const { Events, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { supabase } = require('../supabase');
require('dotenv').config();

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        // スラッシュコマンドの処理
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                const errorMsg = { content: 'コマンド実行中にエラーが発生しました。', ephemeral: true };
                if (interaction.replied || interaction.deferred) await interaction.followUp(errorMsg);
                else await interaction.reply(errorMsg);
            }
            return;
        }

        // ボタン操作の処理
        if (interaction.isButton()) {
            // --- レポート解決ボタン (既存) ---
            if (interaction.customId.startsWith('resolve_report_')) {
                const reportId = interaction.customId.replace('resolve_report_', '');

                // データベースからレポート情報を取得
                const { data: report, error } = await supabase
                    .from('reports')
                    .select('*')
                    .eq('id', reportId)
                    .single();

                if (error || !report) {
                    return interaction.reply({ content: 'レポートが見つかりませんでした。', ephemeral: true });
                }

                if (report.status === 'resolved') {
                    return interaction.reply({ content: 'このレポートは既に解決済みです。', ephemeral: true });
                }

                // データベースを更新
                const { error: updateError } = await supabase
                    .from('reports')
                    .update({ status: 'resolved', approver_id: interaction.user.id })
                    .eq('id', reportId);

                if (updateError) {
                    console.error('Update Error:', updateError);
                    return interaction.reply({ content: 'データベースの更新に失敗しました。', ephemeral: true });
                }

                // 元のEmbedメッセージを更新
                try {
                    const channel = await interaction.client.channels.fetch(report.channel_id);
                    const originalMessage = await channel.messages.fetch(report.message_id);

                    const resolvedEmbed = EmbedBuilder.from(originalMessage.embeds[0])
                        .setColor("#77b255") // 緑色に変更
                        .setDescription('このレポートに関する議論はスレッド内で行ってください。')
                        .setFields({ name: 'ステータス', value: `✅ 解決済み (承認者: ${interaction.user.tag})`, inline: true });

                    await originalMessage.edit({ embeds: [resolvedEmbed] });
                } catch (e) {
                    console.error('元のEmbedの更新に失敗しました:', e);
                }

                await interaction.reply({ content: '✅ レポートを解決済みとしてマークしました。', ephemeral: false });
                
                // スレッドに通知
                if (interaction.channel.isThread()) {
                    await interaction.channel.send(`このレポートは ${interaction.user} によって解決済みとしてマークされました。`);
                }
                return;
            }

            // --- ボイチャ募集ボタン ---
            if (interaction.customId.startsWith('vc_recruit_')) {
                const parts = interaction.customId.split('_');
                const action = parts[2]; // join, later, close

                // データベースから募集情報を取得
                const { data: recruit, error } = await supabase
                    .from('recruitments')
                    .select('*')
                    .eq('message_id', interaction.message.id)
                    .single();

                if (error || !recruit) {
                    return interaction.reply({ content: '募集情報が見つかりませんでした。', ephemeral: true });
                }

                if (recruit.status === 'closed' && action !== 'close') {
                    return interaction.reply({ content: 'この募集は既に締め切られています。', ephemeral: true });
                }

                const voiceChannel = await interaction.guild.channels.fetch(recruit.voice_channel_id);

                if (action === 'join') {
                    await interaction.reply({ 
                        content: `🔊 ボイスチャンネル「${voiceChannel.name}」に参加しましょう！\n${voiceChannel.url}`, 
                        ephemeral: true 
                    });
                } else if (action === 'later') {
                    const laterUsers = recruit.later_users || [];
                    if (laterUsers.includes(interaction.user.id)) {
                        return interaction.reply({ content: '既に参加予定リストに追加されています。', ephemeral: true });
                    }

                    laterUsers.push(interaction.user.id);
                    await supabase
                        .from('recruitments')
                        .update({ later_users: laterUsers })
                        .eq('id', recruit.id);

                    const oldEmbed = interaction.message.embeds[0];
                    const newEmbed = EmbedBuilder.from(oldEmbed);
                    
                    const laterUserMentions = laterUsers.map(id => `<@${id}>`).join(', ');
                    
                    // 「後で参加」フィールドを更新または追加
                    const fields = [...oldEmbed.fields];
                    const laterFieldIndex = fields.findIndex(f => f.name === '後で参加');
                    if (laterFieldIndex !== -1) {
                        fields[laterFieldIndex] = { name: '後で参加', value: laterUserMentions, inline: false };
                    } else {
                        fields.push({ name: '後で参加', value: laterUserMentions, inline: false });
                    }
                    newEmbed.setFields(fields);

                    await interaction.message.edit({ embeds: [newEmbed] });
                    await interaction.reply({ content: '参加予定リストに追加しました！', ephemeral: true });
                } else if (action === 'close') {
                    if (interaction.user.id !== recruit.recruiter_id) {
                        return interaction.reply({ content: '募集を締め切ることができるのは募集者のみです。', ephemeral: true });
                    }

                    if (recruit.status === 'closed') {
                        return interaction.reply({ content: '既に締め切られています。', ephemeral: true });
                    }

                    await supabase
                        .from('recruitments')
                        .update({ status: 'closed' })
                        .eq('id', recruit.id);

                    const oldEmbed = interaction.message.embeds[0];
                    const newEmbed = EmbedBuilder.from(oldEmbed)
                        .setTitle(`[〆切] ${oldEmbed.title}`)
                        .setColor(0x7F8C8D); // 灰色
                    
                    // 「参加中」と「参加メンバー」フィールドを削除
                    const filteredFields = oldEmbed.fields.filter(f => f.name !== '参加中' && f.name !== '参加メンバー');
                    newEmbed.setFields(filteredFields);
                    
                    await interaction.message.edit({ embeds: [newEmbed], components: [] });
                    await interaction.reply({ content: '募集を締め切りました。', ephemeral: true });
                }
            }
        }
    },
};
