import { ForkLineageService, truncateText } from '../lib/fork_lineage.mjs';

const service = new ForkLineageService();

const TOOLS = [
  {
    name: 'fork_tree_get',
    description:
      'Get the chat session fork hierarchy tree (root ancestor, parent lineage chain, sibling forks, and child/descendant branches) for a conversation session, including fork step indices (@ step #N), reference types, shared vs. diverged step counts, workspaces, and recent forked session families.',
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description:
            'Conversation UUID to inspect. Defaults to the active conversation if omitted.',
        },
        include_recent_families: {
          type: 'boolean',
          description:
            'Whether to also return a list of recent forked conversation trees across workspaces (default: true).',
        },
      },
    },
    _meta: {
      'antigravity/alwaysLoad': true,
    },
  },
  {
    name: 'fork_divergence_diff',
    description:
      'Inspect the exact fork point (@ step #N) where chat sessions diverged and compare post-fork trajectories side-by-side across the parent continuation and all forked sibling branches (first diverged user prompts, key tool calls, and latest assistant responses).',
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description:
            'Conversation UUID of the forked branch or parent session to inspect. Defaults to the active conversation if omitted.',
        },
        parent_conversation_id: {
          type: 'string',
          description:
            'Optional explicit parent conversation UUID where the fork occurred.',
        },
        fork_at_step_index: {
          type: 'integer',
          description:
            'Optional explicit 0-based fork step index to compare around.',
        },
        max_turns_per_branch: {
          type: 'integer',
          description:
            'Maximum number of post-fork conversational turns to return per branch (default: 10).',
        },
      },
    },
    _meta: {
      'antigravity/alwaysLoad': true,
    },
  },
  {
    name: 'fork_branch_inspect',
    description:
      'Inspect the turn-by-turn conversation history (user prompts, assistant responses, and tool calls) of a specific parent, sibling, or child branch in a fork tree.',
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description: 'Conversation UUID of the branch to inspect.',
        },
        min_step: {
          type: 'integer',
          description:
            'Minimum 0-based step index (inclusive) to read from (e.g. forkAtStepIndex + 1 for post-fork steps only). Defaults to 0.',
        },
        max_step: {
          type: 'integer',
          description: 'Maximum 0-based step index (inclusive) to read up to.',
        },
        only_dialogue: {
          type: 'boolean',
          description:
            'When true (default), returns USER_INPUT and PLANNER_RESPONSE steps with tool call summaries; when false, returns all step records.',
        },
      },
      required: ['conversation_id'],
    },
    _meta: {
      'antigravity/alwaysLoad': true,
    },
  },
];

async function handleToolCall(rawName, args = {}, meta = {}) {
  const match = /(?:^|_)(fork_(?:tree_get|divergence_diff|branch_inspect))$/.exec(
    rawName || ''
  );
  const name = match ? match[1] : rawName;
  const resolvedConversationId =
    args.conversation_id ||
    meta['antigravity.google/conversation_id'] ||
    process.env.ANTIGRAVITY_CONVERSATION_ID ||
    '';

  if (name === 'fork_tree_get') {
    const includeRecent = args.include_recent_families !== false;
    const tree = await service.getForkTree(resolvedConversationId, {
      includeRecentFamilies: includeRecent,
    });
    return tree;
  }

  if (name === 'fork_divergence_diff') {
    const diff = await service.getForkDivergence(resolvedConversationId, {
      parentConversationId: args.parent_conversation_id || null,
      forkAtStepIndex:
        args.fork_at_step_index !== undefined ? args.fork_at_step_index : null,
      maxTurnsPerBranch: Number(args.max_turns_per_branch || 10),
    });
    return diff;
  }

  if (name === 'fork_branch_inspect') {
    const convId = resolvedConversationId;
    if (!convId) {
      throw new Error('conversation_id is required for fork_branch_inspect');
    }
    const minStep = Number(args.min_step ?? 0);
    const maxStep =
      args.max_step !== undefined && args.max_step !== null
        ? Number(args.max_step)
        : Infinity;
    const onlyDialogue = args.only_dialogue !== false;

    const steps = await service.loadConversationSteps(convId, { minStep, maxStep });
    const filtered = onlyDialogue
      ? steps.filter(
          (s) =>
            s.type === 'USER_INPUT' ||
            s.type === 'PLANNER_RESPONSE' ||
            (s.toolCalls && s.toolCalls.length > 0)
        )
      : steps;

    return {
      conversationId: convId,
      minStep,
      maxStep: Number.isFinite(maxStep) ? maxStep : null,
      returnedSteps: filtered.length,
      steps: filtered.map((s) => ({
        stepIndex: s.stepIndex,
        type: s.type,
        status: s.status,
        createdAt: s.createdAt,
        content: truncateText(s.content, 1200),
        toolCalls: (s.toolCalls || []).map((tc) => tc.name).filter(Boolean),
      })),
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

// Support both newline-delimited JSON-RPC and Content-Length framed JSON-RPC over stdio
let useContentLengthFraming = false;
let inputBuffer = Buffer.alloc(0);

process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') {
    process.exit(0);
  }
});

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  if (useContentLengthFraming) {
    const byteLen = Buffer.byteLength(json, 'utf8');
    process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

async function processRpcMessage(msg) {
  if (!msg || typeof msg !== 'object') return;

  const { id, method, params } = msg;
  if (id === undefined || id === null) {
    // Notification (e.g., notifications/initialized)
    return;
  }

  try {
    if (method === 'initialize') {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'session-fork-tree',
            version: '0.1.0',
          },
        },
      });
      return;
    }

    if (method === 'ping') {
      sendMessage({ jsonrpc: '2.0', id, result: {} });
      return;
    }

    if (method === 'tools/list') {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const toolMeta = params?._meta || {};
      const data = await handleToolCall(toolName, toolArgs, toolMeta);
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        },
      });
      return;
    }

    sendMessage({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    });
  } catch (err) {
    sendMessage({
      jsonrpc: '2.0',
      id,
      result: {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error executing ${method}: ${err?.message || String(err)}`,
          },
        ],
      },
    });
  }
}

function drainInputBuffer() {
  while (inputBuffer.length > 0) {
    const headerStart = inputBuffer.subarray(0, 32).toString('utf8');
    if (headerStart.startsWith('Content-Length:')) {
      useContentLengthFraming = true;
      const sepIdx = inputBuffer.indexOf('\r\n\r\n');
      if (sepIdx === -1) return;
      const headerText = inputBuffer.subarray(0, sepIdx).toString('utf8');
      const match = headerText.match(/Content-Length:\s*(\d+)/i);
      const bodyLen = match ? Number(match[1]) : 0;
      const totalLen = sepIdx + 4 + bodyLen;
      if (inputBuffer.length < totalLen) return;
      const bodyText = inputBuffer.subarray(sepIdx + 4, totalLen).toString('utf8');
      inputBuffer = inputBuffer.subarray(totalLen);
      try {
        processRpcMessage(JSON.parse(bodyText));
      } catch {
        // Ignore malformed message
      }
    } else {
      const nlIdx = inputBuffer.indexOf('\n');
      if (nlIdx === -1) return;
      const line = inputBuffer.subarray(0, nlIdx).toString('utf8').trim();
      inputBuffer = inputBuffer.subarray(nlIdx + 1);
      if (!line) continue;
      try {
        processRpcMessage(JSON.parse(line));
      } catch {
        // Ignore malformed line
      }
    }
  }
}

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  drainInputBuffer();
});
