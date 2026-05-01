const { Client } = require('ssh2');
require('dotenv').config();

/**
 * 特定のProxmoxノードでコマンドを実行する
 * @param {string} command 実行するコマンド
 * @param {Object} nodeConfig ノードの設定 (host, user, password, sshKey, passphrase)
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
async function executeProxmoxCommand(command, nodeConfig) {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        conn.on('ready', () => {
            let stdout = '';
            let stderr = '';
            conn.exec(command, (err, stream) => {
                if (err) return reject(err);
                stream.on('close', (code, signal) => {
                    conn.end();
                    resolve({ stdout, stderr, code });
                }).on('data', (data) => {
                    stdout += data.toString();
                }).stderr.on('data', (data) => {
                    stderr += data.toString();
                });
            });
        }).on('error', (err) => {
            reject(err);
        }).connect({
            host: nodeConfig.host,
            port: 22,
            username: nodeConfig.user,
            password: nodeConfig.password,
            privateKey: nodeConfig.sshKey ? require('fs').readFileSync(nodeConfig.sshKey) : undefined,
            passphrase: nodeConfig.passphrase
        });
    });
}

module.exports = { executeProxmoxCommand };
