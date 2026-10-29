import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const REFERENCE_TYPE_NAMES = {
  0: 'CORTEX_TRAJECTORY_REFERENCE_TYPE_UNSPECIFIED',
  1: 'CORTEX_TRAJECTORY_REFERENCE_TYPE_PRUNE',
  2: 'CORTEX_TRAJECTORY_REFERENCE_TYPE_FORK',
  3: 'CORTEX_TRAJECTORY_REFERENCE_TYPE_BATTLE_MODE',
  4: 'CORTEX_TRAJECTORY_REFERENCE_TYPE_THOUGHT_REWRITE',
  5: 'CORTEX_TRAJECTORY_REFERENCE_TYPE_BATTLE_MODE_REFERENCE_BACKUP',
  6: 'CORTEX_TRAJECTORY_REFERENCE_TYPE_SUBAGENT_FORK',
};

export const REFERENCE_TYPE_LABELS = {
  0: 'UNSPECIFIED',
  1: 'PRUNE',
  2: 'FORK',
  3: 'BATTLE_MODE',
  4: 'THOUGHT_REWRITE',
  5: 'BATTLE_BACKUP',
  6: 'SUBAGENT_FORK',
  CORTEX_TRAJECTORY_REFERENCE_TYPE_UNSPECIFIED: 'UNSPECIFIED',
  CORTEX_TRAJECTORY_REFERENCE_TYPE_PRUNE: 'PRUNE',
  CORTEX_TRAJECTORY_REFERENCE_TYPE_FORK: 'FORK',
  CORTEX_TRAJECTORY_REFERENCE_TYPE_BATTLE_MODE: 'BATTLE_MODE',
  CORTEX_TRAJECTORY_REFERENCE_TYPE_THOUGHT_REWRITE: 'THOUGHT_REWRITE',
  CORTEX_TRAJECTORY_REFERENCE_TYPE_BATTLE_MODE_REFERENCE_BACKUP: 'BATTLE_BACKUP',
  CORTEX_TRAJECTORY_REFERENCE_TYPE_SUBAGENT_FORK: 'SUBAGENT_FORK',
};

export const STEP_TYPE_NAMES = {
  0: 'UNSPECIFIED',
  5: 'CODE_ACTION',
  6: 'GIT_COMMIT',
  7: 'GREP_SEARCH',
  8: 'VIEW_FILE',
  9: 'LIST_DIRECTORY',
  14: 'USER_INPUT',
  15: 'PLANNER_RESPONSE',
  17: 'ERROR_MESSAGE',
  21: 'RUN_COMMAND',
  25: 'READ_URL_CONTENT',
  27: 'SEARCH_WEB',
  30: 'MCP_TOOL',
  55: 'CODE_SEARCH',
  81: 'GENERIC',
  83: 'INVOKE_SUBAGENT',
  90: 'ASK_QUESTION',
};

export const STEP_STATUS_NAMES = {
  0: 'UNSPECIFIED',
  1: 'PENDING',
  2: 'IN_PROGRESS',
  3: 'DONE',
  4: 'ERROR',
  5: 'QUEUED',
  6: 'CANCELED',
  9: 'WAITING',
};

export const CONVERSATION_STATUS_NAMES = {
  0: 'IDLE',
  1: 'IDLE',
  2: 'RUNNING',
  3: 'WAITING',
  4: 'ERROR',
  CASCADE_RUN_STATUS_UNSPECIFIED: 'IDLE',
  CASCADE_RUN_STATUS_IDLE: 'IDLE',
  CASCADE_RUN_STATUS_RUNNING: 'RUNNING',
  CASCADE_RUN_STATUS_WAITING_FOR_USER: 'WAITING',
  CASCADE_RUN_STATUS_ERROR: 'ERROR',
};

/**
 * Low-level protobuf wire reader (zero external dependencies).
 */
export function readVarint(buf, offset) {
  let result = 0n;
  let shift = 0n;
  let pos = offset;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result, nextOffset: pos };
    }
    shift += 7n;
    if (shift > 70n) {
      throw new Error('Malformed protobuf varint');
    }
  }
  throw new Error('Unexpected EOF reading protobuf varint');
}

export function skipField(buf, offset, wireType) {
  switch (wireType) {
    case 0:
      return readVarint(buf, offset).nextOffset;
    case 1:
      return offset + 8;
    case 2: {
      const { value: len, nextOffset } = readVarint(buf, offset);
      return nextOffset + Number(len);
    }
    case 5:
      return offset + 4;
    default:
      throw new Error(`Unsupported protobuf wire type: ${wireType}`);
  }
}

/**
 * Decodes a binary CortexTrajectoryReference protobuf message from `parent_references.data`.
 *
 * message CortexTrajectoryReference {
 *   string trajectory_id = 1;
 *   int32 step_index = 2;
 *   CortexTrajectoryType trajectory_type = 3;
 *   CortexStepType step_type = 4;
 *   CortexTrajectoryReferenceType reference_type = 5;
 *   string conversation_id = 6;
 * }
 */
export function decodeCortexTrajectoryReference(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const ref = {
    trajectoryId: '',
    stepIndex: 0,
    trajectoryType: 0,
    stepType: 0,
    referenceType: 0,
    referenceTypeName: REFERENCE_TYPE_NAMES[0],
    referenceLabel: 'UNSPECIFIED',
    conversationId: '',
  };

  let offset = 0;
  while (offset < buf.length) {
    const { value: tag, nextOffset } = readVarint(buf, offset);
    offset = nextOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);

    if (fieldNumber === 1 && wireType === 2) {
      const { value: len, nextOffset: strStart } = readVarint(buf, offset);
      const end = strStart + Number(len);
      ref.trajectoryId = buf.subarray(strStart, end).toString('utf8');
      offset = end;
    } else if (fieldNumber === 2 && wireType === 0) {
      const { value, nextOffset: next } = readVarint(buf, offset);
      ref.stepIndex = Number(BigInt.asIntN(32, value));
      offset = next;
    } else if (fieldNumber === 3 && wireType === 0) {
      const { value, nextOffset: next } = readVarint(buf, offset);
      ref.trajectoryType = Number(value);
      offset = next;
    } else if (fieldNumber === 4 && wireType === 0) {
      const { value, nextOffset: next } = readVarint(buf, offset);
      ref.stepType = Number(value);
      offset = next;
    } else if (fieldNumber === 5 && wireType === 0) {
      const { value, nextOffset: next } = readVarint(buf, offset);
      const code = Number(value);
      ref.referenceType = code;
      ref.referenceTypeName =
        REFERENCE_TYPE_NAMES[code] || `CORTEX_TRAJECTORY_REFERENCE_TYPE_${code}`;
      ref.referenceLabel = REFERENCE_TYPE_LABELS[code] || `TYPE_${code}`;
      offset = next;
    } else if (fieldNumber === 6 && wireType === 2) {
      const { value: len, nextOffset: strStart } = readVarint(buf, offset);
      const end = strStart + Number(len);
      ref.conversationId = buf.subarray(strStart, end).toString('utf8');
      offset = end;
    } else {
      offset = skipField(buf, offset, wireType);
    }
  }

  return ref;
}

function decodeTimestamp(buf) {
  let seconds = 0n;
  let nanos = 0;
  let offset = 0;
  while (offset < buf.length) {
    const { value: tag, nextOffset } = readVarint(buf, offset);
    offset = nextOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);
    if (fieldNumber === 1 && wireType === 0) {
      const { value, nextOffset: next } = readVarint(buf, offset);
      seconds = BigInt.asIntN(64, value);
      offset = next;
    } else if (fieldNumber === 2 && wireType === 0) {
      const { value, nextOffset: next } = readVarint(buf, offset);
      nanos = Number(value);
      offset = next;
    } else {
      offset = skipField(buf, offset, wireType);
    }
  }
  if (seconds <= 0n) return null;
  const ms = Number(seconds) * 1000 + Math.floor(nanos / 1e6);
  return new Date(ms).toISOString();
}

function decodeChatToolCall(buf) {
  const call = { id: '', name: '', argumentsJson: '' };
  let offset = 0;
  while (offset < buf.length) {
    const { value: tag, nextOffset } = readVarint(buf, offset);
    offset = nextOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);
    if (fieldNumber === 1 && wireType === 2) {
      const { value: len, nextOffset: s } = readVarint(buf, offset);
      call.id = buf.subarray(s, s + Number(len)).toString('utf8');
      offset = s + Number(len);
    } else if (fieldNumber === 2 && wireType === 2) {
      const { value: len, nextOffset: s } = readVarint(buf, offset);
      call.name = buf.subarray(s, s + Number(len)).toString('utf8');
      offset = s + Number(len);
    } else if (fieldNumber === 3 && wireType === 2) {
      const { value: len, nextOffset: s } = readVarint(buf, offset);
      call.argumentsJson = buf.subarray(s, s + Number(len)).toString('utf8');
      offset = s + Number(len);
    } else {
      offset = skipField(buf, offset, wireType);
    }
  }
  return call;
}

function decodeStepMetadata(buf) {
  const meta = { createdAt: null, source: 0, toolCall: null };
  let offset = 0;
  while (offset < buf.length) {
    const { value: tag, nextOffset } = readVarint(buf, offset);
    offset = nextOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);
    if (fieldNumber === 1 && wireType === 2) {
      const { value: len, nextOffset: s } = readVarint(buf, offset);
      meta.createdAt = decodeTimestamp(buf.subarray(s, s + Number(len)));
      offset = s + Number(len);
    } else if (fieldNumber === 3 && wireType === 0) {
      const { value, nextOffset: next } = readVarint(buf, offset);
      meta.source = Number(value);
      offset = next;
    } else if (fieldNumber === 4 && wireType === 2) {
      const { value: len, nextOffset: s } = readVarint(buf, offset);
      meta.toolCall = decodeChatToolCall(buf.subarray(s, s + Number(len)));
      offset = s + Number(len);
    } else {
      offset = skipField(buf, offset, wireType);
    }
  }
  return meta;
}

function decodeUserInputStep(buf) {
  let userResponse = '';
  let query = '';
  let offset = 0;
  while (offset < buf.length) {
    const { value: tag, nextOffset } = readVarint(buf, offset);
    offset = nextOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);
    if (fieldNumber === 2 && wireType === 2) {
      const { value: len, nextOffset: s } = readVarint(buf, offset);
      userResponse = buf.subarray(s, s + Number(len)).toString('utf8');
      offset = s + Number(len);
    } else if (fieldNumber === 1 && wireType === 2) {
      const { value: len, nextOffset: s } = readVarint(buf, offset);
      query = buf.subarray(s, s + Number(len)).toString('utf8');
      offset = s + Number(len);
    } else {
      offset = skipField(buf, offset, wireType);
    }
  }
  return userResponse || query || '';
}

function decodePlannerResponseStep(buf) {
  const result = {
    response: '',
    modifiedResponse: '',
    thinking: '',
    toolCalls: [],
  };
  let offset = 0;
  while (offset < buf.length) {
    const { value: tag, nextOffset } = readVarint(buf, offset);
    offset = nextOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);
    if (fieldNumber === 1 && wireType === 2) {
      const { value: len, nextOffset: s } = readVarint(buf, offset);
      result.response = buf.subarray(s, s + Number(len)).toString('utf8');
      offset = s + Number(len);
    } else if (fieldNumber === 8 && wireType === 2) {
      const { value: len, nextOffset: s } = readVarint(buf, offset);
      result.modifiedResponse = buf.subarray(s, s + Number(len)).toString('utf8');
      offset = s + Number(len);
    } else if (fieldNumber === 3 && wireType === 2) {
      const { value: len, nextOffset: s } = readVarint(buf, offset);
      result.thinking = buf.subarray(s, s + Number(len)).toString('utf8');
      offset = s + Number(len);
    } else if (fieldNumber === 7 && wireType === 2) {
      const { value: len, nextOffset: s } = readVarint(buf, offset);
      result.toolCalls.push(decodeChatToolCall(buf.subarray(s, s + Number(len))));
      offset = s + Number(len);
    } else {
      offset = skipField(buf, offset, wireType);
    }
  }
  return result;
}

/**
 * Decodes a serialized `Step` payload from `conversations/<id>.db`.
 */
export function decodeStepPayload(
  payloadInput,
  metadataInput = null,
  stepIndex = 0,
  stepTypeCol = 0,
  statusCol = 0
) {
  const step = {
    stepIndex,
    typeCode: stepTypeCol,
    type: STEP_TYPE_NAMES[stepTypeCol] || `STEP_${stepTypeCol}`,
    statusCode: statusCol,
    status: STEP_STATUS_NAMES[statusCol] || `STATUS_${statusCol}`,
    createdAt: null,
    content: '',
    rawContent: '',
    thinking: '',
    toolCalls: [],
  };

  if (metadataInput && metadataInput.length > 0) {
    try {
      const meta = decodeStepMetadata(
        Buffer.isBuffer(metadataInput) ? metadataInput : Buffer.from(metadataInput)
      );
      if (meta.createdAt) step.createdAt = meta.createdAt;
      if (meta.toolCall && meta.toolCall.name) {
        step.toolCalls.push(meta.toolCall);
      }
    } catch {
      // Ignore malformed metadata blob
    }
  }

  if (!payloadInput || payloadInput.length === 0) {
    return step;
  }

  const buf = Buffer.isBuffer(payloadInput) ? payloadInput : Buffer.from(payloadInput);
  let offset = 0;
  try {
    while (offset < buf.length) {
      const { value: tag, nextOffset } = readVarint(buf, offset);
      offset = nextOffset;
      const fieldNumber = Number(tag >> 3n);
      const wireType = Number(tag & 0x7n);

      if (fieldNumber === 1 && wireType === 0) {
        const { value, nextOffset: next } = readVarint(buf, offset);
        step.typeCode = Number(value);
        step.type = STEP_TYPE_NAMES[step.typeCode] || `STEP_${step.typeCode}`;
        offset = next;
      } else if (fieldNumber === 4 && wireType === 0) {
        const { value, nextOffset: next } = readVarint(buf, offset);
        step.statusCode = Number(value);
        step.status = STEP_STATUS_NAMES[step.statusCode] || `STATUS_${step.statusCode}`;
        offset = next;
      } else if (fieldNumber === 5 && wireType === 2) {
        const { value: len, nextOffset: s } = readVarint(buf, offset);
        const meta = decodeStepMetadata(buf.subarray(s, s + Number(len)));
        if (meta.createdAt && !step.createdAt) step.createdAt = meta.createdAt;
        if (meta.toolCall && meta.toolCall.name && step.toolCalls.length === 0) {
          step.toolCalls.push(meta.toolCall);
        }
        offset = s + Number(len);
      } else if (fieldNumber === 19 && wireType === 2) {
        const { value: len, nextOffset: s } = readVarint(buf, offset);
        const raw = decodeUserInputStep(buf.subarray(s, s + Number(len)));
        step.rawContent = raw;
        step.content = cleanUserPromptText(raw);
        offset = s + Number(len);
      } else if (fieldNumber === 20 && wireType === 2) {
        const { value: len, nextOffset: s } = readVarint(buf, offset);
        const pr = decodePlannerResponseStep(buf.subarray(s, s + Number(len)));
        step.rawContent = pr.response || pr.modifiedResponse || '';
        step.content = step.rawContent.trim();
        step.thinking = pr.thinking || '';
        if (pr.toolCalls.length > 0) {
          step.toolCalls = pr.toolCalls;
        }
        offset = s + Number(len);
      } else {
        offset = skipField(buf, offset, wireType);
      }
    }
  } catch {
    // Return partial decoded step if truncated
  }

  return step;
}

/**
 * Strips `<USER_REQUEST>` and `<ADDITIONAL_METADATA>` wrappers injected into user prompts,
 * as well as extracting `<question>...</question>` from side-question prompts.
 */
export function cleanUserPromptText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const sideQMatch = raw.match(
    /This is a side question from the user\.[\s\S]*?Here is the question:\s*([\s\S]*?)$/i
  );
  if (sideQMatch && sideQMatch[1]) {
    return sideQMatch[1]
      .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
      .trim();
  }
  const questionMatch = raw.match(/<question>\s*([\s\S]*?)\s*<\/question>/i);
  if (questionMatch && questionMatch[1]) {
    return questionMatch[1].trim();
  }
  const match = raw.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  const stripped = raw
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
    .trim();
  return stripped || raw.trim();
}

export function isSideQuestionPrompt(raw) {
  if (!raw || typeof raw !== 'string') return false;
  return (
    raw.includes('This is a side question from the user.') ||
    /<question>[\s\S]*?<\/question>/i.test(raw)
  );
}

export function truncateText(text, maxChars = 280) {
  if (!text) return '';
  const normalized = String(text).trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

/**
 * Normalizes a `parentReferences` entry from either SQLite binary decode or LS JSON RPC.
 */
export function normalizeParentReference(rawRef) {
  if (!rawRef) return null;
  const conversationId = rawRef.conversationId || rawRef.conversation_id || '';
  const trajectoryId = rawRef.trajectoryId || rawRef.trajectory_id || '';
  const stepIndex = Number(rawRef.stepIndex ?? rawRef.step_index ?? 0);
  const rawType = rawRef.referenceType ?? rawRef.reference_type ?? 0;
  let referenceTypeName = '';
  let referenceLabel = 'FORK';

  if (typeof rawType === 'number') {
    referenceTypeName =
      REFERENCE_TYPE_NAMES[rawType] || `CORTEX_TRAJECTORY_REFERENCE_TYPE_${rawType}`;
    referenceLabel = REFERENCE_TYPE_LABELS[rawType] || 'FORK';
  } else if (typeof rawType === 'string') {
    referenceTypeName = rawType;
    referenceLabel =
      REFERENCE_TYPE_LABELS[rawType] ||
      rawType.replace(/^CORTEX_TRAJECTORY_REFERENCE_TYPE_/, '');
  }

  return {
    conversationId,
    trajectoryId,
    stepIndex,
    referenceTypeName,
    referenceLabel,
  };
}

/**
 * Determines the immediate fork parent from an ordered `parentReferences` array.
 *
 * `parentReferences` is ordered chronologically from oldest root ancestor to immediate fork parent.
 * If `T''` is forked from `T'` at a step index `<=` the step index where `T'` was forked
 * from `T`, the step owner of `T''` is attributed directly to `T`.
 */
export function extractForkParentInfo(selfConversationId, parentReferences, summaryRow = null) {
  const normalized = (parentReferences || [])
    .map(normalizeParentReference)
    .filter((r) => r && r.conversationId && r.conversationId !== selfConversationId);

  const forkRefs = normalized.filter(
    (r) =>
      r.referenceLabel === 'FORK' ||
      r.referenceLabel === 'SIDE_QUESTION' ||
      r.referenceLabel === 'SUBAGENT_FORK' ||
      r.referenceLabel === 'BATTLE_MODE' ||
      r.referenceLabel === 'THOUGHT_REWRITE' ||
      r.referenceLabel === 'UNSPECIFIED'
  );

  if (forkRefs.length > 0) {
    const immediate = forkRefs[forkRefs.length - 1];
    let label =
      immediate.referenceLabel === 'UNSPECIFIED' ? 'FORK' : immediate.referenceLabel;
    if (label === 'FORK' && summaryRow?.isSideQuestion) {
      label = 'SIDE_QUESTION';
    }
    return {
      parentConversationId: immediate.conversationId,
      forkAtStepIndex: immediate.stepIndex,
      referenceTypeName: immediate.referenceTypeName,
      referenceLabel: label,
      parentTrajectoryId: immediate.trajectoryId,
      ancestorReferences: forkRefs,
    };
  }

  // Fallback to summary table's parent_conversation_id (e.g. subagent conversations)
  const fallbackParentId =
    summaryRow?.parentConversationId || summaryRow?.parent_conversation_id || '';
  if (fallbackParentId && fallbackParentId !== selfConversationId) {
    return {
      parentConversationId: fallbackParentId,
      forkAtStepIndex: Number(summaryRow?.forkAtStepIndex ?? -1),
      referenceTypeName: 'CORTEX_TRAJECTORY_REFERENCE_TYPE_SUBAGENT_FORK',
      referenceLabel: 'SUBAGENT_FORK',
      parentTrajectoryId: '',
      ancestorReferences: [
        {
          conversationId: fallbackParentId,
          trajectoryId: '',
          stepIndex: Number(summaryRow?.forkAtStepIndex ?? -1),
          referenceTypeName: 'CORTEX_TRAJECTORY_REFERENCE_TYPE_SUBAGENT_FORK',
          referenceLabel: 'SUBAGENT_FORK',
        },
      ],
    };
  }

  return null;
}

/**
 * Pure graph builder from a map/array of conversation records.
 * Exposed as a pure function so unit tests can verify complex multi-hop, sibling,
 * and missing-intermediate-ancestor trees deterministically.
 */
export function buildForkTreeFromRecords(records, targetConversationId) {
  const byId = new Map();

  for (const rec of records) {
    if (!rec || !rec.conversationId) continue;
    const normRefs = (rec.parentReferences || []).map(normalizeParentReference).filter(Boolean);
    const forkFrom = extractForkParentInfo(rec.conversationId, normRefs, rec);
    byId.set(rec.conversationId, {
      ...rec,
      parentReferences: normRefs,
      forkFrom,
    });
  }

  // Ensure any intermediate ancestors referenced in `parentReferences` that were deleted
  // from disk still exist as placeholder nodes so lineage chains never break.
  for (const node of Array.from(byId.values())) {
    const refs = node.forkFrom?.ancestorReferences || [];
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      if (!ref.conversationId) continue;
      if (!byId.has(ref.conversationId)) {
        const prevRef = i > 0 ? refs[i - 1] : null;
        byId.set(ref.conversationId, {
          conversationId: ref.conversationId,
          title: `Deleted / Archived Session (${ref.conversationId.slice(0, 8)})`,
          preview: '',
          stepCount: ref.stepIndex + 1,
          lastModifiedTime: null,
          workspaceUris: [],
          workspaceNames: [],
          status: 'ARCHIVED',
          projectId: '',
          projectName: '',
          parentReferences: prevRef ? [prevRef] : [],
          missingOnDisk: true,
          forkFrom: prevRef
            ? {
                parentConversationId: prevRef.conversationId,
                forkAtStepIndex: prevRef.stepIndex,
                referenceTypeName: prevRef.referenceTypeName,
                referenceLabel: prevRef.referenceLabel,
                parentTrajectoryId: prevRef.trajectoryId,
                ancestorReferences: refs.slice(0, i),
              }
            : null,
        });
      }
    }
  }

  if (targetConversationId && !byId.has(targetConversationId)) {
    byId.set(targetConversationId, {
      conversationId: targetConversationId,
      title: `Session ${targetConversationId.slice(0, 8)}`,
      preview: '',
      stepCount: 0,
      lastModifiedTime: new Date().toISOString(),
      workspaceUris: [],
      workspaceNames: [],
      status: 'IDLE',
      projectId: '',
      projectName: '',
      parentReferences: [],
      forkFrom: null,
    });
  }

  // Build parent -> children adjacency
  const childrenByParent = new Map();
  for (const node of byId.values()) {
    const parentId = node.forkFrom?.parentConversationId;
    if (parentId && parentId !== node.conversationId) {
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId).push(node.conversationId);
    }
  }

  // Find root ancestor of targetConversationId (with cycle guard)
  function findRootId(startId) {
    let curr = startId;
    const seen = new Set();
    while (curr && !seen.has(curr)) {
      seen.add(curr);
      const node = byId.get(curr);
      const parentId = node?.forkFrom?.parentConversationId;
      if (!parentId || parentId === curr || !byId.has(parentId)) {
        return curr;
      }
      curr = parentId;
    }
    return curr || startId;
  }

  const rootId = targetConversationId ? findRootId(targetConversationId) : null;
  if (!rootId || !byId.has(rootId)) {
    return null;
  }

  // Compute active path set (from rootId down to targetConversationId)
  const activePathIds = new Set();
  const activeLineageChain = [];
  {
    let curr = targetConversationId;
    const seen = new Set();
    while (curr && !seen.has(curr)) {
      seen.add(curr);
      activePathIds.add(curr);
      activeLineageChain.unshift(curr);
      const node = byId.get(curr);
      const parentId = node?.forkFrom?.parentConversationId;
      if (!parentId || parentId === curr) break;
      curr = parentId;
    }
  }

  const targetNode = byId.get(targetConversationId);
  const targetParentId = targetNode?.forkFrom?.parentConversationId || null;

  // Traverse connected tree starting from rootId
  const flatNodes = [];
  let maxDepth = 0;
  const forkPointsMap = new Map();

  function buildSubtree(nodeId, depth, ancestorTrail, visited) {
    if (visited.has(nodeId)) return null;
    visited.add(nodeId);
    if (depth > maxDepth) maxDepth = depth;

    const raw = byId.get(nodeId);
    if (!raw) return null;

    const forkAtStep = raw.forkFrom ? Number(raw.forkFrom.forkAtStepIndex ?? -1) : null;
    const sharedSteps =
      forkAtStep !== null && forkAtStep >= 0 ? forkAtStep + 1 : 0;
    const totalSteps = Math.max(Number(raw.stepCount || 0), sharedSteps);
    const divergedSteps =
      forkAtStep !== null && forkAtStep >= 0
        ? Math.max(0, totalSteps - sharedSteps)
        : totalSteps;

    if (raw.forkFrom?.parentConversationId) {
      const fpKey = `${raw.forkFrom.parentConversationId}@${forkAtStep}`;
      if (!forkPointsMap.has(fpKey)) {
        forkPointsMap.set(fpKey, {
          parentConversationId: raw.forkFrom.parentConversationId,
          forkAtStepIndex: forkAtStep,
          childConversationIds: [],
        });
      }
      forkPointsMap.get(fpKey).childConversationIds.push(nodeId);
    }

    const childIds = (childrenByParent.get(nodeId) || []).slice();
    childIds.sort((aId, bId) => {
      const a = byId.get(aId);
      const b = byId.get(bId);
      const stepA = a?.forkFrom?.forkAtStepIndex ?? 0;
      const stepB = b?.forkFrom?.forkAtStepIndex ?? 0;
      if (stepA !== stepB) return stepA - stepB;
      const timeA = a?.lastModifiedTime || '';
      const timeB = b?.lastModifiedTime || '';
      return timeA.localeCompare(timeB);
    });

    const formattedNode = {
      conversationId: raw.conversationId,
      title: raw.title || raw.preview || `Session ${raw.conversationId.slice(0, 8)}`,
      preview: raw.preview || '',
      firstDivergedPrompt: raw.firstDivergedPrompt || '',
      status: raw.status || 'IDLE',
      notFullyIdle: Boolean(raw.notFullyIdle),
      stepCount: totalSteps,
      sharedSteps,
      divergedSteps,
      lastModifiedTime: raw.lastModifiedTime || null,
      lastUserInputTime: raw.lastUserInputTime || null,
      projectId: raw.projectId || '',
      projectName: raw.projectName || '',
      workspaceUris: raw.workspaceUris || [],
      workspaceNames: raw.workspaceNames || [],
      missingOnDisk: Boolean(raw.missingOnDisk),
      depth,
      isRoot: nodeId === rootId,
      isCurrent: nodeId === targetConversationId,
      isOnActivePath: activePathIds.has(nodeId),
      isAncestorOfCurrent:
        activePathIds.has(nodeId) && nodeId !== targetConversationId,
      isSiblingOfCurrent:
        Boolean(targetParentId) &&
        nodeId !== targetConversationId &&
        raw.forkFrom?.parentConversationId === targetParentId,
      isChildOfCurrent:
        raw.forkFrom?.parentConversationId === targetConversationId,
      forkFrom: raw.forkFrom
        ? {
            parentConversationId: raw.forkFrom.parentConversationId,
            forkAtStepIndex: forkAtStep,
            referenceTypeName: raw.forkFrom.referenceTypeName,
            referenceLabel: raw.forkFrom.referenceLabel,
            parentTrajectoryId: raw.forkFrom.parentTrajectoryId,
          }
        : null,
      ancestorTrail,
      children: [],
    };

    flatNodes.push({
      ...formattedNode,
      childConversationIds: childIds,
      children: undefined,
    });

    const nextTrail = [
      ...ancestorTrail,
      {
        conversationId: formattedNode.conversationId,
        title: formattedNode.title,
        forkAtStepIndex: forkAtStep,
      },
    ];

    formattedNode.children = childIds
      .map((cid) => buildSubtree(cid, depth + 1, nextTrail, visited))
      .filter(Boolean);

    return formattedNode;
  }

  const rootTree = buildSubtree(rootId, 0, [], new Set());

  return {
    targetConversationId,
    rootConversationId: rootId,
    totalNodes: flatNodes.length,
    maxDepth,
    hasForks: flatNodes.length > 1,
    activeLineageChain,
    forkPoints: Array.from(forkPointsMap.values()),
    root: rootTree,
    nodes: flatNodes,
  };
}

let cachedRuntimeEnv = null;

/**
 * Discovers the active app data directory, Language Server address, and CSRF token
 * from environment variables, `/proc/<pid>/environ`, or `~/.gemini/` subdirectories.
 */
export function resolveRuntimeEnv() {
  const envAppData = (process.env.ANTIGRAVITY_APP_DATA_DIR || '').trim();
  const envAddr = (process.env.ANTIGRAVITY_LS_ADDRESS || '').trim();
  const envCsrf = (process.env.ANTIGRAVITY_CSRF_TOKEN || '').trim();

  if (envAppData && envAddr && envCsrf) {
    return { appDataDir: envAppData, lsAddress: envAddr, csrfToken: envCsrf };
  }
  if (
    cachedRuntimeEnv?.appDataDir &&
    cachedRuntimeEnv?.lsAddress &&
    cachedRuntimeEnv?.csrfToken
  ) {
    return {
      appDataDir: envAppData || cachedRuntimeEnv.appDataDir,
      lsAddress: envAddr || cachedRuntimeEnv.lsAddress,
      csrfToken: envCsrf || cachedRuntimeEnv.csrfToken,
    };
  }

  let procAppData = '';
  let procAddr = '';
  let procCsrf = '';

  try {
    const pids = fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name));
    for (const pid of pids) {
      try {
        const raw = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
        if (
          !raw.includes('ANTIGRAVITY_LS_ADDRESS=') &&
          !raw.includes('ANTIGRAVITY_APP_DATA_DIR=')
        ) {
          continue;
        }
        for (const entry of raw.split('\0')) {
          if (!procAppData && entry.startsWith('ANTIGRAVITY_APP_DATA_DIR=')) {
            procAppData = entry.slice('ANTIGRAVITY_APP_DATA_DIR='.length).trim();
          } else if (!procAddr && entry.startsWith('ANTIGRAVITY_LS_ADDRESS=')) {
            procAddr = entry.slice('ANTIGRAVITY_LS_ADDRESS='.length).trim();
          } else if (!procCsrf && entry.startsWith('ANTIGRAVITY_CSRF_TOKEN=')) {
            procCsrf = entry.slice('ANTIGRAVITY_CSRF_TOKEN='.length).trim();
          }
        }
        if (procAppData && procAddr && procCsrf) break;
      } catch {
        // Ignore unreadable /proc entries
      }
    }
  } catch {
    // Ignore /proc scan errors on non-Linux systems
  }

  let resolvedAppData = envAppData || procAppData;
  if (!resolvedAppData) {
    const geminiRoot = path.join(os.homedir(), '.gemini');
    try {
      const subdirs = fs.readdirSync(geminiRoot, { withFileTypes: true });
      for (const dirent of subdirs) {
        if (!dirent.isDirectory() || dirent.name.startsWith('config')) continue;
        const candidate = path.join(geminiRoot, dirent.name);
        if (
          fs.existsSync(path.join(candidate, 'conversation_summaries.db')) ||
          fs.existsSync(path.join(candidate, 'conversations'))
        ) {
          resolvedAppData = candidate;
          break;
        }
      }
    } catch {
      // Ignore scan errors
    }
  }
  if (!resolvedAppData) {
    resolvedAppData = path.join(os.homedir(), '.gemini', 'antigravity');
  }

  cachedRuntimeEnv = {
    appDataDir: resolvedAppData,
    lsAddress: envAddr || procAddr,
    csrfToken: envCsrf || procCsrf,
  };
  return cachedRuntimeEnv;
}

/**
 * Stateful service that reads trajectory SQLite stores, transcripts, and Language Server RPCs
 * with mtime-based caching.
 */
export class ForkLineageService {
  constructor(options = {}) {
    const runtimeEnv = resolveRuntimeEnv();
    this.appDataDir = options.appDataDir || runtimeEnv.appDataDir;
    this.configDir =
      options.configDir ||
      path.join(os.homedir(), '.gemini', 'config');
    this.lsAddress =
      options.lsAddress !== undefined ? options.lsAddress : runtimeEnv.lsAddress;
    this.csrfToken =
      options.csrfToken !== undefined ? options.csrfToken : runtimeEnv.csrfToken;

    this._parentRefCache = new Map(); // convId -> { sig, parentReferences, stepCount }
    this._projectCache = { mtimeMs: 0, map: new Map() };
  }

  _getProjectNamesMap() {
    const projectsDir = path.join(this.configDir, 'projects');
    try {
      const stat = fs.statSync(projectsDir);
      if (stat.mtimeMs === this._projectCache.mtimeMs && this._projectCache.map.size > 0) {
        return this._projectCache.map;
      }
      const entries = fs.readdirSync(projectsDir);
      const map = new Map();
      for (const file of entries) {
        if (!file.endsWith('.json')) continue;
        const fullPath = path.join(projectsDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          const id = data.id || file.replace(/\.json$/, '');
          if (id && data.name) {
            map.set(id, data.name);
          }
        } catch {
          // Ignore malformed project file
        }
      }
      this._projectCache = { mtimeMs: stat.mtimeMs, map };
      return map;
    } catch {
      return this._projectCache.map;
    }
  }

  _parseWorkspaceUris(rawUris) {
    let uris = [];
    if (Array.isArray(rawUris)) {
      uris = rawUris;
    } else if (typeof rawUris === 'string' && rawUris.trim().startsWith('[')) {
      try {
        uris = JSON.parse(rawUris);
      } catch {
        uris = [];
      }
    }
    const names = uris.map((u) => {
      const cleaned = String(u).replace(/^file:\/\//, '').replace(/\/+$/, '');
      const parts = cleaned.split('/').filter(Boolean);
      return parts[parts.length - 1] || cleaned;
    });
    return { workspaceUris: uris, workspaceNames: names };
  }

  _readAnnotationTitle(conversationId) {
    const pbtxtPath = path.join(this.appDataDir, 'annotations', `${conversationId}.pbtxt`);
    try {
      if (!fs.existsSync(pbtxtPath)) return '';
      const content = fs.readFileSync(pbtxtPath, 'utf8');
      const match = content.match(/summary:\s*"([^"]+)"/);
      return match ? match[1] : '';
    } catch {
      return '';
    }
  }

  /**
   * Reads `parent_references` and `steps` count from `conversations/<id>.db`, cached by mtime.
   */
  readConversationDbLineage(conversationId) {
    const dbPath = path.join(this.appDataDir, 'conversations', `${conversationId}.db`);
    let stat;
    try {
      stat = fs.statSync(dbPath);
    } catch {
      return null;
    }

    let walMtimeMs = 0;
    let walSize = 0;
    try {
      const walStat = fs.statSync(`${dbPath}-wal`);
      walMtimeMs = walStat.mtimeMs;
      walSize = walStat.size;
    } catch {
      // No WAL file
    }

    const sig = `${stat.mtimeMs}:${stat.size}:${walMtimeMs}:${walSize}`;
    const cached = this._parentRefCache.get(conversationId);
    if (cached && cached.sig === sig) {
      return cached;
    }

    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      const rows = db
        .prepare('SELECT idx, data FROM parent_references ORDER BY idx ASC')
        .all();
      const parentReferences = [];
      for (const row of rows) {
        if (!row.data) continue;
        try {
          parentReferences.push(decodeCortexTrajectoryReference(row.data));
        } catch {
          // Ignore corrupted row
        }
      }

      let stepCount = 0;
      let derivedTitle = '';
      let firstDivergedPrompt = '';
      let isSideQuestion = false;
      try {
        const countRow = db
          .prepare('SELECT COALESCE(MAX(idx) + 1, 0) AS cnt FROM steps')
          .get();
        stepCount = Number(countRow?.cnt || 0);

        if (parentReferences.length > 0) {
          const lastRef = parentReferences[parentReferences.length - 1];
          const minIdx = Number(lastRef.stepIndex ?? -1) + 1;
          const firstPostUserRow = db
            .prepare(
              'SELECT idx, step_type, status, step_payload FROM steps WHERE idx >= ? AND step_type = 14 ORDER BY idx ASC LIMIT 1'
            )
            .get(minIdx);
          if (firstPostUserRow?.step_payload) {
            const decoded = decodeStepPayload(
              firstPostUserRow.step_payload,
              null,
              firstPostUserRow.idx,
              14,
              3
            );
            if (isSideQuestionPrompt(decoded.rawContent)) {
              isSideQuestion = true;
            }
            const nonEmptyLines = (decoded.content || '')
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean);
            let bestLine = nonEmptyLines[0] || '';
            if (/^\/[a-z0-9_-]+$/i.test(bestLine) && nonEmptyLines.length > 1) {
              bestLine = `${bestLine} ${nonEmptyLines[1]}`;
            }
            if (bestLine) {
              firstDivergedPrompt = truncateText(bestLine, 140);
              derivedTitle = truncateText(
                isSideQuestion ? `Side Q: ${bestLine}` : bestLine,
                68
              );
            }
          }
        }
      } catch {
        // Ignore if steps table missing
      }

      const entry = {
        sig,
        parentReferences,
        stepCount,
        derivedTitle,
        firstDivergedPrompt,
        isSideQuestion,
        mtimeMs: Math.max(stat.mtimeMs, walMtimeMs),
      };
      this._parentRefCache.set(conversationId, entry);
      return entry;
    } catch {
      return null;
    } finally {
      try {
        db?.close();
      } catch {
        // Ignore close error
      }
    }
  }

  /**
   * Loads all conversation records combining `conversation_summaries.db` and `conversations/*.db`.
   */
  loadAllConversationRecords() {
    const projectMap = this._getProjectNamesMap();
    const summariesById = new Map();

    const summariesDbPath = path.join(this.appDataDir, 'conversation_summaries.db');
    if (fs.existsSync(summariesDbPath)) {
      let db;
      try {
        db = new DatabaseSync(summariesDbPath, { readOnly: true });
        const rows = db
          .prepare(
            `SELECT
              conversation_id,
              title,
              preview,
              step_count,
              last_modified_time,
              workspace_uris,
              status,
              project_id,
              parent_conversation_id,
              nesting_depth,
              not_fully_idle,
              last_user_input_time
            FROM conversation_summaries`
          )
          .all();

        for (const r of rows) {
          const convId = r.conversation_id;
          if (!convId) continue;
          const { workspaceUris, workspaceNames } = this._parseWorkspaceUris(r.workspace_uris);
          const projectId = r.project_id || '';
          const title = r.title || this._readAnnotationTitle(convId) || r.preview || '';
          summariesById.set(convId, {
            conversationId: convId,
            title,
            preview: r.preview || '',
            stepCount: Number(r.step_count || 0),
            lastModifiedTime: r.last_modified_time || null,
            lastUserInputTime: r.last_user_input_time || null,
            workspaceUris,
            workspaceNames,
            status: CONVERSATION_STATUS_NAMES[r.status] || 'IDLE',
            notFullyIdle: Boolean(r.not_fully_idle),
            projectId,
            projectName: projectId ? projectMap.get(projectId) || projectId.slice(0, 8) : 'Outside of Project',
            parentConversationId: r.parent_conversation_id || '',
            nestingDepth: Number(r.nesting_depth || 0),
            parentReferences: [],
          });
        }
      } catch {
        // Ignore if locked or unavailable
      } finally {
        try {
          db?.close();
        } catch {
          // Ignore
        }
      }
    }

    // Scan `conversations/*.db` to attach `parent_references` (and discover any DB not yet in summaries)
    const convDir = path.join(this.appDataDir, 'conversations');
    if (fs.existsSync(convDir)) {
      try {
        const files = fs.readdirSync(convDir);
        for (const file of files) {
          if (!file.endsWith('.db')) continue;
          const convId = file.slice(0, -3);
          const dbInfo = this.readConversationDbLineage(convId);
          if (!dbInfo) continue;

          const existing = summariesById.get(convId);
          if (existing) {
            existing.parentReferences = dbInfo.parentReferences;
            existing.isSideQuestion = Boolean(dbInfo.isSideQuestion);
            existing.firstDivergedPrompt = dbInfo.firstDivergedPrompt || '';
            if (
              dbInfo.derivedTitle &&
              (!existing.title || /^\/[a-z0-9_-]+$/i.test(existing.title.trim()))
            ) {
              existing.title = dbInfo.derivedTitle;
            }
            if (dbInfo.stepCount > existing.stepCount) {
              existing.stepCount = dbInfo.stepCount;
            }
          } else {
            const title =
              this._readAnnotationTitle(convId) ||
              dbInfo.derivedTitle ||
              `Session ${convId.slice(0, 8)}`;
            summariesById.set(convId, {
              conversationId: convId,
              title,
              preview: '',
              firstDivergedPrompt: dbInfo.firstDivergedPrompt || '',
              stepCount: dbInfo.stepCount,
              lastModifiedTime: dbInfo.mtimeMs ? new Date(dbInfo.mtimeMs).toISOString() : null,
              lastUserInputTime: null,
              workspaceUris: [],
              workspaceNames: [],
              status: 'IDLE',
              notFullyIdle: false,
              projectId: '',
              projectName: 'Outside of Project',
              parentConversationId: '',
              nestingDepth: 0,
              isSideQuestion: Boolean(dbInfo.isSideQuestion),
              parentReferences: dbInfo.parentReferences,
            });
          }
        }
      } catch {
        // Ignore readdir failure
      }
    }

    return Array.from(summariesById.values());
  }

  /**
   * Optional Language Server JSON-RPC helper.
   */
  async callLsRpc(method, body = {}) {
    if (!this.lsAddress) return null;
    const hostPort = this.lsAddress.replace(/^https?:\/\//, '');
    const payload = JSON.stringify(body);

    return new Promise((resolve) => {
      const req = http.request(
        `http://${hostPort}/exa.language_server_pb.LanguageServerService/${method}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-codeium-csrf-token': this.csrfToken || '',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 2500,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              resolve(null);
              return;
            }
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
              resolve(null);
            }
          });
        }
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.write(payload);
      req.end();
    });
  }

  /**
   * Resolves the most recently active conversation ID when none is explicitly provided.
   */
  resolveDefaultConversationId(records = null) {
    const all = records || this.loadAllConversationRecords();
    if (all.length === 0) return '';
    const sorted = all
      .filter((r) => !r.parentConversationId)
      .sort((a, b) => (b.lastModifiedTime || '').localeCompare(a.lastModifiedTime || ''));
    return (sorted[0] || all[0])?.conversationId || '';
  }

  /**
   * Lists conversation families in the workspace/appDataDir, excluding inline side questions
   * (`SIDE_QUESTION`) and optionally subagent forks or zero-fork standalone sessions.
   */
  listForkFamilies({
    limit = 25,
    includeSubagents = false,
    includeZeroFork = false,
    records = null,
  } = {}) {
    const all = records || this.loadAllConversationRecords();
    const byId = new Map();
    for (const rec of all) {
      const normRefs = (rec.parentReferences || []).map(normalizeParentReference).filter(Boolean);
      const forkFrom = extractForkParentInfo(rec.conversationId, normRefs, rec);
      const refLabel = forkFrom?.referenceLabel || '';
      if (refLabel === 'SIDE_QUESTION') continue;
      if (!includeSubagents && refLabel === 'SUBAGENT_FORK') continue;
      byId.set(rec.conversationId, { ...rec, parentReferences: normRefs, forkFrom });
    }

    const rootGroups = new Map();
    function getRoot(id) {
      let curr = id;
      const seen = new Set();
      while (curr && !seen.has(curr)) {
        seen.add(curr);
        const node = byId.get(curr);
        const parentId = node?.forkFrom?.parentConversationId;
        if (!parentId || parentId === curr) return curr;
        curr = parentId;
      }
      return curr;
    }

    for (const node of byId.values()) {
      const rootId = getRoot(node.conversationId);
      if (!rootGroups.has(rootId)) {
        rootGroups.set(rootId, []);
      }
      rootGroups.get(rootId).push(node);
    }

    const families = [];
    for (const [rootId, members] of rootGroups.entries()) {
      if (!includeZeroFork && members.length <= 1) continue;
      const rootNode = byId.get(rootId) || members[0];
      let latestModified = '';
      for (const m of members) {
        if ((m.lastModifiedTime || '') > latestModified) {
          latestModified = m.lastModifiedTime;
        }
      }
      families.push({
        rootConversationId: rootId,
        rootTitle:
          rootNode?.title ||
          rootNode?.preview ||
          `Session ${rootId.slice(0, 8)}`,
        branchCount: members.length,
        latestModifiedTime: latestModified || null,
        projectName: rootNode?.projectName || '',
        workspaceNames: rootNode?.workspaceNames || [],
        memberIds: members.map((m) => m.conversationId),
      });
    }

    families.sort((a, b) =>
      (b.latestModifiedTime || '').localeCompare(a.latestModifiedTime || '')
    );

    return families.slice(0, limit);
  }

  /**
   * Builds the global Session Fork Forest across all workspaces and projects.
   * Side questions (`SIDE_QUESTION`) are completely excluded. By default only
   * trees with at least one fork (`totalNodes > 1`) are returned unless
   * `includeZeroFork` is enabled.
   */
  async getForkForest({
    includeSubagents = false,
    includeZeroFork = false,
    limit = 60,
  } = {}) {
    const rawRecords = this.loadAllConversationRecords();
    const filteredRecords = [];
    for (const rec of rawRecords) {
      const normRefs = (rec.parentReferences || []).map(normalizeParentReference).filter(Boolean);
      const forkFrom = extractForkParentInfo(rec.conversationId, normRefs, rec);
      const refLabel = forkFrom?.referenceLabel || '';
      if (refLabel === 'SIDE_QUESTION') continue;
      if (!includeSubagents && refLabel === 'SUBAGENT_FORK') continue;
      filteredRecords.push({
        ...rec,
        parentReferences: normRefs,
        forkFrom,
      });
    }

    const families = this.listForkFamilies({
      limit,
      includeSubagents,
      includeZeroFork,
      records: filteredRecords,
    });

    const trees = [];
    let totalBranches = 0;
    let totalForkPoints = 0;
    let forkedTreeCount = 0;
    let zeroForkTreeCount = 0;
    const projectCounts = new Map();

    for (const fam of families) {
      const built = buildForkTreeFromRecords(filteredRecords, fam.rootConversationId);
      if (!built || (!includeZeroFork && built.totalNodes <= 1)) continue;
      if (built.totalNodes > 1) {
        forkedTreeCount += 1;
      } else {
        zeroForkTreeCount += 1;
      }
      const projectName = built.root?.projectName || fam.projectName || 'Outside of Project';
      projectCounts.set(projectName, (projectCounts.get(projectName) || 0) + 1);
      totalBranches += built.totalNodes;
      totalForkPoints += (built.forkPoints || []).length;

      trees.push({
        rootConversationId: built.rootConversationId,
        rootTitle: built.root?.title || fam.rootTitle,
        projectName,
        workspaceNames: built.root?.workspaceNames || fam.workspaceNames || [],
        latestModifiedTime: fam.latestModifiedTime,
        totalNodes: built.totalNodes,
        maxDepth: built.maxDepth,
        forkPointCount: (built.forkPoints || []).length,
        forkPoints: built.forkPoints || [],
        root: built.root,
        nodes: built.nodes,
      });
    }

    const projects = Array.from(projectCounts.entries())
      .map(([projectName, treeCount]) => ({ projectName, treeCount }))
      .sort((a, b) => b.treeCount - a.treeCount || a.projectName.localeCompare(b.projectName));

    return {
      totalTrees: trees.length,
      forkedTreeCount,
      zeroForkTreeCount,
      totalBranches,
      totalForkPoints,
      includeSubagents: Boolean(includeSubagents),
      includeZeroFork: Boolean(includeZeroFork),
      projects,
      trees,
    };
  }

  /**
   * Returns the complete fork tree for `conversationId`, plus recent forked families.
   */
  async getForkTree(conversationId, { includeRecentFamilies = true, recentLimit = 15 } = {}) {
    const records = this.loadAllConversationRecords();
    const targetId = conversationId || this.resolveDefaultConversationId(records);

    // If LS is available, check if the active conversation has in-memory parentReferences not yet on disk
    if (targetId && this.lsAddress) {
      const existing = records.find((r) => r.conversationId === targetId);
      if (!existing || existing.parentReferences.length === 0) {
        const rpcRes = await this.callLsRpc('GetCascadeTrajectory', { cascadeId: targetId });
        const traj = rpcRes?.trajectory;
        if (traj) {
          const rpcRefs = (traj.parentReferences || []).map(normalizeParentReference).filter(Boolean);
          if (existing) {
            if (rpcRefs.length > 0) existing.parentReferences = rpcRefs;
            if (Array.isArray(traj.steps) && traj.steps.length > existing.stepCount) {
              existing.stepCount = traj.steps.length;
            }
          } else {
            records.push({
              conversationId: targetId,
              title: `Session ${targetId.slice(0, 8)}`,
              preview: '',
              stepCount: Array.isArray(traj.steps) ? traj.steps.length : 0,
              lastModifiedTime: new Date().toISOString(),
              workspaceUris: [],
              workspaceNames: [],
              status: 'IDLE',
              projectId: '',
              projectName: 'Outside of Project',
              parentReferences: rpcRefs,
            });
          }
        }
      }
    }

    const tree = buildForkTreeFromRecords(records, targetId);
    const recentForkFamilies = includeRecentFamilies
      ? this.listForkFamilies({ limit: recentLimit, records })
      : [];

    return {
      ...tree,
      recentForkFamilies,
    };
  }

  /**
   * Loads normalized steps for a conversation from:
   * 1. `conversations/<id>.db` (`steps` table, guaranteed to contain inherited pre-fork steps `0..forkAtStepIndex`)
   * 2. `brain/<id>/.system_generated/logs/transcript.jsonl`
   * 3. `LanguageServerService/GetCascadeTrajectory` RPC fallback
   */
  async loadConversationSteps(conversationId, { minStep = 0, maxStep = Infinity } = {}) {
    // 1. Try SQLite `conversations/<id>.db` first because it is guaranteed to contain
    // all steps including inherited pre-fork steps `0..forkAtStepIndex`!
    const dbPath = path.join(this.appDataDir, 'conversations', `${conversationId}.db`);
    if (fs.existsSync(dbPath)) {
      let db;
      try {
        db = new DatabaseSync(dbPath, { readOnly: true });
        const upper = Number.isFinite(maxStep) ? maxStep : 999999999;
        const rows = db
          .prepare(
            `SELECT idx, step_type, status, metadata, step_payload
             FROM steps
             WHERE idx >= ? AND idx <= ?
             ORDER BY idx ASC`
          )
          .all(minStep, upper);

        if (rows.length > 0) {
          return rows.map((r) =>
            decodeStepPayload(r.step_payload, r.metadata, r.idx, r.step_type, r.status)
          );
        }
      } catch {
        // Fallback to transcript.jsonl or RPC
      } finally {
        try {
          db?.close();
        } catch {
          // Ignore
        }
      }
    }

    // 2. Fallback to `transcript.jsonl`
    const transcriptPath = path.join(
      this.appDataDir,
      'brain',
      conversationId,
      '.system_generated',
      'logs',
      'transcript.jsonl'
    );
    if (fs.existsSync(transcriptPath)) {
      try {
        const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
        const steps = [];
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            const idx = Number(obj.step_index ?? steps.length);
            if (idx < minStep || idx > maxStep) continue;
            const rawContent = obj.content || '';
            steps.push({
              stepIndex: idx,
              type: (obj.type || 'GENERIC').replace(/^CORTEX_STEP_TYPE_/, ''),
              status: (obj.status || 'DONE').replace(/^CORTEX_STEP_STATUS_/, ''),
              createdAt: obj.created_at || null,
              rawContent,
              content:
                obj.type === 'USER_INPUT'
                  ? cleanUserPromptText(rawContent)
                  : String(rawContent).trim(),
              thinking: obj.thinking || '',
              toolCalls: Array.isArray(obj.tool_calls)
                ? obj.tool_calls.map((tc) => ({
                    name: tc.name || '',
                    argumentsJson:
                      typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {}),
                  }))
                : [],
            });
          } catch {
            // Skip malformed JSONL line
          }
        }
        if (steps.length > 0) return steps;
      } catch {
        // Fallback to RPC
      }
    }

    // 3. Fallback to Language Server RPC
    if (this.lsAddress) {
      const rpcRes = await this.callLsRpc('GetCascadeTrajectory', { cascadeId: conversationId });
      const rawSteps = rpcRes?.trajectory?.steps;
      if (Array.isArray(rawSteps)) {
        const out = [];
        for (let i = 0; i < rawSteps.length; i++) {
          if (i < minStep || i > maxStep) continue;
          const s = rawSteps[i] || {};
          const type = String(s.type || 'GENERIC').replace(/^CORTEX_STEP_TYPE_/, '');
          const status = String(s.status || 'DONE').replace(/^CORTEX_STEP_STATUS_/, '');
          let rawContent = '';
          let thinking = '';
          let toolCalls = [];

          if (type === 'USER_INPUT') {
            rawContent = s.userInput?.userResponse || s.userInput?.query || '';
          } else if (type === 'PLANNER_RESPONSE') {
            rawContent = s.plannerResponse?.response || s.plannerResponse?.modifiedResponse || '';
            thinking = s.plannerResponse?.thinking || '';
            if (Array.isArray(s.plannerResponse?.toolCalls)) {
              toolCalls = s.plannerResponse.toolCalls.map((tc) => ({
                id: tc.id || '',
                name: tc.name || '',
                argumentsJson: tc.argumentsJson || '',
              }));
            }
          }
          if (s.metadata?.toolCall?.name && toolCalls.length === 0) {
            toolCalls.push({
              id: s.metadata.toolCall.id || '',
              name: s.metadata.toolCall.name,
              argumentsJson: s.metadata.toolCall.argumentsJson || '',
            });
          }

          out.push({
            stepIndex: i,
            type,
            status,
            createdAt: s.metadata?.createdAt || null,
            rawContent,
            content:
              type === 'USER_INPUT' ? cleanUserPromptText(rawContent) : rawContent.trim(),
            thinking,
            toolCalls,
          });
        }
        return out;
      }
    }

    return [];
  }

  /**
   * Computes the Fork Point context (`<= forkAtStepIndex`) and side-by-side Divergence Diff
   * (`> forkAtStepIndex`) across the parent continuation and forked branches.
   */
  async getForkDivergence(
    conversationId,
    {
      parentConversationId = null,
      forkAtStepIndex = null,
      maxTurnsPerBranch = 12,
      userForksOnly = false,
    } = {}
  ) {
    const tree = await this.getForkTree(conversationId, { includeRecentFamilies: false });
    if (!tree || !tree.nodes) {
      return null;
    }

    const isAllowedChild = (n) => {
      if (!userForksOnly) return true;
      const lbl = n.forkFrom?.referenceLabel || '';
      return lbl !== 'SIDE_QUESTION' && lbl !== 'SUBAGENT_FORK';
    };

    const nodesById = new Map(tree.nodes.map((n) => [n.conversationId, n]));
    const selectedNode = nodesById.get(conversationId) || nodesById.get(tree.targetConversationId);

    // Resolve which (parentConversationId, forkAtStepIndex) to inspect
    let resolvedParentId = parentConversationId;
    let resolvedForkStep =
      forkAtStepIndex !== null && forkAtStepIndex !== undefined && forkAtStepIndex !== ''
        ? Number(forkAtStepIndex)
        : null;

    if (!resolvedParentId) {
      if (selectedNode?.forkFrom?.parentConversationId && isAllowedChild(selectedNode)) {
        resolvedParentId = selectedNode.forkFrom.parentConversationId;
        if (resolvedForkStep === null) {
          resolvedForkStep = selectedNode.forkFrom.forkAtStepIndex;
        }
      } else if (selectedNode) {
        // Selected node is a root/parent: pick its child fork point if it has children,
        // preferring full user FORK branches over SIDE_QUESTION and SUBAGENT_FORK.
        const children = tree.nodes
          .filter(
            (n) =>
              n.forkFrom?.parentConversationId === selectedNode.conversationId &&
              isAllowedChild(n)
          )
          .sort((a, b) => {
            const rank = (n) => {
              const lbl = n.forkFrom?.referenceLabel;
              if (lbl === 'FORK') return 0;
              if (lbl === 'SIDE_QUESTION') return 1;
              return 2;
            };
            const rDiff = rank(a) - rank(b);
            if (rDiff !== 0) return rDiff;
            return (a.forkFrom?.forkAtStepIndex ?? 0) - (b.forkFrom?.forkAtStepIndex ?? 0);
          });
        if (children.length > 0) {
          resolvedParentId = selectedNode.conversationId;
          if (resolvedForkStep === null) {
            resolvedForkStep = children[0].forkFrom.forkAtStepIndex;
          }
        }
      }
    }

    if (!resolvedParentId) {
      return {
        hasForkPoint: false,
        selectedConversationId: selectedNode?.conversationId || conversationId,
        message: 'This session has no parent fork or child forks to compare.',
        forkPoint: null,
        branches: [],
      };
    }

    const parentNode = nodesById.get(resolvedParentId);
    const siblingForkNodes = tree.nodes.filter(
      (n) =>
        n.forkFrom?.parentConversationId === resolvedParentId && isAllowedChild(n)
    );

    if (resolvedForkStep === null && siblingForkNodes.length > 0) {
      resolvedForkStep = siblingForkNodes[0].forkFrom.forkAtStepIndex;
    }
    if (resolvedForkStep === null || resolvedForkStep < 0) {
      resolvedForkStep = 0;
    }

    // Load steps up to `resolvedForkStep` from either parentNode (if on disk) or first child fork
    let sharedStepsSource = await this.loadConversationSteps(resolvedParentId, {
      minStep: 0,
      maxStep: resolvedForkStep,
    });
    if (sharedStepsSource.length === 0 && siblingForkNodes.length > 0) {
      sharedStepsSource = await this.loadConversationSteps(
        siblingForkNodes[0].conversationId,
        { minStep: 0, maxStep: resolvedForkStep }
      );
    }

    const stepAtFork =
      sharedStepsSource.find((s) => s.stepIndex === resolvedForkStep) ||
      sharedStepsSource[sharedStepsSource.length - 1] ||
      null;

    let lastSharedUserPrompt = null;
    let lastSharedAssistantResponse = null;
    for (let i = sharedStepsSource.length - 1; i >= 0; i--) {
      const s = sharedStepsSource[i];
      if (!lastSharedUserPrompt && s.type === 'USER_INPUT' && s.content) {
        lastSharedUserPrompt = {
          stepIndex: s.stepIndex,
          createdAt: s.createdAt,
          text: s.content,
          preview: truncateText(s.content, 360),
        };
      }
      if (
        !lastSharedAssistantResponse &&
        s.type === 'PLANNER_RESPONSE' &&
        (s.content || s.toolCalls?.length > 0)
      ) {
        lastSharedAssistantResponse = {
          stepIndex: s.stepIndex,
          createdAt: s.createdAt,
          text: s.content,
          preview: truncateText(s.content, 360),
          toolCalls: (s.toolCalls || []).map((tc) => tc.name).filter(Boolean),
        };
      }
      if (lastSharedUserPrompt && lastSharedAssistantResponse) break;
    }

    // Summarize post-fork divergence for a branch given its branchforkAtStep
    const summarizeBranchPostFork = async (node, branchType, branchForkStep) => {
      const postSteps = await this.loadConversationSteps(node.conversationId, {
        minStep: branchForkStep + 1,
      });

      const userPrompts = [];
      const assistantResponses = [];
      const toolCounts = new Map();
      const turns = [];
      let currentTurn = null;

      for (const s of postSteps) {
        for (const tc of s.toolCalls || []) {
          if (tc.name) {
            toolCounts.set(tc.name, (toolCounts.get(tc.name) || 0) + 1);
          }
        }

        if (s.type === 'USER_INPUT' && s.content) {
          const promptEntry = {
            stepIndex: s.stepIndex,
            createdAt: s.createdAt,
            text: s.content,
            preview: truncateText(s.content, 320),
          };
          userPrompts.push(promptEntry);
          if (currentTurn) turns.push(currentTurn);
          currentTurn = {
            userPrompt: promptEntry,
            assistantResponses: [],
            toolCalls: [],
          };
        } else if (s.type === 'PLANNER_RESPONSE') {
          const toolNames = (s.toolCalls || []).map((tc) => tc.name).filter(Boolean);
          if (s.content) {
            const respEntry = {
              stepIndex: s.stepIndex,
              createdAt: s.createdAt,
              text: s.content,
              preview: truncateText(s.content, 320),
              toolCalls: toolNames,
            };
            assistantResponses.push(respEntry);
            if (!currentTurn) {
              currentTurn = {
                userPrompt: null,
                assistantResponses: [],
                toolCalls: [],
              };
            }
            currentTurn.assistantResponses.push(respEntry);
          }
          if (currentTurn && toolNames.length > 0) {
            for (const tn of toolNames) {
              if (!currentTurn.toolCalls.includes(tn)) {
                currentTurn.toolCalls.push(tn);
              }
            }
          }
        }
      }
      if (currentTurn) turns.push(currentTurn);

      const postForkToolSummary = Array.from(toolCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      return {
        branchType,
        conversationId: node.conversationId,
        title: node.title,
        status: node.status,
        isCurrent: node.conversationId === tree.targetConversationId,
        isSelected: node.conversationId === selectedNode?.conversationId,
        forkAtStepIndex: branchForkStep,
        exactStepMatch: branchForkStep === resolvedForkStep,
        referenceLabel:
          branchType === 'PARENT_CONTINUATION'
            ? 'ORIGIN'
            : node.forkFrom?.referenceLabel || 'FORK',
        totalSteps: node.stepCount,
        sharedSteps: branchForkStep + 1,
        divergedStepCount: Math.max(0, node.stepCount - (branchForkStep + 1)),
        userTurnCountAfterFork: userPrompts.length,
        toolCallCountAfterFork: Array.from(toolCounts.values()).reduce((a, b) => a + b, 0),
        workspaceNames: node.workspaceNames || [],
        lastModifiedTime: node.lastModifiedTime,
        firstDivergedUserPrompt: userPrompts[0] || null,
        firstDivergedAssistantResponse: assistantResponses[0] || null,
        latestUserPrompt: userPrompts[userPrompts.length - 1] || null,
        latestAssistantResponse: assistantResponses[assistantResponses.length - 1] || null,
        postForkToolSummary,
        postForkTurns: turns.slice(0, maxTurnsPerBranch),
      };
    };

    const branches = [];
    if (parentNode) {
      branches.push(
        await summarizeBranchPostFork(parentNode, 'PARENT_CONTINUATION', resolvedForkStep)
      );
    }

    // Order child branches: exact fork step matches first, then selected/current, then by fork step
    const orderedChildren = siblingForkNodes.slice().sort((a, b) => {
      const aExact = a.forkFrom?.forkAtStepIndex === resolvedForkStep ? 0 : 1;
      const bExact = b.forkFrom?.forkAtStepIndex === resolvedForkStep ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return (a.forkFrom?.forkAtStepIndex ?? 0) - (b.forkFrom?.forkAtStepIndex ?? 0);
    });

    for (const child of orderedChildren) {
      const childForkStep = child.forkFrom?.forkAtStepIndex ?? resolvedForkStep;
      branches.push(await summarizeBranchPostFork(child, 'FORK_BRANCH', childForkStep));
    }

    return {
      hasForkPoint: true,
      selectedConversationId: selectedNode?.conversationId || conversationId,
      forkPoint: {
        parentConversationId: resolvedParentId,
        parentTitle: parentNode?.title || `Session ${resolvedParentId.slice(0, 8)}`,
        forkAtStepIndex: resolvedForkStep,
        sharedStepCount: resolvedForkStep + 1,
        stepAtFork: stepAtFork
          ? {
              stepIndex: stepAtFork.stepIndex,
              type: stepAtFork.type,
              status: stepAtFork.status,
              createdAt: stepAtFork.createdAt,
              preview: truncateText(stepAtFork.content, 240),
            }
          : null,
        lastSharedUserPrompt,
        lastSharedAssistantResponse,
      },
      branches,
    };
  }
}
