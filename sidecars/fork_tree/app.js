(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const uiToken = urlParams.get('token') || '';
  const boundConversationId = urlParams.get('conversationId') || '';
  const isForestMode = window.location.pathname === '/forest';

  const state = {
    isForestMode,
    hostConversationId: boundConversationId,
    inspectedConversationId: boundConversationId,
    selectedNodeId: '',
    selectedTreeRootId: '',
    filterQuery: '',
    projectFilter: '',
    userForksOnly: true,
    includeZeroFork: false,
    collapsedTreeIds: new Set(),
    allCollapsed: false,
    autoRefresh: true,
    treeData: null,
    forestData: null,
    divergenceData: null,
    loadingTree: false,
    loadingDivergence: false,
  };

  function syncThemeScheme() {
    const probe = document.createElement('span');
    probe.style.cssText =
      'position:absolute;visibility:hidden;color:var(--background, #0f1115)';
    document.documentElement.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    const nums = (c.match(/[\d.]+/g) || []).map(Number);
    if (nums.length < 3) return;
    const scale = c.startsWith('color(') ? 1 : 255;
    const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    document.documentElement.dataset.theme = lum < 0.5 ? 'dark' : 'light';
  }
  syncThemeScheme();

  // Listen for host postMessage events (theme-change, workspace-change, etc.)
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'theme-change') {
      const styles =
        data.payload?.cssVariables || data.theme?.styles || data.styles || {};
      const root = document.documentElement;
      for (const [k, v] of Object.entries(styles)) {
        if (k.startsWith('--') && typeof v === 'string') {
          root.style.setProperty(k, v);
        }
      }
      syncThemeScheme();
      const incomingConvId =
        data.payload?.conversationId ||
        data.context?.conversationId ||
        data.conversationId ||
        '';
      if (
        !boundConversationId &&
        incomingConvId &&
        incomingConvId !== state.hostConversationId
      ) {
        const wasFollowingHost =
          !state.inspectedConversationId ||
          state.inspectedConversationId === state.hostConversationId;
        state.hostConversationId = incomingConvId;
        if (wasFollowingHost) {
          state.inspectedConversationId = incomingConvId;
          loadTree(true);
        }
      }
    } else if (data.type === 'workspace-change' || data.type === 'context-change') {
      const incomingConvId =
        data.payload?.conversationId ||
        data.conversationId ||
        data.context?.conversationId ||
        '';
      if (
        !boundConversationId &&
        incomingConvId &&
        incomingConvId !== state.hostConversationId
      ) {
        state.hostConversationId = incomingConvId;
        state.inspectedConversationId = incomingConvId;
        loadTree(true);
      }
    }
  });

  function showToast(message) {
    const banner = document.getElementById('toastBanner');
    if (!banner) return;
    banner.textContent = message;
    banner.classList.add('visible');
    clearTimeout(banner._timer);
    banner._timer = setTimeout(() => {
      banner.classList.remove('visible');
    }, 2400);
  }

  function switchHostConversation(conversationId) {
    if (!conversationId) return;
    // Pre-warm trajectory in Language Server for older on-disk conversations
    apiPost('/api/load-trajectory', { conversationId }).catch(() => {});

    if (window.sidecar?.ui?.toggleConversation) {
      window.sidecar.ui.toggleConversation(conversationId);
    } else {
      window.parent.postMessage(
        {
          type: 'toggle-conversation',
          payload: { conversationId },
        },
        '*'
      );
    }
    if (!boundConversationId) {
      state.inspectedConversationId = conversationId;
      state.selectedNodeId = conversationId;
      loadTree(false);
    }
    showToast(`Switching session to ${conversationId.slice(0, 8)}…`);
  }

  async function copyText(text, label = 'Copied to clipboard') {
    try {
      await navigator.clipboard.writeText(text);
      showToast(label);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(label);
    }
  }

  function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toISOString().slice(0, 10);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function apiGet(pathWithQuery) {
    const url = new URL(pathWithQuery, window.location.origin);
    if (uiToken) url.searchParams.set('token', uiToken);
    const res = await fetch(url.toString(), {
      headers: uiToken ? { 'X-Sidecar-Token': uiToken } : {},
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  async function apiPost(pathName, body) {
    const url = new URL(pathName, window.location.origin);
    if (uiToken) url.searchParams.set('token', uiToken);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(uiToken ? { 'X-Sidecar-Token': uiToken } : {}),
      },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function loadTree(resetSelection = false) {
    if (state.loadingTree) return;
    state.loadingTree = true;
    try {
      if (state.isForestMode) {
        const limit = state.includeZeroFork ? 200 : 60;
        const data = await apiGet(
          `/api/forest?includeZeroFork=${state.includeZeroFork ? 'true' : 'false'}&limit=${limit}`
        );
        const forest = data.forest;
        state.forestData = forest;

        const trees = forest?.trees || [];
        if (trees.length > 0) {
          const allNodeIds = new Set();
          for (const t of trees) {
            for (const n of t.nodes || []) {
              allNodeIds.add(n.conversationId);
            }
          }
          if (resetSelection || !state.selectedNodeId || !allNodeIds.has(state.selectedNodeId)) {
            const firstTree = trees.find((t) => t.totalNodes > 1) || trees[0];
            state.selectedTreeRootId = firstTree.rootConversationId;
            const firstForkChild = (firstTree.nodes || []).find(
              (n) => !n.isRoot && n.forkFrom?.referenceLabel === 'FORK'
            );
            state.selectedNodeId =
              firstForkChild?.conversationId || firstTree.rootConversationId || '';
          }
        }

        renderAll();
        if (state.selectedNodeId) {
          await loadDivergence(state.selectedNodeId);
        }
        return;
      }

      const queryConv = state.inspectedConversationId || state.hostConversationId || '';
      const data = await apiGet(
        `/api/tree?conversationId=${encodeURIComponent(queryConv)}&includeRecent=false`
      );
      const tree = data.tree;
      state.treeData = tree;

      if (tree && !state.hostConversationId) {
        state.hostConversationId = tree.targetConversationId || '';
      }
      if (tree && !state.inspectedConversationId) {
        state.inspectedConversationId = tree.targetConversationId || '';
      }

      if (tree) {
        const validIds = new Set((tree.nodes || []).map((n) => n.conversationId));
        if (resetSelection || !state.selectedNodeId || !validIds.has(state.selectedNodeId)) {
          state.selectedNodeId = tree.targetConversationId || tree.rootConversationId || '';
        }
      }

      renderAll();
      await loadDivergence(state.selectedNodeId);
    } catch (err) {
      console.error('Failed to load fork tree:', err);
    } finally {
      state.loadingTree = false;
    }
  }

  async function loadDivergence(nodeId, explicitParentId = null, explicitForkStep = null) {
    if (!nodeId && !explicitParentId) return;
    state.loadingDivergence = true;
    try {
      const params = new URLSearchParams();
      if (nodeId) params.set('conversationId', nodeId);
      if (explicitParentId) params.set('parentId', explicitParentId);
      if (explicitForkStep !== null && explicitForkStep !== undefined) {
        params.set('forkAtStepIndex', String(explicitForkStep));
      }
      if (state.isForestMode || state.userForksOnly) {
        params.set('userForksOnly', 'true');
      }
      const data = await apiGet(`/api/divergence?${params.toString()}`);
      state.divergenceData = data.divergence;
      renderDivergencePanel();
    } catch (err) {
      console.error('Failed to load divergence diff:', err);
    } finally {
      state.loadingDivergence = false;
    }
  }

  function renderAll() {
    renderHeaderAndMetrics();
    if (state.isForestMode) {
      renderProjectFilterOptions();
      renderForestOverview();
    } else {
      renderLineageBreadcrumbs();
      renderTreeHierarchy();
    }
  }

  function renderHeaderAndMetrics() {
    const titleEl = document.getElementById('headerTitle');
    const subEl = document.getElementById('headerSubtitle');
    const label1El = document.getElementById('metricLabel1');
    const label2El = document.getElementById('metricLabel2');
    const label3El = document.getElementById('metricLabel3');
    const label4El = document.getElementById('metricLabel4');
    const branchesEl = document.getElementById('metricBranches');
    const depthEl = document.getElementById('metricDepth');
    const splitEl = document.getElementById('metricSplit');
    const fpEl = document.getElementById('metricForkPoints');

    if (state.isForestMode) {
      const forest = state.forestData;
      titleEl.textContent = 'Session Fork Forest';
      if (label1El) {
        label1El.textContent = state.includeZeroFork ? 'Session Trees' : 'Forked Trees';
      }
      if (label2El) label2El.textContent = 'Total Sessions';
      if (label3El) label3El.textContent = 'Split Points';
      if (label4El) {
        label4El.textContent = state.includeZeroFork ? 'Projects' : 'Projects with Forks';
      }

      if (!forest) {
        subEl.textContent = 'Loading global fork forest across workspaces…';
        return;
      }

      const projCount = (forest.projects || []).length;
      const forkedCount = forest.forkedTreeCount ?? forest.totalTrees;
      const zeroForkCount = forest.zeroForkTreeCount ?? 0;

      subEl.innerHTML = state.includeZeroFork
        ? `
          <span><strong>${forkedCount}</strong> forked, <strong>${zeroForkCount}</strong> zero-fork</span>
          <span>•</span>
          <span><strong>${forest.totalBranches}</strong> sessions across <strong>${projCount}</strong> ${
            projCount === 1 ? 'project' : 'projects'
          }</span>
        `
        : `
          <span><strong>${forest.totalTrees}</strong> forked ${
            forest.totalTrees === 1 ? 'tree' : 'trees'
          }</span>
          <span>•</span>
          <span><strong>${forest.totalBranches}</strong> sessions across <strong>${projCount}</strong> ${
            projCount === 1 ? 'project' : 'projects'
          }</span>
        `;

      branchesEl.innerHTML = state.includeZeroFork
        ? `${forest.totalTrees} <span class="metric-sub">${forkedCount} forked / ${zeroForkCount} zero-fork</span>`
        : `${forest.totalTrees} <span class="metric-sub">${
            forest.totalTrees === 1 ? 'forked tree' : 'forked trees'
          }</span>`;
      depthEl.innerHTML = `${forest.totalBranches} <span class="metric-sub">sessions in forest</span>`;
      splitEl.innerHTML = `${forest.totalForkPoints} <span class="metric-sub">${
        forest.totalForkPoints === 1 ? 'branch point' : 'branch points'
      }</span>`;
      fpEl.innerHTML = `${projCount} <span class="metric-sub">${
        projCount === 1 ? 'project' : 'projects'
      }</span>`;
      return;
    }

    const tree = state.treeData;
    if (!tree || !tree.root) {
      titleEl.textContent = 'Session Fork Hierarchy';
      subEl.textContent = 'No conversation records found.';
      return;
    }

    const currentNode =
      (tree.nodes || []).find((n) => n.conversationId === tree.targetConversationId) ||
      tree.root;

    titleEl.textContent = currentNode.title || 'Session Fork Hierarchy';
    subEl.innerHTML = `
      <span class="mono-id" title="Active / Inspected Conversation ID">${escapeHtml(
        currentNode.conversationId.slice(0, 8)
      )}</span>
      <span>•</span>
      <span>${escapeHtml(currentNode.projectName || 'Outside of Project')}</span>
      ${
        currentNode.workspaceNames?.length
          ? `<span>•</span><span class="badge badge-workspace">${escapeHtml(
              currentNode.workspaceNames.join(', ')
            )}</span>`
          : ''
      }
    `;

    branchesEl.innerHTML = `${tree.totalNodes} <span class="metric-sub">${
      tree.totalNodes === 1 ? 'standalone' : 'in family'
    }</span>`;
    depthEl.innerHTML = `${tree.maxDepth} <span class="metric-sub">${
      tree.maxDepth === 0 ? 'root only' : tree.maxDepth === 1 ? 'generation' : 'generations'
    }</span>`;

    if (currentNode.forkFrom) {
      splitEl.innerHTML = `@ #${currentNode.forkFrom.forkAtStepIndex} <span class="metric-sub">+${currentNode.divergedSteps} new / ${currentNode.sharedSteps} shared</span>`;
    } else {
      splitEl.innerHTML = `Root <span class="metric-sub">${currentNode.stepCount} total steps</span>`;
    }

    const fpCount = (tree.forkPoints || []).length;
    fpEl.innerHTML = `${fpCount} <span class="metric-sub">${
      fpCount === 1 ? 'branch point' : 'branch points'
    }</span>`;
  }

  function renderLineageBreadcrumbs() {
    const tree = state.treeData;
    const container = document.getElementById('lineageCrumbs');
    if (!container) return;
    if (!tree || !tree.nodes) {
      container.innerHTML = '';
      return;
    }

    const nodesById = new Map(tree.nodes.map((n) => [n.conversationId, n]));
    const chain = tree.activeLineageChain || [];

    const htmlParts = [];
    chain.forEach((convId, idx) => {
      const node = nodesById.get(convId);
      if (!node) return;
      if (idx > 0) {
        const forkStep = node.forkFrom?.forkAtStepIndex;
        htmlParts.push(
          `<span class="crumb-arrow">${
            forkStep !== undefined && forkStep >= 0 ? `@#${forkStep} →` : '→'
          }</span>`
        );
      }
      htmlParts.push(`
        <button
          type="button"
          class="crumb-chip ${node.isCurrent ? 'is-current' : ''}"
          data-select-node="${escapeHtml(node.conversationId)}"
          title="${escapeHtml(node.title)} (${escapeHtml(node.conversationId)})"
        >
          <span class="status-dot ${escapeHtml(node.status)}"></span>
          <span class="crumb-title">${escapeHtml(node.title)}</span>
          <span class="mono-id">${escapeHtml(node.conversationId.slice(0, 6))}</span>
        </button>
      `);
    });

    container.innerHTML = htmlParts.join('');
    container.querySelectorAll('[data-select-node]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-select-node');
        selectNode(id);
      });
    });
  }

  function renderProjectFilterOptions() {
    const selectEl = document.getElementById('projectFilterSelect');
    if (!selectEl) return;
    const projects = state.forestData?.projects || [];
    const totalTrees = state.forestData?.totalTrees || 0;
    const opts = [
      `<option value="">All Projects (${totalTrees})</option>`,
      ...projects.map(
        (p) =>
          `<option value="${escapeHtml(p.projectName)}" ${
            state.projectFilter === p.projectName ? 'selected' : ''
          }>${escapeHtml(p.projectName)} (${p.treeCount})</option>`
      ),
    ];
    selectEl.innerHTML = opts.join('');
  }

  function treeMatchesForestFilter(tree, query, projectFilter) {
    if (projectFilter && (tree.projectName || '') !== projectFilter) {
      return false;
    }
    if (!query) return true;
    const q = query.toLowerCase();
    if ((tree.rootTitle || '').toLowerCase().includes(q)) return true;
    if ((tree.projectName || '').toLowerCase().includes(q)) return true;
    if ((tree.workspaceNames || []).some((w) => w.toLowerCase().includes(q))) return true;
    for (const node of tree.nodes || []) {
      if ((node.title || '').toLowerCase().includes(q)) return true;
      if ((node.conversationId || '').toLowerCase().includes(q)) return true;
      if ((node.firstDivergedPrompt || '').toLowerCase().includes(q)) return true;
    }
    return false;
  }

  function renderForestBranchSubtree(node, treeRootId) {
    if (!node) return '';
    const refLabel = node.forkFrom?.referenceLabel || '';
    // Side questions and subagent forks are strictly hidden in the Global Forest view
    if (refLabel === 'SIDE_QUESTION' || refLabel === 'SUBAGENT_FORK') return '';

    const childrenHtml = (node.children || [])
      .map((child) => renderForestBranchSubtree(child, treeRootId))
      .filter(Boolean)
      .join('');

    const isSelected = node.conversationId === state.selectedNodeId;
    const badges = [];
    if (node.isRoot) {
      badges.push(`<span class="badge badge-root">ROOT</span>`);
      badges.push(`<span class="badge badge-ref-type">${node.stepCount} steps</span>`);
    } else if (node.forkFrom) {
      if (node.forkFrom.forkAtStepIndex >= 0) {
        badges.push(
          `<span class="badge badge-fork-step" title="Branched at step #${node.forkFrom.forkAtStepIndex}">@ step #${node.forkFrom.forkAtStepIndex}</span>`
        );
      }
      badges.push(
        `<span class="badge badge-ref-type">+${node.divergedSteps} steps</span>`
      );
      if (refLabel && refLabel !== 'FORK') {
        badges.push(`<span class="badge badge-ref-type">${escapeHtml(refLabel)}</span>`);
      }
    }

    const promptSnippet =
      !node.isRoot &&
      node.firstDivergedPrompt &&
      node.firstDivergedPrompt !== node.title
        ? `<div class="forest-prompt-snippet" title="${escapeHtml(
            node.firstDivergedPrompt
          )}">↳ "${escapeHtml(node.firstDivergedPrompt)}"</div>`
        : '';

    return `
      <div class="forest-branch-group">
        <div
          class="forest-branch-row ${isSelected ? 'is-selected' : ''}"
          data-forest-node="${escapeHtml(node.conversationId)}"
          data-forest-root="${escapeHtml(treeRootId)}"
        >
          <div class="forest-branch-main">
            <div class="forest-branch-top">
              <span class="status-dot ${escapeHtml(node.status)}" title="Status: ${escapeHtml(
                node.status
              )}"></span>
              <span class="forest-branch-title">${escapeHtml(node.title)}</span>
              <span class="mono-id">${escapeHtml(node.conversationId.slice(0, 8))}</span>
              ${badges.join('')}
            </div>
            ${promptSnippet}
          </div>
          <div class="forest-branch-actions">
            <button
              type="button"
              class="btn btn-xs btn-primary"
              data-forest-switch="${escapeHtml(node.conversationId)}"
              title="Switch chat view to this session"
            >
              Open
            </button>
          </div>
        </div>
        ${
          childrenHtml
            ? `<div class="forest-branch-children">${childrenHtml}</div>`
            : ''
        }
      </div>
    `;
  }

  function renderForestOverview() {
    const container = document.getElementById('forestContainer');
    const countBadge = document.getElementById('forestCountBadge');
    if (!container || !countBadge) return;

    const trees = state.forestData?.trees || [];
    const filteredTrees = trees.filter((t) =>
      treeMatchesForestFilter(t, state.filterQuery, state.projectFilter)
    );

    countBadge.textContent =
      filteredTrees.length < trees.length
        ? `${filteredTrees.length} / ${trees.length} trees`
        : `${trees.length} ${trees.length === 1 ? 'tree' : 'trees'}`;

    if (filteredTrees.length === 0) {
      container.innerHTML = `<div class="empty-state">No forked session trees match the current filter.</div>`;
      return;
    }

    container.innerHTML = filteredTrees
      .map((tree) => {
        const isCollapsed = state.collapsedTreeIds.has(tree.rootConversationId);
        const isSelectedTree = tree.rootConversationId === state.selectedTreeRootId;
        const wsBadges = (tree.workspaceNames || [])
          .slice(0, 2)
          .map((w) => `<span class="badge badge-workspace">📁 ${escapeHtml(w)}</span>`)
          .join('');
        const bodyHtml = renderForestBranchSubtree(tree.root, tree.rootConversationId);
        const treeCountBadges =
          tree.totalNodes > 1
            ? `<span class="badge badge-fork-step">${tree.totalNodes} branches</span>
               <span class="badge badge-ref-type">${tree.forkPointCount} ${
                 tree.forkPointCount === 1 ? 'split' : 'splits'
               }</span>`
            : `<span class="badge badge-ref-type">0 forks</span>`;

        return `
          <div
            class="forest-tree-card ${isCollapsed ? 'is-collapsed' : ''} ${
              isSelectedTree ? 'is-selected-tree' : ''
            }"
            data-tree-card="${escapeHtml(tree.rootConversationId)}"
          >
            <div class="forest-tree-header" data-toggle-tree="${escapeHtml(
              tree.rootConversationId
            )}">
              <div class="forest-tree-header-left">
                <span class="forest-chevron">${isCollapsed ? '▸' : '▾'}</span>
                <span class="forest-tree-title" title="${escapeHtml(tree.rootTitle)}">${escapeHtml(
                  tree.rootTitle
                )}</span>
                ${treeCountBadges}
                <span class="badge badge-ref-type">${escapeHtml(tree.projectName)}</span>
                ${wsBadges}
              </div>
              <div class="forest-tree-header-right">
                <span style="font-size:11px;color:var(--muted-foreground);">${escapeHtml(
                  formatRelativeTime(tree.latestModifiedTime)
                )}</span>
                <button
                  type="button"
                  class="btn btn-xs"
                  data-forest-switch="${escapeHtml(tree.rootConversationId)}"
                  title="Open root session"
                >
                  Open Root
                </button>
              </div>
            </div>
            <div class="forest-tree-body">
              ${bodyHtml}
            </div>
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('[data-toggle-tree]').forEach((hdr) => {
      hdr.addEventListener('click', (e) => {
        const switchBtn = e.target.closest('[data-forest-switch]');
        if (switchBtn) {
          e.stopPropagation();
          switchHostConversation(switchBtn.getAttribute('data-forest-switch'));
          return;
        }
        const rootId = hdr.getAttribute('data-toggle-tree');
        if (!rootId) return;
        if (state.collapsedTreeIds.has(rootId)) {
          state.collapsedTreeIds.delete(rootId);
        } else {
          state.collapsedTreeIds.add(rootId);
        }
        renderForestOverview();
      });
    });

    container.querySelectorAll('[data-forest-node]').forEach((row) => {
      row.addEventListener('click', (e) => {
        const switchBtn = e.target.closest('[data-forest-switch]');
        if (switchBtn) {
          e.stopPropagation();
          switchHostConversation(switchBtn.getAttribute('data-forest-switch'));
          return;
        }
        const convId = row.getAttribute('data-forest-node');
        const rootId = row.getAttribute('data-forest-root');
        if (rootId) state.selectedTreeRootId = rootId;
        if (convId) {
          state.selectedNodeId = convId;
          renderForestOverview();
          loadDivergence(convId);
        }
      });
    });
  }

  function matchesFilter(node, query) {
    if (state.userForksOnly && !node.isRoot && !node.isCurrent && !node.isOnActivePath) {
      const refLabel = node.forkFrom?.referenceLabel || '';
      if (refLabel === 'SIDE_QUESTION' || refLabel === 'SUBAGENT_FORK') {
        return false;
      }
    }
    if (!query) return true;
    const q = query.toLowerCase();
    if ((node.title || '').toLowerCase().includes(q)) return true;
    if ((node.conversationId || '').toLowerCase().includes(q)) return true;
    if ((node.projectName || '').toLowerCase().includes(q)) return true;
    if ((node.workspaceNames || []).some((w) => w.toLowerCase().includes(q))) return true;
    if (
      node.forkFrom &&
      `step #${node.forkFrom.forkAtStepIndex}`.toLowerCase().includes(q)
    ) {
      return true;
    }
    return false;
  }

  function renderNodeSubtree(node, query) {
    const childHtmlList = (node.children || [])
      .map((child) => renderNodeSubtree(child, query))
      .filter(Boolean);

    const selfMatches = matchesFilter(node, query);
    if (!selfMatches && childHtmlList.length === 0) {
      return '';
    }

    const isSelected = node.conversationId === state.selectedNodeId;
    const total = Math.max(1, node.stepCount || 1);
    const sharedPct = Math.min(100, Math.round(((node.sharedSteps || 0) / total) * 100));
    const divergedPct = Math.max(0, 100 - sharedPct);

    const badges = [];
    if (node.isCurrent) {
      badges.push(`<span class="badge badge-current">CURRENT</span>`);
    }
    if (node.isRoot) {
      badges.push(`<span class="badge badge-root">ROOT</span>`);
    } else if (node.isAncestorOfCurrent) {
      badges.push(`<span class="badge badge-ancestor">ANCESTOR</span>`);
    } else if (node.isSiblingOfCurrent) {
      badges.push(`<span class="badge badge-sibling">SIBLING</span>`);
    }

    if (node.forkFrom) {
      if (node.forkFrom.forkAtStepIndex >= 0) {
        badges.push(
          `<span class="badge badge-fork-step" title="Forked from parent at step #${
            node.forkFrom.forkAtStepIndex
          } (${node.sharedSteps} shared steps)">@ step #${
            node.forkFrom.forkAtStepIndex
          }</span>`
        );
      }
      badges.push(
        `<span class="badge badge-ref-type">${escapeHtml(
          node.forkFrom.referenceLabel
        )}</span>`
      );
    }

    for (const ws of (node.workspaceNames || []).slice(0, 2)) {
      badges.push(`<span class="badge badge-workspace">📁 ${escapeHtml(ws)}</span>`);
    }

    const isSideQuestionNode = node.forkFrom?.referenceLabel === 'SIDE_QUESTION';
    const switchTargetId =
      isSideQuestionNode && node.forkFrom?.parentConversationId
        ? node.forkFrom.parentConversationId
        : node.conversationId;
    const switchTitle = isSideQuestionNode
      ? 'Side questions are inline; switch to parent session'
      : 'Switch chat view to this session';
    const switchLabel = isSideQuestionNode ? 'Parent' : 'Switch';

    return `
      <div class="tree-branch-group">
        <div
          class="tree-node-card ${isSelected ? 'is-selected' : ''} ${
            node.isCurrent ? 'is-current' : ''
          } ${node.isOnActivePath ? 'is-on-path' : ''}"
          data-node-card="${escapeHtml(node.conversationId)}"
        >
          <div class="node-top-row">
            <div class="node-title-wrap">
              <span class="status-dot ${escapeHtml(node.status)}" title="Status: ${escapeHtml(
                node.status
              )}"></span>
              <span class="node-title">${escapeHtml(node.title)}</span>
              ${badges.join('')}
            </div>
            <div class="node-actions">
              <button
                type="button"
                class="btn btn-xs"
                data-action="diff"
                data-conv-id="${escapeHtml(node.conversationId)}"
                title="Inspect fork point and post-fork divergence"
              >
                Diff
              </button>
              <button
                type="button"
                class="btn btn-xs"
                data-action="copy"
                data-conv-id="${escapeHtml(node.conversationId)}"
                title="Copy full conversation UUID"
              >
                Copy ID
              </button>
              <button
                type="button"
                class="btn btn-xs btn-primary"
                data-action="switch"
                data-conv-id="${escapeHtml(switchTargetId)}"
                title="${escapeHtml(switchTitle)}"
              >
                ${escapeHtml(switchLabel)}
              </button>
            </div>
          </div>

          <div class="step-bar-wrap">
            <div class="step-bar-track" title="${node.sharedSteps} shared steps, +${
              node.divergedSteps
            } diverged steps (${node.stepCount} total)">
              <div class="step-bar-shared" style="width:${sharedPct}%"></div>
              <div class="step-bar-diverged" style="width:${divergedPct}%"></div>
            </div>
            <div class="step-bar-legend">
              ${
                node.forkFrom && node.forkFrom.forkAtStepIndex >= 0
                  ? `${node.sharedSteps} shared • <strong>+${node.divergedSteps} new</strong> (${node.stepCount} steps)`
                  : `<strong>${node.stepCount} steps</strong> (origin)`
              }
            </div>
          </div>

          <div class="node-meta-row">
            <div class="node-meta-left">
              <span class="mono-id">${escapeHtml(node.conversationId.slice(0, 8))}</span>
              <span>${escapeHtml(node.projectName || 'Outside of Project')}</span>
              ${
                childHtmlList.length > 0
                  ? `<span>• ${childHtmlList.length} ${
                      childHtmlList.length === 1 ? 'child fork' : 'child forks'
                    }</span>`
                  : ''
              }
            </div>
            <div class="node-meta-right">
              <span>${escapeHtml(formatRelativeTime(node.lastModifiedTime))}</span>
            </div>
          </div>
        </div>
        ${
          childHtmlList.length > 0
            ? `<div class="tree-children">${childHtmlList.join('')}</div>`
            : ''
        }
      </div>
    `;
  }

  function renderTreeHierarchy() {
    const tree = state.treeData;
    const container = document.getElementById('treeContainer');
    const countBadge = document.getElementById('treeCountBadge');

    if (!tree || !tree.root) {
      countBadge.textContent = '0 sessions';
      container.innerHTML = `<div class="empty-state">No fork tree available.</div>`;
      return;
    }

    const html = renderNodeSubtree(tree.root, state.filterQuery);
    if (!html) {
      countBadge.textContent = `0 / ${tree.totalNodes} sessions`;
      container.innerHTML = `<div class="empty-state">No branches match filter "${escapeHtml(
        state.filterQuery
      )}".</div>`;
      return;
    }

    container.innerHTML = html;
    const visibleCount = container.querySelectorAll('[data-node-card]').length;
    countBadge.textContent =
      visibleCount < tree.totalNodes
        ? `${visibleCount} / ${tree.totalNodes} sessions`
        : `${tree.totalNodes} ${tree.totalNodes === 1 ? 'session' : 'sessions'}`;

    // Attach node click handlers
    container.querySelectorAll('[data-node-card]').forEach((card) => {
      card.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('[data-action]');
        const convId = card.getAttribute('data-node-card');
        if (actionBtn) {
          e.stopPropagation();
          const action = actionBtn.getAttribute('data-action');
          const targetId = actionBtn.getAttribute('data-conv-id') || convId;
          if (action === 'switch') {
            switchHostConversation(targetId);
          } else if (action === 'copy') {
            copyText(targetId, `Copied ${targetId}`);
          } else if (action === 'diff') {
            selectNode(targetId, true);
          }
          return;
        }
        selectNode(convId, false);
      });
    });
  }

  function selectNode(conversationId, scrollToDiff = false) {
    if (!conversationId) return;
    state.selectedNodeId = conversationId;
    renderTreeHierarchy();
    loadDivergence(conversationId).then(() => {
      if (scrollToDiff) {
        document
          .getElementById('divergencePanel')
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  function renderDivergencePanel() {
    const diff = state.divergenceData;
    const badgeEl = document.getElementById('diffStepBadge');
    const bodyEl = document.getElementById('divergenceBody');

    if (!diff || !diff.hasForkPoint || !diff.forkPoint) {
      badgeEl.textContent = 'No Fork Split';
      bodyEl.innerHTML = `
        <div class="empty-state">
          ${escapeHtml(
            diff?.message ||
              'This session is a standalone root conversation with no parent or child forks yet. Select any forked tree below to preview branch divergence!'
          )}
        </div>
      `;
      return;
    }

    const fp = diff.forkPoint;
    badgeEl.textContent = `@ step #${fp.forkAtStepIndex} (${fp.sharedStepCount} shared steps)`;

    const sharedUserHtml = fp.lastSharedUserPrompt
      ? `
        <div class="context-box">
          <div class="context-box-label">
            <span>Last Shared User Prompt (Step #${fp.lastSharedUserPrompt.stepIndex})</span>
            <span>${escapeHtml(formatRelativeTime(fp.lastSharedUserPrompt.createdAt))}</span>
          </div>
          <div class="context-box-text">${escapeHtml(fp.lastSharedUserPrompt.preview)}</div>
        </div>
      `
      : `
        <div class="context-box">
          <div class="context-box-label"><span>Last Shared User Prompt</span></div>
          <div class="context-box-text" style="color:var(--muted-foreground);">No user prompt recorded at or before step #${fp.forkAtStepIndex}.</div>
        </div>
      `;

    const sharedAssistantHtml = fp.lastSharedAssistantResponse
      ? `
        <div class="context-box">
          <div class="context-box-label">
            <span>Last Shared Assistant Response (Step #${fp.lastSharedAssistantResponse.stepIndex})</span>
            <span>${escapeHtml(formatRelativeTime(fp.lastSharedAssistantResponse.createdAt))}</span>
          </div>
          <div class="context-box-text">${escapeHtml(
            fp.lastSharedAssistantResponse.preview || '(Tool call execution step)'
          )}</div>
        </div>
      `
      : `
        <div class="context-box">
          <div class="context-box-label"><span>Last Shared Assistant Response</span></div>
          <div class="context-box-text" style="color:var(--muted-foreground);">No assistant response recorded at or before step #${fp.forkAtStepIndex}.</div>
        </div>
      `;

    const allBranches = diff.branches || [];
    const visibleBranches = state.isForestMode
      ? allBranches.filter(
          (b) =>
            b.referenceLabel !== 'SIDE_QUESTION' &&
            b.referenceLabel !== 'SUBAGENT_FORK'
        )
      : (() => {
          const hasUserForkChild = allBranches.some(
            (b) =>
              b.branchType !== 'PARENT_CONTINUATION' &&
              b.referenceLabel !== 'SIDE_QUESTION' &&
              b.referenceLabel !== 'SUBAGENT_FORK'
          );
          return state.userForksOnly && hasUserForkChild
            ? allBranches.filter(
                (b) =>
                  b.branchType === 'PARENT_CONTINUATION' ||
                  b.isCurrent ||
                  b.isSelected ||
                  (b.referenceLabel !== 'SIDE_QUESTION' &&
                    b.referenceLabel !== 'SUBAGENT_FORK')
              )
            : allBranches;
        })();

    const branchCardsHtml = visibleBranches
      .map((b) => {
        const isOrigin = b.branchType === 'PARENT_CONTINUATION';
        const firstPromptHtml = b.firstDivergedUserPrompt
          ? `
            <div class="context-box">
              <div class="context-box-label">
                <span>First Diverged User Prompt (Step #${b.firstDivergedUserPrompt.stepIndex})</span>
                <span>${escapeHtml(formatRelativeTime(b.firstDivergedUserPrompt.createdAt))}</span>
              </div>
              <div class="context-box-text">${escapeHtml(b.firstDivergedUserPrompt.preview)}</div>
            </div>
          `
          : `
            <div class="context-box">
              <div class="context-box-label"><span>First Diverged User Prompt</span></div>
              <div class="context-box-text" style="color:var(--muted-foreground);">No new user prompts after step #${b.forkAtStepIndex}.</div>
            </div>
          `;

        const latestRespHtml = b.latestAssistantResponse
          ? `
            <div class="context-box">
              <div class="context-box-label">
                <span>Latest Assistant Outcome (Step #${b.latestAssistantResponse.stepIndex})</span>
                <span>${escapeHtml(formatRelativeTime(b.latestAssistantResponse.createdAt))}</span>
              </div>
              <div class="context-box-text">${escapeHtml(b.latestAssistantResponse.preview)}</div>
            </div>
          `
          : `
            <div class="context-box">
              <div class="context-box-label"><span>Latest Assistant Outcome</span></div>
              <div class="context-box-text" style="color:var(--muted-foreground);">No post-fork assistant text response yet.</div>
            </div>
          `;

        const toolsHtml =
          b.postForkToolSummary && b.postForkToolSummary.length > 0
            ? `
              <div class="tool-pills-wrap">
                ${b.postForkToolSummary
                  .slice(0, 6)
                  .map(
                    (t) =>
                      `<span class="tool-pill">${escapeHtml(t.name)} ×${t.count}</span>`
                  )
                  .join('')}
              </div>
            `
            : '';

        const turnsHtml =
          b.postForkTurns && b.postForkTurns.length > 0
            ? `
              <details class="turns-details">
                <summary>View ${b.postForkTurns.length} post-fork conversational ${
                  b.postForkTurns.length === 1 ? 'turn' : 'turns'
                }</summary>
                <div class="turn-list">
                  ${b.postForkTurns
                    .map((t) => {
                      const u = t.userPrompt
                        ? `<div class="turn-item-user">[#${t.userPrompt.stepIndex}] User: ${escapeHtml(
                            t.userPrompt.preview
                          )}</div>`
                        : '';
                      const lastA =
                        t.assistantResponses && t.assistantResponses.length > 0
                          ? t.assistantResponses[t.assistantResponses.length - 1]
                          : null;
                      const a = lastA
                        ? `<div class="turn-item-assistant">[#${lastA.stepIndex}] Agent: ${escapeHtml(
                            lastA.preview
                          )}</div>`
                        : '';
                      const tools =
                        t.toolCalls && t.toolCalls.length > 0
                          ? `<div style="margin-top:3px;font-size:10.5px;color:var(--muted-foreground);">Tools: ${escapeHtml(
                              t.toolCalls.join(', ')
                            )}</div>`
                          : '';
                      return `<div class="turn-item">${u}${a}${tools}</div>`;
                    })
                    .join('')}
                </div>
              </details>
            `
            : '';

        return `
          <div class="branch-diff-card ${b.isCurrent ? 'is-current' : ''}">
            <div class="branch-card-header">
              <div class="branch-card-title">
                <span class="badge ${isOrigin ? 'badge-root' : 'badge-fork-step'}">
                  ${isOrigin ? 'PARENT CONTINUATION' : `FORK @ #${b.forkAtStepIndex}`}
                </span>
                ${b.isCurrent ? '<span class="badge badge-current">CURRENT</span>' : ''}
                <span>${escapeHtml(b.title)}</span>
              </div>
              <button
                type="button"
                class="btn btn-xs btn-primary"
                data-switch-branch="${escapeHtml(
                  b.referenceLabel === 'SIDE_QUESTION' ? fp.parentConversationId : b.conversationId
                )}"
                title="${escapeHtml(
                  b.referenceLabel === 'SIDE_QUESTION'
                    ? 'Side questions are inline; switch to parent session'
                    : 'Switch chat view to this session'
                )}"
              >
                ${b.referenceLabel === 'SIDE_QUESTION' ? 'Parent' : 'Switch'}
              </button>
            </div>

            <div class="branch-stats-row">
              <span class="mono-id">${escapeHtml(b.conversationId.slice(0, 8))}</span>
              <span>•</span>
              <span><strong>+${b.divergedStepCount}</strong> steps after split</span>
              <span>•</span>
              <span><strong>${b.userTurnCountAfterFork}</strong> user turns</span>
              <span>•</span>
              <span><strong>${b.toolCallCountAfterFork}</strong> tool calls</span>
            </div>

            ${firstPromptHtml}
            ${latestRespHtml}
            ${toolsHtml}
            ${turnsHtml}
          </div>
        `;
      })
      .join('');

    bodyEl.innerHTML = `
      <div class="fork-point-banner">
        <div class="fork-point-header">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="badge badge-root">SHARED FORK POINT</span>
            <strong>${escapeHtml(fp.parentTitle)}</strong>
            <span class="mono-id">${escapeHtml(fp.parentConversationId.slice(0, 8))}</span>
            <span class="badge badge-fork-step">Branched @ Step #${fp.forkAtStepIndex}</span>
          </div>
          <span style="font-size:11.5px;color:var(--muted-foreground);">
            Steps 0–${fp.forkAtStepIndex} (${fp.sharedStepCount} steps) are identical across these branches
          </span>
        </div>
        <div class="fork-point-grid">
          ${sharedUserHtml}
          ${sharedAssistantHtml}
        </div>
      </div>

      <div class="branches-diff-grid">
        ${branchCardsHtml}
      </div>
    `;

    bodyEl.querySelectorAll('[data-switch-branch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchHostConversation(btn.getAttribute('data-switch-branch'));
      });
    });
  }

  // Wire up toolbar controls
  document.getElementById('filterInput')?.addEventListener('input', (e) => {
    state.filterQuery = e.target.value || '';
    if (state.isForestMode) {
      renderForestOverview();
    } else {
      renderTreeHierarchy();
    }
  });

  document.getElementById('projectFilterSelect')?.addEventListener('change', (e) => {
    state.projectFilter = e.target.value || '';
    renderForestOverview();
  });

  document.getElementById('btnIncludeZeroFork')?.addEventListener('click', (e) => {
    state.includeZeroFork = !state.includeZeroFork;
    e.currentTarget.classList.toggle('btn-active', state.includeZeroFork);
    loadTree(false);
    showToast(
      state.includeZeroFork
        ? 'Including zero-fork sessions'
        : 'Showing forked trees only'
    );
  });

  document.getElementById('btnToggleCollapseAll')?.addEventListener('click', (e) => {
    const trees = state.forestData?.trees || [];
    state.allCollapsed = !state.allCollapsed;
    if (state.allCollapsed) {
      trees.forEach((t) => state.collapsedTreeIds.add(t.rootConversationId));
      e.currentTarget.textContent = 'Expand All';
    } else {
      state.collapsedTreeIds.clear();
      e.currentTarget.textContent = 'Collapse All';
    }
    renderForestOverview();
  });

  document.getElementById('btnAutoRefresh')?.addEventListener('click', (e) => {
    state.autoRefresh = !state.autoRefresh;
    e.currentTarget.classList.toggle('btn-active', state.autoRefresh);
    showToast(state.autoRefresh ? 'Auto-refresh enabled (5s)' : 'Auto-refresh paused');
  });

  document.getElementById('btnRefresh')?.addEventListener('click', () => {
    loadTree(false);
    showToast(
      state.isForestMode
        ? 'Refreshed session fork forest'
        : 'Refreshed session fork hierarchy'
    );
  });

  function setUserForksMode(userForksOnly) {
    state.userForksOnly = Boolean(userForksOnly);
    document
      .getElementById('btnFilterUserForks')
      ?.classList.toggle('btn-active', state.userForksOnly);
    document
      .getElementById('btnExpandAll')
      ?.classList.toggle('btn-active', !state.userForksOnly);
    renderTreeHierarchy();
    if (state.selectedNodeId) {
      loadDivergence(state.selectedNodeId);
    } else {
      renderDivergencePanel();
    }
  }

  document.getElementById('btnFilterUserForks')?.addEventListener('click', () => {
    if (!state.userForksOnly) {
      setUserForksMode(true);
    }
  });

  document.getElementById('btnExpandAll')?.addEventListener('click', () => {
    if (state.userForksOnly) {
      setUserForksMode(false);
    }
  });

  // Configure initial layout for Global Forest Mode vs Per-Session AuxPane Mode
  if (state.isForestMode) {
    document.getElementById('workspaceContainer')?.classList.add('is-forest-mode');
    const forestSection = document.getElementById('forestSection');
    const singleTreeSection = document.getElementById('singleTreeSection');
    const lineageBar = document.getElementById('lineageBar');
    const projSelect = document.getElementById('projectFilterSelect');
    const zeroForkBtn = document.getElementById('btnIncludeZeroFork');
    const collapseBtn = document.getElementById('btnToggleCollapseAll');
    const filterInput = document.getElementById('filterInput');
    if (forestSection) forestSection.style.display = '';
    if (singleTreeSection) singleTreeSection.style.display = 'none';
    if (lineageBar) lineageBar.style.display = 'none';
    if (projSelect) projSelect.style.display = '';
    if (zeroForkBtn) zeroForkBtn.style.display = '';
    if (collapseBtn) collapseBtn.style.display = '';
    if (filterInput) {
      filterInput.placeholder = 'Filter trees, branches, prompts, projects…';
    }
  }

  // Initial load + 5s live refresh loop
  loadTree(true);
  setInterval(() => {
    if (state.autoRefresh && ! document.hidden) {
      loadTree(false);
    }
  }, 5000);
})();
