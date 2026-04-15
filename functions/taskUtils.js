const roleFetchCache = new Map(); // key: roleId, value: timestamp

/**
 * 特定のロールのメンバー数を安全に取得する（1分間のキャッシュ付き）
 */
async function getRoleMemberCount(guild, roleId) {
    const now = Date.now();
    const lastFetch = roleFetchCache.get(roleId) || 0;
    const role = await guild.roles.fetch(roleId);
    if (!role) return 0;

    // 10分以内の再フェッチを防止してOpcode 8の負荷を軽減
    if (now - lastFetch < 600000) {
        console.log(`[Cache] Using cached member count for role: ${role.name}`);
        return role.members.size;
    }

    try {
        console.log(`[Fetch] Fetching members for role: ${role.name}...`);
        await guild.members.fetch({ role: roleId });
        roleFetchCache.set(roleId, now);
        return role.members.size;
    } catch (error) {
        console.error(`[Fetch Error] Failed to fetch members for role ${roleId}:`, error);
        return role.members.size; // 失敗した場合はキャッシュにある分だけ返す
    }
}

module.exports = { getRoleMemberCount };
