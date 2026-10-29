import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ForkLineageService,
  buildForkTreeFromRecords,
  cleanUserPromptText,
  decodeCortexTrajectoryReference,
  decodeStepPayload,
} from '../lib/fork_lineage.mjs';

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function encodeVarint(num) {
  let n = BigInt(num);
  const bytes = [];
  while (n >= 0x80n) {
    bytes.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Buffer.from(bytes);
}

function encodeStringField(fieldNo, str) {
  const strBuf = Buffer.from(str, 'utf8');
  const tag = encodeVarint((fieldNo << 3) | 2);
  const len = encodeVarint(strBuf.length);
  return Buffer.concat([tag, len, strBuf]);
}

function encodeVarintField(fieldNo, val) {
  const tag = encodeVarint((fieldNo << 3) | 0);
  const v = encodeVarint(val);
  return Buffer.concat([tag, v]);
}

function encodeCortexTrajectoryReference({
  trajectoryId = 'traj-root',
  stepIndex = 12,
  trajectoryType = 17,
  stepType = 15,
  referenceType = 2,
  conversationId = 'conv-root',
}) {
  return Buffer.concat([
    encodeStringField(1, trajectoryId),
    encodeVarintField(2, stepIndex),
    encodeVarintField(3, trajectoryType),
    encodeVarintField(4, stepType),
    encodeVarintField(5, referenceType),
    encodeStringField(6, conversationId),
  ]);
}

test('decodeCortexTrajectoryReference decodes protobuf binary accurately', () => {
  const blob = encodeCortexTrajectoryReference({
    trajectoryId: 'traj-parent-123',
    stepIndex: 27,
    trajectoryType: 17,
    stepType: 15,
    referenceType: 2,
    conversationId: 'conv-parent-456',
  });

  const decoded = decodeCortexTrajectoryReference(blob);
  assert.equal(decoded.trajectoryId, 'traj-parent-123');
  assert.equal(decoded.stepIndex, 27);
  assert.equal(decoded.referenceType, 2);
  assert.equal(decoded.referenceLabel, 'FORK');
  assert.equal(decoded.conversationId, 'conv-parent-456');
});

test('cleanUserPromptText strips <USER_REQUEST>, <ADDITIONAL_METADATA>, and side-question wrappers', () => {
  const raw = `<USER_REQUEST>\nFix the race condition in worker pool\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe user is: developer.\n</ADDITIONAL_METADATA>`;
  assert.equal(cleanUserPromptText(raw), 'Fix the race condition in worker pool');

  const sideQ =
    'This is a side question from the user. You MUST answer directly in a single response. Here is the question: How does TP8DCP2 work with 2 KV heads?';
  assert.equal(cleanUserPromptText(sideQ), 'How does TP8DCP2 work with 2 KV heads?');
});

test('decodeStepPayload extracts USER_INPUT and PLANNER_RESPONSE content', () => {
  const userInputSubmsg = encodeStringField(
    2,
    '<USER_REQUEST>\nTry approach B with SQLite WAL\n</USER_REQUEST>'
  );
  const stepBuf = Buffer.concat([
    encodeVarintField(1, 14), // USER_INPUT
    encodeVarintField(4, 3), // DONE
    encodeStringField(19, userInputSubmsg.toString('utf8')),
  ]);

  const decoded = decodeStepPayload(stepBuf, null, 8, 14, 3);
  assert.equal(decoded.stepIndex, 8);
  assert.equal(decoded.type, 'USER_INPUT');
  assert.equal(decoded.status, 'DONE');
  assert.equal(decoded.content, 'Try approach B with SQLite WAL');
});

test('buildForkTreeFromRecords constructs multi-hop and sibling hierarchy with missing intermediate placeholder', () => {
  const records = [
    {
      conversationId: 'root-conv',
      title: 'Root Architecture Design',
      stepCount: 40,
      lastModifiedTime: '2026-10-24T01:00:00Z',
      parentReferences: [],
    },
    {
      conversationId: 'fork-sibling-a',
      title: 'Fork A: Redis Cache',
      stepCount: 25,
      lastModifiedTime: '2026-10-24T01:10:00Z',
      parentReferences: [
        {
          conversationId: 'root-conv',
          trajectoryId: 'traj-root',
          stepIndex: 14,
          referenceType: 2,
        },
      ],
    },
    {
      conversationId: 'grandchild-conv',
      title: 'Grandchild from Deleted Fork B',
      stepCount: 35,
      lastModifiedTime: '2026-10-24T01:20:00Z',
      parentReferences: [
        {
          conversationId: 'root-conv',
          trajectoryId: 'traj-root',
          stepIndex: 14,
          referenceType: 2,
        },
        {
          conversationId: 'deleted-fork-b',
          trajectoryId: 'traj-b',
          stepIndex: 22,
          referenceType: 2,
        },
      ],
    },
  ];

  const tree = buildForkTreeFromRecords(records, 'grandchild-conv');
  assert.ok(tree);
  assert.equal(tree.rootConversationId, 'root-conv');
  assert.equal(tree.totalNodes, 4); // root + fork-sibling-a + deleted-fork-b placeholder + grandchild-conv
  assert.equal(tree.maxDepth, 2);
  assert.deepEqual(tree.activeLineageChain, [
    'root-conv',
    'deleted-fork-b',
    'grandchild-conv',
  ]);

  const grandchildNode = tree.nodes.find((n) => n.conversationId === 'grandchild-conv');
  assert.ok(grandchildNode);
  assert.equal(grandchildNode.isCurrent, true);
  assert.equal(grandchildNode.sharedSteps, 23); // forkAtStepIndex 22 + 1
  assert.equal(grandchildNode.divergedSteps, 12); // 35 - 23
});

test('ForkLineageService reads SQLite stores and computes fork divergence diff end-to-end', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-tree-test-'));
  try {
    const appDataDir = path.join(tmpDir, 'appdata');
    const configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(path.join(appDataDir, 'conversations'), { recursive: true });
    fs.mkdirSync(path.join(configDir, 'projects'), { recursive: true });

    // Create conversation_summaries.db
    const sumDb = new DatabaseSync(path.join(appDataDir, 'conversation_summaries.db'));
    sumDb.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        title TEXT,
        preview TEXT,
        step_count INTEGER,
        last_modified_time TEXT,
        workspace_uris TEXT,
        status INTEGER,
        project_id TEXT,
        parent_conversation_id TEXT,
        nesting_depth INTEGER,
        not_fully_idle INTEGER,
        last_user_input_time TEXT
      );
    `);
    const ins = sumDb.prepare(`
      INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    ins.run(
      'conv-parent',
      'Parent Investigation',
      '',
      5,
      '2026-10-24T01:00:00Z',
      '["file:///workspace/app"]',
      1,
      '',
      '',
      0,
      0,
      '2026-10-24T01:00:00Z'
    );
    ins.run(
      'conv-child',
      'Child Fork Experiment',
      '',
      5,
      '2026-10-24T01:05:00Z',
      '["file:///workspace/app"]',
      1,
      '',
      '',
      0,
      0,
      '2026-10-24T01:05:00Z'
    );
    ins.run(
      'conv-sideq-only-root',
      'Root With Side Question Only',
      '',
      3,
      '2026-10-24T01:10:00Z',
      '["file:///workspace/app"]',
      1,
      '',
      '',
      0,
      0,
      '2026-10-24T01:10:00Z'
    );
    ins.run(
      'conv-sideq-child',
      'Side Question Child',
      '',
      3,
      '2026-10-24T01:11:00Z',
      '["file:///workspace/app"]',
      1,
      '',
      '',
      0,
      0,
      '2026-10-24T01:11:00Z'
    );
    sumDb.close();

    // Helper to create a conversation .db
    function createConvDb(convId, parentRefs, steps) {
      const db = new DatabaseSync(path.join(appDataDir, 'conversations', `${convId}.db`));
      db.exec(`
        CREATE TABLE parent_references (idx INTEGER PRIMARY KEY, data BLOB);
        CREATE TABLE steps (
          idx INTEGER PRIMARY KEY,
          step_type INTEGER,
          status INTEGER,
          metadata BLOB,
          step_payload BLOB
        );
      `);
      const insRef = db.prepare('INSERT INTO parent_references VALUES (?, ?)');
      parentRefs.forEach((r, i) => insRef.run(i, encodeCortexTrajectoryReference(r)));

      const insStep = db.prepare('INSERT INTO steps VALUES (?, ?, ?, ?, ?)');
      steps.forEach((s) => {
        let payload;
        if (s.stepType === 14) {
          const ui = encodeStringField(2, s.text);
          payload = Buffer.concat([
            encodeVarintField(1, 14),
            encodeVarintField(4, 3),
            encodeStringField(19, ui.toString('utf8')),
          ]);
        } else {
          const pr = encodeStringField(1, s.text);
          payload = Buffer.concat([
            encodeVarintField(1, 15),
            encodeVarintField(4, 3),
            encodeStringField(20, pr.toString('utf8')),
          ]);
        }
        insStep.run(s.idx, s.stepType, 3, null, payload);
      });
      db.close();
    }

    createConvDb('conv-parent', [], [
      { idx: 0, stepType: 14, text: 'Initial shared user prompt' },
      { idx: 1, stepType: 15, text: 'Shared assistant response at step 1' },
      { idx: 2, stepType: 14, text: 'Parent continuation prompt: keep original design' },
      { idx: 3, stepType: 15, text: 'Original design completed.' },
    ]);

    createConvDb(
      'conv-child',
      [
        {
          trajectoryId: 'traj-parent',
          stepIndex: 1,
          referenceType: 2,
          conversationId: 'conv-parent',
        },
      ],
      [
        { idx: 0, stepType: 14, text: 'Initial shared user prompt' },
        { idx: 1, stepType: 15, text: 'Shared assistant response at step 1' },
        { idx: 2, stepType: 14, text: 'Child fork prompt: switch to streaming parser' },
        { idx: 3, stepType: 15, text: 'Streaming parser benchmarked 3x faster.' },
      ]
    );

    const svc = new ForkLineageService({ appDataDir, configDir });
    const diff = await svc.getForkDivergence('conv-child');
    assert.equal(diff.hasForkPoint, true);
    assert.equal(diff.forkPoint.forkAtStepIndex, 1);
    assert.equal(
      diff.forkPoint.lastSharedUserPrompt.text,
      'Initial shared user prompt'
    );
    assert.equal(
      diff.forkPoint.lastSharedAssistantResponse.text,
      'Shared assistant response at step 1'
    );
    assert.equal(diff.branches.length, 2);
    assert.equal(
      diff.branches[0].firstDivergedUserPrompt.text,
      'Parent continuation prompt: keep original design'
    );
    assert.equal(
      diff.branches[1].firstDivergedUserPrompt.text,
      'Child fork prompt: switch to streaming parser'
    );

    // Add a standalone conversation with only a SIDE_QUESTION child to verify getForkForest excludes it
    createConvDb('conv-sideq-only-root', [], [
      { idx: 0, stepType: 14, text: 'Root prompt' },
      { idx: 1, stepType: 15, text: 'Root answer' },
    ]);
    createConvDb(
      'conv-sideq-child',
      [
        {
          trajectoryId: 'traj-sq-root',
          stepIndex: 1,
          referenceType: 2,
          conversationId: 'conv-sideq-only-root',
        },
      ],
      [
        { idx: 0, stepType: 14, text: 'Root prompt' },
        { idx: 1, stepType: 15, text: 'Root answer' },
        {
          idx: 2,
          stepType: 14,
          text: 'This is a side question from the user. Here is the question: Quick side question?',
        },
      ]
    );

    const forest = await svc.getForkForest({ includeSubagents: false });
    assert.equal(forest.totalTrees, 1);
    assert.equal(forest.forkedTreeCount, 1);
    assert.equal(forest.zeroForkTreeCount, 0);
    assert.equal(forest.trees[0].rootConversationId, 'conv-parent');
    assert.equal(forest.trees[0].totalNodes, 2);

    const forestWithZero = await svc.getForkForest({
      includeSubagents: false,
      includeZeroFork: true,
    });
    assert.equal(forestWithZero.totalTrees, 2);
    assert.equal(forestWithZero.forkedTreeCount, 1);
    assert.equal(forestWithZero.zeroForkTreeCount, 1);

    const sqDiffFiltered = await svc.getForkDivergence('conv-sideq-only-root', {
      userForksOnly: true,
    });
    assert.equal(sqDiffFiltered.hasForkPoint, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

let passed = 0;
for (const t of tests) {
  await t.fn();
  passed++;
  console.log(`✔ ${t.name}`);
}
console.log(`\nAll ${passed} unit tests passed.`);
