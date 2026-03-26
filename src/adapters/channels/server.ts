import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

import { isPairedUser } from '../../core/pairing.js';
import { createWechatBridge, type WechatBridge } from '../../core/wechat-bridge.js';
import {
  buildInstructions,
  PermissionRequestParams,
  WechatChannelBridge
} from './bridge.js';

const PermissionRequestNotificationSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    input_preview: z.string(),
    description: z.string()
  })
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getToolDefinitions() {
  return [
    {
      name: 'wechat_reply',
      description: 'Reply to a WeChat chat that previously sent a message into Claude Code.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chat_id: { type: 'string', description: 'The WeChat chat ID from channel metadata.' },
          text: { type: 'string', description: 'Reply text to send back to WeChat.' },
          context_token: {
            type: 'string',
            description: 'Optional context token from channel metadata. Prefer passing it when available.'
          }
        },
        required: ['chat_id', 'text']
      }
    }
  ];
}

async function runPollingLoop(
  bridge: WechatChannelBridge,
  wechatBridge: WechatBridge
): Promise<void> {
  while (true) {
    try {
      const messages = await wechatBridge.pollMessages();
      if (messages.length === 0) {
        await sleep(1200);
        continue;
      }

      for (const message of messages) {
        await bridge.handleWechatMessage(message);
      }
    } catch (error) {
      console.error(`[channels] 轮询失败: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(3000);
    }
  }
}

function createChannelServer() {
  const wechatBridge = createWechatBridge('channels');
  const server = new Server({
    name: 'wechat-claude-assistant',
    version: '0.2.0'
  }, {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {}
      }
    },
    instructions: buildInstructions()
  });

  const bridge = new WechatChannelBridge({
    isPairedUser,
    sendReply: wechatBridge.sendReply.bind(wechatBridge),
    emitNotification: async (notification) => {
      await server.notification(notification);
    }
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolDefinitions()
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;

    if (name !== 'wechat_reply') {
      throw new Error(`Unknown tool: ${name}`);
    }

    const args = (request.params.arguments || {}) as {
      chat_id?: string;
      text?: string;
      context_token?: string;
    };

    return await bridge.handleReplyTool(args) as any;
  });

  server.setNotificationHandler(
    PermissionRequestNotificationSchema,
    async (notification) => {
      await bridge.handlePermissionRequest(
        notification.params as PermissionRequestParams
      );
    }
  );

  return { server, bridge, wechatBridge };
}

export async function startChannelServer() {
  const { server, bridge, wechatBridge } = createChannelServer();
  await wechatBridge.init();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('微信 Claude Code 助手已启动（channels adapter 模式）');
  void runPollingLoop(bridge, wechatBridge);
}

function isDirectExecution(): boolean {
  return Boolean(process.argv[1])
    && pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isDirectExecution()) {
  startChannelServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
