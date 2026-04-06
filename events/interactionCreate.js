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
                        .setColor(0x00FF00) // 緑色に変更
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
            }
        }
    },
};
