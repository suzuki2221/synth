const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { supabase } = require('../supabase');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('レポートを管理します')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('新しいレポートを追加します')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('レポートの名前')
                        .setRequired(true))),
    async execute(interaction) {
        const reportName = interaction.options.getString('name');

        // 1. 初期Embedを送信
        const embed = new EmbedBuilder()
            .setTitle(`レポート: ${reportName}`)
            .addFields(
                { name: 'ステータス', value: '⚠️ 未解決', inline: true }
            )
            .setColor(0xFAC84B)
            .setTimestamp();

        const message = await interaction.reply({ embeds: [embed], fetchReply: true });

        // 2. スレッドを作成
        const thread = await message.startThread({
            name: `report-${reportName}`,
            autoArchiveDuration: 60,
        });

        // 3. スレッドへのボタンを追加してEmbedを編集
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('スレッドを表示')
                    .setURL(thread.url)
                    .setStyle(ButtonStyle.Link)
            );

        await interaction.editReply({ components: [row] });

        // 4. Supabaseに保存
        const reportData = {
            report_name: reportName,
            message_id: message.id,
            channel_id: interaction.channelId,
            guild_id: interaction.guildId,
            thread_id: thread.id,
            status: 'unresolved',
            reporter_id: interaction.user.id
        };

        const { error } = await supabase
            .from('reports')
            .insert(reportData);

        if (error) {
            console.error('Supabase 保存エラー:', error);
            await thread.send('⚠️ データベースへの保存に失敗しました。');
        } else {
            const jsonStr = JSON.stringify(reportData, null, 2);
            await thread.send(`✅ レポート「${reportName}」のスレッドが作成されました。ここで議論を開始してください。\n\n**保存されたデータ:**\n\`\`\`json\n${jsonStr}\n\`\`\``);
        }
    },
};
