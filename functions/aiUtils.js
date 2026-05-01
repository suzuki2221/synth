const { GoogleGenerativeAI } = require("@google/generative-ai");
const { executeProxmoxCommand } = require("./sshUtils");
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ノード設定をパース
let proxmoxNodes = [];
try {
  proxmoxNodes = JSON.parse(process.env.PROXMOX_NODES || '[]');
} catch (e) {
  console.error('Failed to parse PROXMOX_NODES:', e.message);
}

const tools = [
  {
    functionDeclarations: [
      {
        name: "executeProxmoxCommand",
        description: "Execute a command on a specific Proxmox node via SSH.",
        parameters: {
          type: "OBJECT",
          properties: {
            nodeName: {
              type: "string",
              description: `The name of the node to execute the command on. Available nodes: ${proxmoxNodes.map(n => n.name).join(', ')}`,
            },
            command: {
              type: "string",
              description: "The shell command to execute.",
            },
          },
          required: ["nodeName", "command"],
        },
      },
    ],
  },
];

const model = genAI.getGenerativeModel({
  model: "gemini-3-flash-preview",
  tools: tools,
  systemInstruction: `You are a helpful assistant and a Proxmox cluster administrator.
You can execute shell commands on multiple Proxmox nodes via SSH.
Available nodes: ${proxmoxNodes.map(n => `${n.name} (${n.host})`).join(', ')}.
Use the 'executeProxmoxCommand' tool by specifying the node name and the command.
If you're not sure which node to use, you can check 'pvecm status' or 'pvesh get /nodes' on any node.
Respond in Japanese.`,
});

// 会話セッションを一時保存するためのメモリキャッシュ (実運用ではDB推奨)
const sessions = new Map();

async function chatWithAI(userId, userInput, history = []) {
  const chat = model.startChat({
    history: history,
  });

  let result = await chat.sendMessage(userInput);
  let response = result.response;

  // セッションを保存
  sessions.set(userId, chat);

  return handleAIResponse(userId, response);
}

async function handleAIResponse(userId, response) {
  const calls = response.functionCalls();
  
  if (calls && calls.length > 0) {
    // 最初のツール呼び出しに対して承認を求める (簡単のため1つずつ処理)
    const call = calls[0];
    if (call.name === "executeProxmoxCommand") {
      return {
        type: 'approval_required',
        nodeName: call.args.nodeName,
        command: call.args.command,
        callName: call.name
      };
    }
  }

  return {
    type: 'text',
    text: response.text()
  };
}

async function resumeChat(userId, callName, toolResponse) {
  const chat = sessions.get(userId);
  if (!chat) throw new Error("Session not found");

  const result = await chat.sendMessage([
    {
      functionResponse: {
        name: callName,
        response: toolResponse,
      },
    },
  ]);

  return handleAIResponse(userId, result.response);
}

module.exports = { chatWithAI, resumeChat, executeProxmoxCommand, proxmoxNodes };
