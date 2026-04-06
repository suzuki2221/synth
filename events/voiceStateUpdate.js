const { Events, EmbedBuilder } = require('discord.js');
const { supabase } = require('../supabase');

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        // 同じチャンネル内でのミュート切り替えなどは無視
        if (oldState.channelId === newState.channelId) return;

        // 監視対象のチャンネルIDを特定（移動前または移動後のチャンネル）
        const targetChannelIds = [oldState.channelId, newState.channelId].filter(id => id !== null);

        for (const vcId of targetChannelIds) {
            // Supabase からその VC を監視している募集情報を取得
            const { data: recruitments, error } = await supabase
                .from('recruitments')
                .select('*')
                .eq('voice_channel_id', vcId)
                .eq('status', 'open');

            if (error || !recruitments || recruitments.length === 0) continue;

            for (const recruit of recruitments) {
                try {
                    const channel = await newState.client.channels.fetch(recruit.channel_id);
                    const message = await channel.messages.fetch(recruit.message_id);
                    const voiceChannel = await newState.client.channels.fetch(vcId);

                    const memberCount = voiceChannel.members.size;
                    const memberNames = voiceChannel.members.map(m => m.displayName).join(', ');

                    // Embed を更新
                    const oldEmbed = message.embeds[0];
                    if (!oldEmbed) continue;

                    const newEmbed = EmbedBuilder.from(oldEmbed);
                    
                    // フィールドを更新
                    const fields = [...oldEmbed.fields];
                    const countFieldIndex = fields.findIndex(f => f.name === '参加中');
                    if (countFieldIndex !== -1) {
                        fields[countFieldIndex] = { name: '参加中', value: `${memberCount} 人`, inline: true };
                    }
                    const membersFieldIndex = fields.findIndex(f => f.name === '参加メンバー');
                    if (membersFieldIndex !== -1) {
                        fields[membersFieldIndex] = { name: '参加メンバー', value: memberNames || 'なし', inline: false };
                    }
                    newEmbed.setFields(fields);

                    await message.edit({ embeds: [newEmbed] });
                } catch (e) {
                    console.error('VC人数更新エラー:', e);
                }
            }
        }
    },
};
