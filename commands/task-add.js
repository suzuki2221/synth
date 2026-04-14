const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');
const { supabaseAdmin } = require('../supabase');
const crypto = require('crypto');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('task-add')
        .setDescription('新しいタスクを追加します')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addStringOption(option =>
            option.setName('name')
                .setDescription('タスク名')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('deadline')
                .setDescription('期限 (例: 2026-04-30)')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('割り当てるロール')
                .setRequired(true)),
    async execute(interaction) {
        const name = interaction.options.getString('name');
        const deadline = interaction.options.getString('deadline');
        const role = interaction.options.getRole('role');

        // 日付形式の簡易バリデーション
        if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
            return interaction.reply({ content: '期限は YYYY-MM-DD 形式で入力してください。', ephemeral: true });
        }

        // ロール人数の取得 (対象ロールのメンバーのみをフェッチして最適化)
        await interaction.guild.members.fetch({ role: role.id });
        const totalMembers = role.members.size;

        // 短い固有IDの生成 (6文字)
        const shortId = crypto.randomBytes(3).toString('hex');

        // 管理用クライアントを使用
        const db = supabaseAdmin || require('../supabase').supabase;

        // 一時的にSupabaseに保存
        const { error } = await db
            .from('tasks')
            .insert({
                id: shortId,
                name: name,
                deadline: deadline,
                role_id: role.id,
                total_role_count: totalMembers,
                guild_id: interaction.guildId,
                creator_id: interaction.user.id,
                status: 'creating'
            });

        if (error) {
            console.error('Supabase Insert Error:', error);
            return interaction.reply({ content: `タスクの作成に失敗しました(DBエラー: ${error.message})`, ephemeral: true });
        }

        // Modalの作成
        const modal = new ModalBuilder()
            .setCustomId(`task_add_modal_${shortId}`)
            .setTitle(`${name} の詳細入力`);

        const detailsInput = new TextInputBuilder()
            .setCustomId('task_details')
            .setLabel('タスクの詳細を入力してください')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(detailsInput);
        modal.addComponents(firstActionRow);

        try {
            await interaction.showModal(modal);
        } catch (e) {
            console.error('Show Modal Error:', e);
            await interaction.reply({ content: 'モーダルの表示に失敗しました。', ephemeral: true });
        }
    },
};
