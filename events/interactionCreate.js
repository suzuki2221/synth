const { Events, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextInputBuilder, TextInputStyle, ModalBuilder } = require('discord.js');
const { supabase, supabaseAdmin } = require('../supabase');
require('dotenv').config();

// 管理用クライアントを使用 (フォールバックあり)
const db = supabaseAdmin || supabase;

// カテゴリーIDの定義
const CATEGORY_INCOMPLETE = '1493584150802989196';
const CATEGORY_COMPLETED = '1493584193509396530';
const CATEGORY_EXPIRED = '1493584311549562961';
const CATEGORY_FINISHED = '1493584384010485903';

// メンション（#チャンネル, @ユーザー, @ロール）を解決する関数
function resolveMentions(guild, text) {
    if (!text) return text;
    // #チャンネル名 -> <#ID>
    let resolved = text.replace(/#([^\s]+)/g, (match, name) => {
        const channel = guild.channels.cache.find(c => c.name === name);
        return channel ? `<#${channel.id}>` : match;
    });
    // @名前 -> <@ID> または <@&ID>
    resolved = resolved.replace(/@([^\s]+)/g, (match, name) => {
        // ロールを優先的に検索
        const role = guild.roles.cache.find(r => r.name === name);
        if (role) return `<@&${role.id}>`;
        // メンバーを検索
        const member = guild.members.cache.find(m => m.user.username === name || m.nickname === name);
        if (member) return `<@${member.id}>`;
        return match;
    });
    return resolved;
}

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

        // モーダル送信の処理
        if (interaction.isModalSubmit()) {
            // --- タスク追加モーダル ---
            if (interaction.customId.startsWith('task_add_modal_')) {
                const shortId = interaction.customId.replace('task_add_modal_', '');
                let details = interaction.fields.getTextInputValue('task_details');
                
                // タグの解決
                details = resolveMentions(interaction.guild, details);

                await interaction.deferReply({ ephemeral: true });

                const { data: task, error: fetchError } = await db
                    .from('tasks')
                    .select('*')
                    .eq('id', shortId)
                    .single();

                if (fetchError || !task) {
                    console.error('Fetch Task Error:', fetchError);
                    return interaction.editReply(`タスク情報が見つかりませんでした。 (ID: ${shortId})`);
                }

                try {
                    // ロールの存在確認
                    let role = await interaction.guild.roles.fetch(task.role_id);
                    if (!role) {
                        return interaction.editReply(`割り当てられたロールが見つかりませんでした。 (ID: ${task.role_id})`);
                    }

                    // 1. アナウンスチャンネル作成
                    const announcementChannel = await interaction.guild.channels.create({
                        name: `${task.name}`,
                        type: 5, 
                        parent: CATEGORY_INCOMPLETE,
                        permissionOverwrites: [
                            {
                                id: interaction.guild.id,
                                deny: [PermissionsBitField.Flags.ViewChannel],
                            },
                            {
                                id: task.role_id,
                                allow: [PermissionsBitField.Flags.ViewChannel],
                                deny: [PermissionsBitField.Flags.SendMessages],
                            },
                        ],
                    });

                    // 共通のVC権限 (カテゴリー継承)
                    const commonVcOverwrites = [
                        {
                            id: interaction.guild.id,
                            deny: [PermissionsBitField.Flags.ViewChannel],
                        },
                    ];

                    const vcCompleted = await interaction.guild.channels.create({ name: task.name, type: 2, parent: CATEGORY_COMPLETED, permissionOverwrites: commonVcOverwrites });
                    const vcExpired = await interaction.guild.channels.create({ name: task.name, type: 2, parent: CATEGORY_EXPIRED, permissionOverwrites: commonVcOverwrites });
                    const vcFinished = await interaction.guild.channels.create({ name: task.name, type: 2, parent: CATEGORY_FINISHED, permissionOverwrites: commonVcOverwrites });

                    // ロール人数の確定
                    await interaction.guild.members.fetch({ role: role.id });
                    const totalMembers = role.members.size;
                    console.log(`Task Create: Role(${role.name}) members count: ${totalMembers}`);

                    const embed = new EmbedBuilder()
                        .setTitle(`📝 タスク: ${task.name}`)
                        .setDescription(details)
                        .addFields(
                            { name: '期限', value: task.deadline, inline: true },
                            { name: 'タスクID', value: `\`${shortId}\``, inline: true },
                            { name: '割り当てロール', value: `<@&${task.role_id}>`, inline: true },
                            { name: '進捗', value: `✅ 0 / ${totalMembers} 人完了`, inline: false }
                        )
                        .setColor(0xFAC84B)
                        .setTimestamp();

                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder().setCustomId(`task_done_btn_${shortId}`).setLabel('完了しました').setEmoji('✅').setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId(`task_status_btn_${shortId}`).setLabel('完了状況を確認').setEmoji('📊').setStyle(ButtonStyle.Primary),
                            new ButtonBuilder().setCustomId(`task_edit_btn_${shortId}`).setLabel('編集').setEmoji('🖋️').setStyle(ButtonStyle.Secondary)
                        );

                    await announcementChannel.send({ 
                        content: `<@&${task.role_id}> 新しいタスクが割り当てられました。`,
                        embeds: [embed], 
                        components: [row] 
                    });

                    await db.from('tasks').update({
                        details: details,
                        total_role_count: totalMembers,
                        announcement_channel_id: announcementChannel.id,
                        vc_completed_id: vcCompleted.id,
                        vc_expired_id: vcExpired.id,
                        vc_finished_id: vcFinished.id,
                        status: 'pending'
                    }).eq('id', shortId);

                    await interaction.editReply(`✅ タスク「${task.name}」を作成しました。`);
                } catch (err) {
                    console.error('Task Creation Error:', err);
                    await interaction.editReply('タスクの作成中にエラーが発生しました。');
                }
                return;
            }

            // --- タスク編集モーダル ---
            if (interaction.customId.startsWith('task_edit_modal_')) {
                const shortId = interaction.customId.replace('task_edit_modal_', '');
                let newDeadline = interaction.fields.getTextInputValue('task_edit_deadline');
                let newDetails = interaction.fields.getTextInputValue('task_edit_details');
                newDeadline = resolveMentions(interaction.guild, newDeadline);
                newDetails = resolveMentions(interaction.guild, newDetails);

                await interaction.deferReply({ ephemeral: true });

                const { data: task } = await db.from('tasks').select('*').eq('id', shortId).single();
                if (!task) return interaction.editReply('タスクが見つかりませんでした。');

                try {
                    const role = await interaction.guild.roles.fetch(task.role_id);
                    await interaction.guild.members.fetch({ role: task.role_id });
                    const newTotalMembers = role ? role.members.size : task.total_role_count;
                    console.log(`Task Edit: Role members count: ${newTotalMembers}`);

                    await db.from('tasks').update({ deadline: newDeadline, details: newDetails, total_role_count: newTotalMembers }).eq('id', shortId);

                    const channel = await interaction.guild.channels.fetch(task.announcement_channel_id);
                    const messages = await channel.messages.fetch({ limit: 50 });
                    const taskMsg = messages.find(m => m.embeds.length > 0 && m.embeds[0].title.includes(task.name));

                    if (taskMsg) {
                        const completedCount = task.completed_user_ids ? task.completed_user_ids.length : 0;
                        const newEmbed = EmbedBuilder.from(taskMsg.embeds[0])
                            .setDescription(newDetails)
                            .setFields(
                                { name: '期限', value: newDeadline, inline: true },
                                { name: 'タスクID', value: `\`${shortId}\``, inline: true },
                                { name: '割り当てロール', value: `<@&${task.role_id}>`, inline: true },
                                { name: '進捗', value: `✅ ${completedCount} / ${newTotalMembers} 人完了`, inline: false }
                            );
                        await taskMsg.edit({ embeds: [newEmbed] });
                    }
                    await interaction.editReply('✅ タスクを編集しました。');
                } catch (e) {
                    console.error('Task Edit Error:', e);
                    await interaction.editReply('タスクの編集に失敗しました。');
                }
                return;
            }
        }

        // ボタン操作の処理
        if (interaction.isButton()) {
            // --- タスク完了ボタン ---
            if (interaction.customId.startsWith('task_done_btn_')) {
                const shortId = interaction.customId.replace('task_done_btn_', '');
                const { data: task } = await db.from('tasks').select('*').eq('id', shortId).single();
                if (!task) return interaction.reply({ content: 'タスクが見つかりませんでした。', ephemeral: true });

                const completedUsers = task.completed_user_ids || [];
                if (completedUsers.includes(interaction.user.id)) return interaction.reply({ content: '既に完了済みです。', ephemeral: true });

                completedUsers.push(interaction.user.id);
                await db.from('tasks').update({ completed_user_ids: completedUsers }).eq('id', shortId);

                // 進捗Embed更新
                try {
                    const channel = await interaction.guild.channels.fetch(task.announcement_channel_id);
                    const messages = await channel.messages.fetch({ limit: 50 });
                    const taskMsg = messages.find(m => m.embeds.length > 0 && m.embeds[0].title.includes(task.name));
                    if (taskMsg) {
                        const embed = EmbedBuilder.from(taskMsg.embeds[0]);
                        const fields = [...embed.data.fields];
                        const idx = fields.findIndex(f => f.name === '進捗');
                        if (idx !== -1) {
                            fields[idx].value = `✅ ${completedUsers.length} / ${task.total_role_count} 人完了`;
                            embed.setFields(fields);
                            await taskMsg.edit({ embeds: [embed] });
                        }
                    }
                } catch (e) { console.error('Progress Update Error:', e); }

                // 権限剥奪と付与
                try {
                    const annChannel = await interaction.guild.channels.fetch(task.announcement_channel_id);
                    await annChannel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: false });
                    const vcComp = await interaction.guild.channels.fetch(task.vc_completed_id);
                    await vcComp.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, Connect: false });
                    await interaction.reply({ content: '✅ 完了しました！', ephemeral: true });
                } catch (e) {
                    console.error('Permission Update Error:', e);
                    await interaction.reply({ content: '完了しましたが権限の更新に失敗しました。', ephemeral: true });
                }
                return;
            }

            // --- タスク状況確認ボタン ---
            if (interaction.customId.startsWith('task_status_btn_')) {
                const shortId = interaction.customId.replace('task_status_btn_', '');
                console.log(`Status Check: Checking task ID ${shortId}`);
                
                const { data: task, error } = await db.from('tasks').select('*').eq('id', shortId).single();
                if (error || !task) {
                    console.error('Status Check: DB Fetch Error:', error);
                    return interaction.reply({ content: 'タスク情報が取得できませんでした。', ephemeral: true });
                }

                try {
                    const role = await interaction.guild.roles.fetch(task.role_id);
                    if (!role) return interaction.reply({ content: 'ロールが見つかりませんでした。', ephemeral: true });

                    await interaction.guild.members.fetch({ role: task.role_id });
                    const roleMembers = Array.from(role.members.values());
                    const completedIds = task.completed_user_ids || [];
                    console.log(`Status Check: Role(${role.name}) members: ${roleMembers.length}, Completed: ${completedIds.length}`);

                    const completedList = roleMembers.filter(m => completedIds.includes(m.id)).map(m => m.user.tag).join('\n') || 'なし';
                    const pendingList = roleMembers.filter(m => !completedIds.includes(m.id)).map(m => m.user.tag).join('\n') || 'なし';

                    const content = `📊 **${task.name}** の完了状況\n\n` +
                        `\`\`\`diff\n+ 完了済み\n${completedList}\n\`\`\`\n` +
                        `\`\`\`diff\n- 未完了\n${pendingList}\n\`\`\``;

                    await interaction.reply({ content: content, ephemeral: true });
                } catch (e) {
                    console.error('Status Check Error:', e);
                    await interaction.reply({ content: '状況の取得中にエラーが発生しました。', ephemeral: true });
                }
                return;
            }

            // --- タスク編集ボタン ---
            if (interaction.customId.startsWith('task_edit_btn_')) {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return interaction.reply({ content: '権限がありません。', ephemeral: true });
                const shortId = interaction.customId.replace('task_edit_btn_', '');
                const { data: task } = await db.from('tasks').select('*').eq('id', shortId).single();
                if (!task) return interaction.reply({ content: 'タスクが見つかりませんでした。', ephemeral: true });

                const modal = new ModalBuilder().setCustomId(`task_edit_modal_${shortId}`).setTitle('タスクの編集');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('task_edit_deadline').setLabel('期限 (YYYY-MM-DD)').setValue(task.deadline).setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('task_edit_details').setLabel('詳細').setValue(task.details).setStyle(TextInputStyle.Paragraph).setRequired(true))
                );
                await interaction.showModal(modal);
                return;
            }

            // --- レポート解決 (既存) ---
            if (interaction.customId.startsWith('resolve_report_')) {
                const reportId = interaction.customId.replace('resolve_report_', '');
                const { data: report } = await db.from('reports').select('*').eq('id', reportId).single();
                if (!report || report.status === 'resolved') return interaction.reply({ content: '無効なレポートです。', ephemeral: true });

                await db.from('reports').update({ status: 'resolved', approver_id: interaction.user.id }).eq('id', reportId);
                try {
                    const channel = await interaction.client.channels.fetch(report.channel_id);
                    const originalMessage = await channel.messages.fetch(report.message_id);
                    const resolvedEmbed = EmbedBuilder.from(originalMessage.embeds[0]).setColor("#77b255").setFields({ name: 'ステータス', value: `✅ 解決済み (承認者: ${interaction.user.tag})`, inline: true });
                    await originalMessage.edit({ embeds: [resolvedEmbed] });
                } catch (e) { console.error(e); }
                await interaction.reply({ content: '✅ 解決済み。' });
                return;
            }

            // --- ボイチャ募集 (既存) ---
            if (interaction.customId.startsWith('vc_recruit_')) {
                const parts = interaction.customId.split('_');
                const action = parts[2];
                const { data: recruit } = await db.from('recruitments').select('*').eq('message_id', interaction.message.id).single();
                if (!recruit) return interaction.reply({ content: '募集が見つかりません。', ephemeral: true });

                if (action === 'close') {
                    if (interaction.user.id !== recruit.recruiter_id) return interaction.reply({ content: '募集者のみ締め切れます。', ephemeral: true });
                    await db.from('recruitments').update({ status: 'closed' }).eq('id', recruit.id);
                    const newEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setTitle(`[〆切] ${interaction.message.embeds[0].title}`).setColor(0x7F8C8D);
                    await interaction.message.edit({ embeds: [newEmbed], components: [] });
                    return interaction.reply({ content: '締め切りました。', ephemeral: true });
                }
                // (join, later 処理は既存と同様)
                return interaction.reply({ content: 'ボタンが押されました。', ephemeral: true });
            }
        }
    },
};
