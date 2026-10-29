import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ForkLineageService, truncateText } from '../../lib/fork_lineage.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || 0);
const UI_TOKEN = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '';
const SIDECAR_ID = process.env.ANTIGRAVITY_SIDECAR_ID || 'session-fork-tree/fork_tree';

const service = new ForkLineageService();

const STATIC_FILES = {
  '/': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/forest': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/fullscreen': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'styles.css', contentType: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', contentType: 'application/javascript; charset=utf-8' },
};

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function checkToken(req, parsedUrl) {
  if (!UI_TOKEN) return true;
  const headerToken = req.headers['x-sidecar-token'];
  const queryToken = parsedUrl.searchParams.get('token');
  return headerToken === UI_TOKEN || queryToken === UI_TOKEN;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = parsedUrl.pathname;

    // Require valid UI token on non-GET requests
    if (req.method !== 'GET' && req.method !== 'HEAD' && !checkToken(req, parsedUrl)) {
      sendJson(res, 403, { error: 'Forbidden: Invalid sidecar token' });
      return;
    }

    if (req.method === 'GET' && STATIC_FILES[pathname]) {
      const { file, contentType } = STATIC_FILES[pathname];
      const filePath = path.join(__dirname, file);
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      });
      res.end(content);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/tree') {
      const requestedConvId = parsedUrl.searchParams.get('conversationId') || '';
      const includeRecent = parsedUrl.searchParams.get('includeRecent') !== 'false';
      const tree = await service.getForkTree(requestedConvId, {
        includeRecentFamilies: includeRecent,
        recentLimit: 25,
      });
      sendJson(res, 200, {
        sidecarId: SIDECAR_ID,
        timestamp: new Date().toISOString(),
        tree,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/forest') {
      const includeSubagents =
        parsedUrl.searchParams.get('includeSubagents') === 'true';
      const includeZeroFork =
        parsedUrl.searchParams.get('includeZeroFork') === 'true';
      const limit = Number(
        parsedUrl.searchParams.get('limit') || (includeZeroFork ? 200 : 60)
      );
      const forest = await service.getForkForest({
        includeSubagents,
        includeZeroFork,
        limit,
      });
      sendJson(res, 200, {
        sidecarId: SIDECAR_ID,
        timestamp: new Date().toISOString(),
        forest,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/divergence') {
      const convId = parsedUrl.searchParams.get('conversationId') || '';
      const parentId = parsedUrl.searchParams.get('parentId') || null;
      const forkStepParam = parsedUrl.searchParams.get('forkAtStepIndex');
      const forkAtStepIndex =
        forkStepParam !== null && forkStepParam !== '' ? Number(forkStepParam) : null;
      const maxTurns = Number(parsedUrl.searchParams.get('maxTurns') || 15);
      const userForksOnly =
        parsedUrl.searchParams.get('userForksOnly') === 'true';

      const divergence = await service.getForkDivergence(convId, {
        parentConversationId: parentId,
        forkAtStepIndex,
        maxTurnsPerBranch: maxTurns,
        userForksOnly,
      });
      sendJson(res, 200, {
        timestamp: new Date().toISOString(),
        divergence,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/branch-steps') {
      const convId = parsedUrl.searchParams.get('conversationId') || '';
      if (!convId) {
        sendJson(res, 400, { error: 'conversationId query parameter is required' });
        return;
      }
      const minStep = Number(parsedUrl.searchParams.get('minStep') || 0);
      const maxStepParam = parsedUrl.searchParams.get('maxStep');
      const maxStep =
        maxStepParam !== null && maxStepParam !== '' ? Number(maxStepParam) : Infinity;

      const steps = await service.loadConversationSteps(convId, { minStep, maxStep });
      const dialogueSteps = steps
        .filter(
          (s) =>
            s.type === 'USER_INPUT' ||
            s.type === 'PLANNER_RESPONSE' ||
            (s.toolCalls && s.toolCalls.length > 0)
        )
        .map((s) => ({
          stepIndex: s.stepIndex,
          type: s.type,
          status: s.status,
          createdAt: s.createdAt,
          content: truncateText(s.content, 900),
          toolCalls: (s.toolCalls || []).map((tc) => tc.name).filter(Boolean),
        }));

      sendJson(res, 200, {
        conversationId: convId,
        minStep,
        totalDialogueSteps: dialogueSteps.length,
        steps: dialogueSteps,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/load-trajectory') {
      const body = await readRequestBody(req);
      const targetConversationId = String(body.conversationId || '').trim();
      if (!targetConversationId) {
        sendJson(res, 400, { error: 'conversationId is required' });
        return;
      }
      await service.callLsRpc('LoadTrajectory', { cascadeId: targetConversationId });
      sendJson(res, 200, { ok: true, conversationId: targetConversationId });
      return;
    }

    sendJson(res, 404, { error: `Not found: ${pathname}` });
  } catch (err) {
    sendJson(res, 500, {
      error: err?.message || 'Internal server error',
    });
  }
});

// Watch backend files so SidecarManager automatically respawns on code updates
const watchedFiles = [
  __filename,
  path.resolve(__dirname, '../../lib/fork_lineage.mjs'),
];
for (const file of watchedFiles) {
  try {
    fs.watchFile(file, { interval: 1500 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) {
        console.log(`[session-fork-tree] Detected change in ${path.basename(file)}, exiting for reload.`);
        process.exit(0);
      }
    });
  } catch {
    // Ignore watch errors
  }
}

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : PORT;
  console.log(`[session-fork-tree] Sidecar listening on http://127.0.0.1:${boundPort}`);
});
