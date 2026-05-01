const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { supabase } = require('../supabase');
const { chatWithAI } = require('../functions/aiUtils');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot) return;

        // --- AI 対話ロジック ---
        const aiChannels = process.env.AI_CHANNELS ? process.env.AI_CHANNELS.split(',') : [];
        const isMentioned = message.mentions.has(message.client.user);
        const isInAiChannel = aiChannels.includes(message.channelId);

        if (isMentioned || isInAiChannel) {
            // メンション部分を削除してクリーンな入力を取得
            const content = message.content.replace(`<@!${message.client.user.id}>`, '').replace(`<@${message.client.user.id}>`, '').trim();
            
            if (content || message.attachments.size > 0) {
                await message.channel.sendTyping();
                try {
                    // TODO: 必要に応じて会話履歴をDBから取得する
                    const aiResult = await chatWithAI(message.author.id, content);
                    
                    if (aiResult.type === 'text') {
                        return message.reply(aiResult.text);
                    } else if (aiResult.type === 'approval_required') {
                        const embed = new EmbedBuilder()
                            .setTitle('🛡️ SSHコマンド実行の確認')
                            .setDescription(`AIが以下のコマンドを実行しようとしています。許可しますか？`)
                            .addFields(
                                { name: 'ノード', value: `\`${aiResult.nodeName}\``, inline: true },
                                { name: 'コマンド', value: `\`\`\`bash\n${aiResult.command}\n\`\`\`` }
                            )
                            .setColor(0xFFA500);

                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`ai_ssh_approve_${message.author.id}`)
                                .setLabel('許可')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`ai_ssh_deny_${message.author.id}`)
                                .setLabel('拒否')
                                .setStyle(ButtonStyle.Danger)
                        );

                        // 承認待ちデータを保存（ボタンのカスタムIDに埋め込むのは限界があるため一時的にセッション管理などが必要な場合もあるが、今回はシンプルに）
                        return message.reply({ embeds: [embed], components: [row] });
                    }
                } catch (error) {
                    console.error('AI Error:', error);
                    return message.reply('申し訳ありません、AIとの対話中にエラーが発生しました。');
                }
            }
        }

        // --- ボイチャ募集のトリガー検知 ---
        const recruitRegex = /^<@&(\d+)> (.+)$/;
        const recruitMatch = message.content.match(recruitRegex);

        if (recruitMatch) {
            const targetRoleId = recruitMatch[1];
            const gameName = recruitMatch[2];

            // 送信者がVCに参加しているか確認
            const voiceChannel = message.member.voice.channel;
            if (!voiceChannel) {
                return message.reply('❌ 募集を開始するには、ボイスチャンネルに参加している必要があります。');
            }

            const memberCount = voiceChannel.members.size;
            const memberNames = voiceChannel.members.map(m => m.displayName).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`🎮 ボイチャ募集: ${gameName}`)
                .setDescription(`<@&${targetRoleId}> 募集中！`)
                .addFields(
                    { name: '募集者', value: `${message.author}`, inline: true },
                    { name: '参加中', value: `${memberCount} 人`, inline: true },
                    { name: '参加メンバー', value: "```\n" + memberNames + "\n```" || 'なし', inline: false },
                    { name: 'VC', value: `${voiceChannel.name}`, inline: true }
                )
                .setColor(0x3498DB)
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`vc_recruit_join_${message.id}`)
                        .setLabel('参加する')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`vc_recruit_later_${message.id}`)
                        .setLabel('後で参加')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`vc_recruit_close_${message.id}`)
                        .setLabel('〆切')
                        .setStyle(ButtonStyle.Danger)
                );

            const recruitMsg = await message.channel.send({ 
                content: `<@&${targetRoleId}>`,
                embeds: [embed], 
                components: [row] 
            });

            // Supabaseに保存
            await supabase
                .from('recruitments')
                .insert({
                    guild_id: message.guildId,
                    channel_id: message.channelId,
                    message_id: recruitMsg.id,
                    voice_channel_id: voiceChannel.id,
                    game_name: gameName,
                    target_role_id: targetRoleId,
                    recruiter_id: message.author.id,
                    status: 'open'
                });

            // 元のメッセージを削除（任意ですが、募集メッセージが残るとノイズになるため）
            // await message.delete().catch(console.error);
            return;
        }

        // --- レポート管理のロジック (既存) ---
        // メッセージがスレッド内かどうかを確認
        if (!message.channel.isThread()) return;

        // そのスレッドが reports テーブルに登録されているか確認
        const { data: report, error } = await supabase
            .from('reports')
            .select('*')
            .eq('thread_id', message.channel.id)
            .single();

        if (error || !report) return;

        // 既に解決済みの場合は何もしない
        if (report.status === 'resolved') return;

        // ステータスを「回答済み」に更新（未解決の場合のみ）
        if (report.status === 'unresolved') {
            await supabase
                .from('reports')
                .update({ status: 'answered', responder_id: message.author.id })
                .eq('id', report.id);
        }

        // 解決確認ボタンを送信 (すでに送信されていないか、または一定間隔で送るなどの制御が必要ですが、今回はシンプルに毎回送ります)
        const embed = new EmbedBuilder()
            .setTitle('課題解決の確認')
            .setDescription(`${message.author} さんの回答で解決しましたか？解決した場合は下のボタンを押してください。`)
            .setColor("#77b255");

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`resolve_report_${report.id}`)
                    .setLabel('解決済みとしてマーク')
                    .setStyle(ButtonStyle.Success)
            );

        // 特定のチャンネルに送信する指示がありましたが、文脈上スレッド内または報告者に送るのが一般的です。
        // ここではスレッド内に確認メッセージを送信します。
        await message.channel.send({ embeds: [embed], components: [row] });
    },
};
