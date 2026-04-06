const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { supabase } = require('../supabase');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot) return;

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
