const { Events, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextInputBuilder, TextInputStyle, ModalBuilder, MessageFlags } = require('discord.js');
const { supabase, supabaseAdmin } = require('../supabase');
require('dotenv').config();

const { getRoleMemberCount } = require('../functions/taskUtils');
const { resumeChat, executeProxmoxCommand, proxmoxNodes } = require('../functions/aiUtils');

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
                
                details = resolveMentions(interaction.guild, details);
                await interaction.deferReply({ ephemeral: true });

                const { data: task, error: fetchError } = await db.from('tasks').select('*').eq('id', shortId).single();
                if (fetchError || !task) return interaction.editReply(`タスク情報が見つかりませんでした。 (ID: ${shortId})`);

                try {
                    // 権限オーバーライトの作成
                    const overwrites = [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }];
                    let totalMembers = 1;
                    let targetMention = '';

                    if (task.role_id) {
                        const role = await interaction.guild.roles.fetch(task.role_id);
                        if (!role) return interaction.editReply('ロールが見つかりませんでした。');
                        overwrites.push({ id: task.role_id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] });
                        totalMembers = await getRoleMemberCount(interaction.guild, task.role_id);
                        targetMention = `<@&${task.role_id}>`;
                    } else if (task.user_id) {
                        overwrites.push({ id: task.user_id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] });
                        totalMembers = 1;
                        targetMention = `<@${task.user_id}>`;
                    }

                    // 1. アナウンスチャンネル作成
                    const announcementChannel = await interaction.guild.channels.create({
                        name: `${task.name}`,
                        type: 5, // GuildAnnouncement
                        parent: CATEGORY_INCOMPLETE,
                        permissionOverwrites: overwrites,
                    });

                    // 2. 他のカテゴリーにテキストチャンネルを作成 (初期状態では管理者以外非表示)
                    const subOverwrites = [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }
                    ];

                    const txtCompleted = await interaction.guild.channels.create({ name: task.name, type: 0, parent: CATEGORY_COMPLETED, permissionOverwrites: subOverwrites });
                    const txtExpired = await interaction.guild.channels.create({ name: task.name, type: 0, parent: CATEGORY_EXPIRED, permissionOverwrites: subOverwrites });
                    const txtFinished = await interaction.guild.channels.create({ name: task.name, type: 0, parent: CATEGORY_FINISHED, permissionOverwrites: subOverwrites });

                    // 3. フォロー設定
                    await announcementChannel.addFollower(txtCompleted.id);
                    await announcementChannel.addFollower(txtExpired.id);
                    await announcementChannel.addFollower(txtFinished.id);

                    const embed = new EmbedBuilder()
                        .setTitle(`📝 タスク: ${task.name}`)
                        .setDescription(details)
                        .addFields(
                            { name: '期限', value: task.deadline, inline: true },
                            { name: 'タスクID', value: `\`${shortId}\``, inline: true },
                            { name: '割り当て先', value: targetMention, inline: true },
                            { name: '進捗', value: `✅ 0 / ${totalMembers} 人完了`, inline: false }
                        )
                        .setColor(0xFAC84B)
                        .setFooter({ text: `アサイナー: ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
                        .setTimestamp();

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`task_done_btn_${shortId}`).setLabel('完了しました').setEmoji('✅').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`task_status_btn_${shortId}`).setLabel('完了状況を確認').setEmoji('📊').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId(`task_edit_btn_${shortId}`).setLabel('編集').setEmoji('🖋️').setStyle(ButtonStyle.Secondary)
                    );

                    const messageOptions = { 
                        content: task.should_mention ? `${targetMention} <@${interaction.user.id}> によって新しいタスクが割り当てられました。` : null,
                        embeds: [embed], 
                        components: [row] 
                    };

                    if (task.is_silent) {
                        messageOptions.flags = [MessageFlags.SuppressNotifications];
                    }

                    const message = await announcementChannel.send(messageOptions);

                    await message.crosspost();

                    await db.from('tasks').update({
                        details: details,
                        total_role_count: totalMembers,
                        announcement_channel_id: announcementChannel.id,
                        vc_completed_id: txtCompleted.id,
                        vc_expired_id: txtExpired.id,
                        vc_finished_id: txtFinished.id,
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
                    let newTotalMembers = task.total_role_count;
                    if (task.role_id) {
                        newTotalMembers = await getRoleMemberCount(interaction.guild, task.role_id);
                    } else if (task.user_id) {
                        newTotalMembers = 1;
                    }

                    await db.from('tasks').update({ deadline: newDeadline, details: newDetails, total_role_count: newTotalMembers }).eq('id', shortId);

                    const channel = await interaction.guild.channels.fetch(task.announcement_channel_id);
                    const messages = await channel.messages.fetch({ limit: 50 });
                    const taskMsg = messages.find(m => m.embeds.length > 0 && m.embeds[0].title.includes(task.name));

                    if (taskMsg) {
                        const completedCount = task.completed_user_ids ? task.completed_user_ids.length : 0;
                        const targetMention = task.role_id ? `<@&${task.role_id}>` : `<@${task.user_id}>`;
                        
                        // 依頼者の情報を取得 (古いタスクへの対応も兼ねて)

                        const newEmbed = EmbedBuilder.from(taskMsg.embeds[0])
                            .setDescription(newDetails)
                            .setFields(
                                { name: '期限', value: newDeadline, inline: true },
                                { name: 'タスクID', value: `\`${shortId}\``, inline: true },
                                { name: '割り当て先', value: targetMention, inline: true },
                                { name: '進捗', value: `✅ ${completedCount} / ${newTotalMembers} 人完了`, inline: false }
                            );
                        

                        await taskMsg.edit({ embeds: [newEmbed] });
                        await taskMsg.crosspost().catch(() => {});
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

                try {
                    const annChannel = await interaction.guild.channels.fetch(task.announcement_channel_id);
                    await annChannel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: false });
                    const txtComp = await interaction.guild.channels.fetch(task.vc_completed_id);
                    await txtComp.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: false });
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
                const { data: task } = await db.from('tasks').select('*').eq('id', shortId).single();
                if (!task) return interaction.reply({ content: 'タスクが見つかりませんでした。', ephemeral: true });

                try {
                    let members = [];
                    if (task.role_id) {
                        const role = await interaction.guild.roles.fetch(task.role_id);
                        await interaction.guild.members.fetch({ role: task.role_id });
                        members = Array.from(role.members.values());
                    } else if (task.user_id) {
                        const member = await interaction.guild.members.fetch(task.user_id);
                        members = [member];
                    }

                    const completedIds = task.completed_user_ids || [];
                    const completedList = members.filter(m => completedIds.includes(m.id)).map(m => m.user.tag).join('\n') || 'なし';
                    const pendingList = members.filter(m => !completedIds.includes(m.id)).map(m => m.user.tag).join('\n') || 'なし';

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

            // --- レポート解決 ---
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

            // --- ボイチャ募集 ---
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
                return interaction.reply({ content: 'ボタンが押されました。', ephemeral: true });
            }

            // --- AI SSH承認 ---
            if (interaction.customId.startsWith('ai_ssh_approve_') || interaction.customId.startsWith('ai_ssh_deny_')) {
                const isApprove = interaction.customId.includes('approve');
                const targetUserId = interaction.customId.split('_').pop();

                if (interaction.user.id !== targetUserId) {
                    return interaction.reply({ content: 'この操作は依頼者本人のみが可能です。', ephemeral: true });
                }

                await interaction.deferUpdate();

                // 元のEmbedから情報を復元
                const embed = interaction.message.embeds[0];
                const nodeName = embed.fields.find(f => f.name === 'ノード').value.replace(/`/g, '');
                const command = embed.description.split('```bash\n')[1]?.split('\n```')[0] || 
                                embed.fields.find(f => f.name === 'コマンド').value.replace(/```bash\n|\n```/g, '');

                if (isApprove) {
                    const nodeConfig = proxmoxNodes.find(n => n.name === nodeName);
                    try {
                        const { stdout, stderr, code } = await executeProxmoxCommand(command, nodeConfig);
                        const aiResult = await resumeChat(targetUserId, "executeProxmoxCommand", {
                            node: nodeName,
                            stdout,
                            stderr,
                            exitCode: code
                        });

                        await interaction.editReply({ 
                            content: `✅ コマンドを実行しました。\n${aiResult.type === 'text' ? aiResult.text : '次の操作が必要です。'}`,
                            embeds: [], components: [] 
                        });
                    } catch (error) {
                        await interaction.editReply({ content: `❌ エラーが発生しました: ${error.message}`, embeds: [], components: [] });
                    }
                } else {
                    const aiResult = await resumeChat(targetUserId, "executeProxmoxCommand", {
                        error: "User denied the execution of this command."
                    });
                    await interaction.editReply({ 
                        content: `🚫 実行を拒否しました。\n${aiResult.type === 'text' ? aiResult.text : '次の操作が必要です。'}`,
                        embeds: [], components: [] 
                    });
                }
                return;
            }
        }
    },
};
