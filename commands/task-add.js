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
                .setDescription('割り当てるロール (ユーザー指定がない場合は必須)')
                .setRequired(false))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('割り当てるユーザー (ロール指定がない場合は必須)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('mention')
                .setDescription('割り当て時にメンションを送るか')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('silent')
                .setDescription('サイレントメッセージとして送信するか (通知なし)')
                .setRequired(false)),
    async execute(interaction) {
        const name = interaction.options.getString('name');
        const deadline = interaction.options.getString('deadline');
        const role = interaction.options.getRole('role');
        const user = interaction.options.getUser('user');
        const shouldMention = interaction.options.getBoolean('mention') ?? true;
        const isSilent = interaction.options.getBoolean('silent') ?? false;

        if (!role && !user) {
            return interaction.reply({ content: 'ロールまたはユーザーのいずれかを指定してください。', ephemeral: true });
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
            return interaction.reply({ content: '期限は YYYY-MM-DD 形式で入力してください。', ephemeral: true });
        }

        const shortId = crypto.randomBytes(3).toString('hex');
        const db = supabaseAdmin || require('../supabase').supabase;

        const { error } = await db
            .from('tasks')
            .insert({
                id: shortId,
                name: name,
                deadline: deadline,
                role_id: role ? role.id : null,
                user_id: user ? user.id : null,
                should_mention: shouldMention,
                is_silent: isSilent,
                total_role_count: 0,
                guild_id: interaction.guildId,
                creator_id: interaction.user.id,
                status: 'creating'
            });

        if (error) {
            console.error('Supabase Insert Error:', error);
            return interaction.reply({ content: `タスクの作成に失敗しました(DBエラー: ${error.message})`, ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId(`task_add_modal_${shortId}`)
            .setTitle(`${name} の詳細入力`);

        const detailsInput = new TextInputBuilder()
            .setCustomId('task_details')
            .setLabel('タスクの詳細を入力してください')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(detailsInput));
        await interaction.showModal(modal);
    },
};
