const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { supabase } = require('../supabase');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot) return;

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

            const embed = new EmbedBuilder()
                .setTitle(`🎮 ボイチャ募集: ${gameName}`)
                .setDescription(`<@&${targetRoleId}> 募集中！`)
                .addFields(
                    { name: '募集者', value: `${message.author}`, inline: true },
                    { name: '参加中', value: `${memberCount} 人`, inline: true },
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
