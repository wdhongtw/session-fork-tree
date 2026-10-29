---
name: session-fork-tree
description: >-
  Inspect, navigate, and compare chat session fork hierarchies, parent-child
  conversation lineages, and diverged branch trajectories. Use when working with
  forked conversations, comparing what sibling or parent session branches tried,
  locating the exact step where a conversation split, or surfacing the
  interactive Session Fork Tree UI panel.
---

# Session Fork Tree

Use the `session-fork-tree` plugin's MCP tools and AuxPane UI sidecar to inspect
chat session fork hierarchies, locate exact branch points (`@ step #N`), and
compare post-fork trajectories across parent, sibling, and child sessions.

## MCP Tools (`fork_*`)

The plugin registers three MCP tools under the `session-fork-tree_fork_tree`
server:

- **`fork_tree_get`**
  - Returns the full fork hierarchy tree (`root`, `nodes`, `activeLineageChain`,
    and `forkPoints`) for a `conversation_id`, plus `recentForkFamilies` across
    workspaces.
  - Omit `conversation_id` to inspect the active conversation automatically, or
    pass an explicit conversation UUID.

- **`fork_divergence_diff`**
  - Inspects the exact fork point (`@ step #N`) where sessions diverged and
    compares post-fork trajectories side-by-side across the **Parent
    Continuation** (`steps > #N` in the parent session) and each **Forked
    Branch** (`steps > #N` in each child fork).
  - Returns `lastSharedUserPrompt` and `lastSharedAssistantResponse` at the fork
    point, followed by each branch's `firstDivergedUserPrompt`,
    `latestAssistantResponse`, `postForkToolSummary`, and turn-by-turn
    breakdown.

- **`fork_branch_inspect`**
  - Reads the turn-by-turn dialogue (`USER_INPUT`, `PLANNER_RESPONSE`, and tool
    call names) for any specific branch (`conversation_id`) within a step range
    (`min_step` to `max_step`).

## Opening the Interactive AuxPane UI

When the user asks to view or explore their session fork tree visually, include
a clickable sidecar link in your response so they can open the **Session Fork
Tree** panel in one click:

```markdown
[Session Fork Tree](sidecar://session-fork-tree/fork_tree/)
```
