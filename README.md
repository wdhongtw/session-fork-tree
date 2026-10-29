# Session Fork Tree (`session-fork-tree`)

Interactive UI plugin and MCP toolset (`fork_*`) that visualizes the chat
session fork hierarchy for the active conversation, inspects exact fork points
(`@ step #N`), compares post-fork divergence across sibling branches
side-by-side, and switches between branches in one click.

## Features

- **Per-Session Fork Hierarchy Tree (`SIDECAR_UI_ENTRYPOINT_AUX_PANE`)**:
  - Scoped to the active conversation's single fork tree
    (`?conversationId=<id>`).
  - Discovers the full connected fork family (root origin session, ancestor
    chain, sibling forks, and child/descendant forks) directly from trajectory
    SQLite stores (`conversations/*.db` `parent_references` and
    `conversation_summaries.db`) and live Language Server state.
  - Displays `@ step #N` fork badges, reference types (`FORK`, `SIDE_QUESTION`,
    `SUBAGENT_FORK`, `BATTLE_MODE`, `THOUGHT_REWRITE`), shared vs. diverged step
    progress bars, workspace/project pills, and live session status.
  - Mutually-exclusive **User Forks Only** / **Show All Branches** mode switch
    (defaulting to **User Forks Only**).
  - **One-Click Session Switching**: Jump directly to any ancestor, sibling, or
    child session via `toggle-conversation` while keeping each session's AuxPane
    bound to its own `CURRENT` marker.
- **Global Session Fork Forest (`SIDECAR_UI_ENTRYPOINT_SIDEBAR`)**:
  - Top-level **Extensions** sidebar view (`/forest`) providing a master-detail
    overview of all user-forked conversation trees across projects and
    workspaces.
  - Strictly shows user-forked trees only (hiding inline side questions
    `SIDE_QUESTION` and subagent forks `SUBAGENT_FORK` completely), with an
    **Include Zero-Fork** toggle (defaulting to Off) to optionally include
    standalone sessions with 0 forks, collapsible tree cards, compact branch
    connectors, first diverged prompt snippets, project filters, and a sticky
    split-point divergence inspector.
- **Fork Point & Divergence Diff Preview**:
  - Shows the **Last Shared User Prompt** and **Last Shared Assistant Response**
    right at `@ step #N`.
  - Compares the **Parent Continuation** (`steps > #N` in the parent session)
    against each **Forked Branch** (`steps > #N` in each child fork), including
    first diverged user prompts, latest assistant outcomes, post-fork tool call
    counts, and expandable turn-by-turn timelines.
- **Agent MCP Tools (`fork_*`)**:
  - `fork_tree_get`: Query the full fork hierarchy tree for a conversation.
  - `fork_divergence_diff`: Compare post-fork prompts, tool calls, and outcomes
    across sibling branches.
  - `fork_branch_inspect`: Inspect turn-by-turn dialogue of any parent, sibling,
    or child branch.
