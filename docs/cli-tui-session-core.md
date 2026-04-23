# CLI/TUI Session Core Contract

Date: 2026-04-23
Status: Phase 1 implemented (shared approval classification + adapter interface)

## Purpose

All CLI execution modes — TUI, print (interactive/non-interactive), and stdin-stream —
must use one shared session event contract. Different renderers collect input and
format output differently, but the session core decides what to ask and how to
classify the response. This prevents the ask sets and approval logic from
drifting between modes.

## Session Modes

| Mode                    | Entry                                                | Output                        | Approval                        |
| ----------------------- | ---------------------------------------------------- | ----------------------------- | ------------------------------- |
| TUI                     | `render(App)` via Ink                                | React/Ink terminal UI         | React buttons/keyboard          |
| Print (interactive)     | `runNonInteractiveCliSession`                        | `TextSessionSurface` → stdout | `PromptManager` readline        |
| Print (non-interactive) | `runNonInteractiveCliSession`                        | `TextSessionSurface` → stdout | Auto-approve by policy          |
| Stdin-stream            | `runNonInteractiveCliSession` + `runStdinStreamMode` | `JsonEventEmitter` → NDJSON   | External orchestrator via stdin |

All modes share `CliSessionController` → `CliRuntime` → `ExtensionClient`.

## Session Input Events

Events that flow INTO the session core from user/orchestrator action:

| Event         | Source                              | Session method                     |
| ------------- | ----------------------------------- | ---------------------------------- |
| Start task    | Prompt input, stdin `start` command | `controller.startTask(prompt)`     |
| Send message  | User input, stdin `message` command | `controller.sendTaskMessage(text)` |
| Queue message | Additional context while busy       | `controller.queueMessage(text)`    |
| Approve       | Button click, readline, auto-policy | `controller.approve()`             |
| Reject        | Button click, readline, auto-policy | `controller.reject()`              |
| Cancel task   | Ctrl+C, stdin `cancel` command      | `controller.cancelTask()`          |
| Resume task   | Session ID selection                | `controller.showTask(id)`          |

## Session Output Events

Events that flow OUT of the session core to renderers:

| Event             | Emitted by                                | Consumer         |
| ----------------- | ----------------------------------------- | ---------------- |
| `message`         | `CliRuntime.onMessage`                    | All surfaces     |
| `taskCompleted`   | `CliRuntime.onTaskCompleted`              | All surfaces     |
| `error`           | `CliRuntime.onError`                      | All surfaces     |
| `waitingForInput` | `ExtensionClient` (derived from messages) | Approval adapter |

## Ask/Approval Contract

### ApprovalRequest

When the runtime emits `waitingForInput`, the ask is classified into one
normalized request shape:

```typescript
type ApprovalRequestKind = "approve" | "respond" | "retry" | "continue" | "acknowledge"

interface ApprovalRequest {
	kind: ApprovalRequestKind
	ask: ClineAsk
	message: ClineMessage
}
```

Classification rules (from `classifyAsk`):

| Ask type                                                                          | Category     | Request kind                  |
| --------------------------------------------------------------------------------- | ------------ | ----------------------------- |
| `command`, `tool`, `use_mcp_server`                                               | interactive  | `approve`                     |
| `followup`                                                                        | interactive  | `respond`                     |
| `resume_task`                                                                     | resumable    | `continue`                    |
| `completion_result`                                                               | idle         | `acknowledge`                 |
| `api_req_failed`                                                                  | idle         | `retry`                       |
| `mistake_limit_reached`, `resume_completed_task`, `auto_approval_max_req_reached` | idle         | `continue`                    |
| `command_output`                                                                  | non-blocking | (no request — auto-continued) |
| unknown                                                                           | —            | (no request — not classified) |

### ApprovalResponse

```typescript
interface ApprovalResponse {
	response: ClineAskResponse // "yesButtonClicked" | "noButtonClicked" | "messageResponse"
	text?: string
	images?: string[]
}
```

### ApprovalAdapter

Each mode implements this interface:

```typescript
interface ApprovalAdapter {
	handle(request: ApprovalRequest): Promise<ApprovalResponse>
	dispose(): void
}
```

Implementations:

| Adapter                       | Mode                    | Behavior                                                       |
| ----------------------------- | ----------------------- | -------------------------------------------------------------- |
| `AutoApprovalAdapter`         | Print (non-interactive) | Returns `yesButtonClicked` for all; empty string for `respond` |
| `InteractiveApprovalAdapter`  | Print (interactive)     | Prompts via `PromptManager`; fails closed to `noButtonClicked` |
| (future) TUI adapter          | TUI                     | Feeds request to React state; resolves when user clicks        |
| (future) stdin-stream adapter | Stdin-stream            | Sets pending state; resolves when stdin command arrives        |

### Response Dispatch

All modes use one shared function to send the response:

```typescript
function sendApprovalResponse(target, response: ApprovalResponse): void
// yesButtonClicked  → target.approve()
// noButtonClicked   → target.reject()
// messageResponse   → target.sendTaskMessage(text, images)
```

### Passive Ask Routing (stdin-stream)

Stdin-stream uses a passive pattern: it checks whether an incoming message
should be routed as an ask response based on the current agent state.

```typescript
function shouldRouteAsAskResponse(waitingForInput: boolean, currentAsk: ClineAsk | undefined): boolean
```

This function uses `classifyAsk` internally so the ask set stays synchronized
with the active classification used by the adapters.

## Cancellation

| Mode         | Trigger             | Action                                               |
| ------------ | ------------------- | ---------------------------------------------------- |
| TUI          | Ctrl+C or UI button | `controller.cancelTask()`                            |
| Print        | SIGINT              | `controller.cancelTask()` via signal handler         |
| Stdin-stream | `cancel` command    | `controller.cancelTask()` + approval adapter dispose |

Cancellation always goes through `controller.cancelTask()`. If an approval
adapter has a pending request, `dispose()` must reject it so the ask handler
does not hang.

## Non-Interactive Auto-Approval Rules

When `nonInteractive: true` (print mode without `--require-approval`):

| Request kind  | Auto-response                                          |
| ------------- | ------------------------------------------------------ |
| `approve`     | `yesButtonClicked` (tools, commands, MCP all approved) |
| `respond`     | `messageResponse` with empty text or first suggestion  |
| `retry`       | `yesButtonClicked` (auto-retry failed API requests)    |
| `continue`    | `yesButtonClicked` (resume tasks, proceed past limits) |
| `acknowledge` | `yesButtonClicked` (acknowledge completion)            |

## Renderer Responsibilities

Renderers own:

- Terminal formatting and layout (Ink, text, NDJSON)
- Keyboard/input collection
- File/stdin/stdout plumbing
- Progress display
- Session history UI

Renderers must NOT:

- Duplicate ask classification logic
- Maintain separate ask type sets
- Implement ask routing independently of `classifyAsk`

## TUI Adapter Seam (Not Yet Implemented)

The TUI currently handles asks directly in React components with `AskDispatcher`
disabled. To unify:

1. Create `TuiApprovalAdapter` implementing `ApprovalAdapter`
2. In `handle()`: set React state to show the ask UI, return a Promise
3. Resolve the Promise when the user clicks approve/reject or types a response
4. Wire `waitingForInput` events through the adapter instead of inline JSX handlers

The React components would still own rendering; the adapter just bridges the
ask request/response contract.

## Remaining Work

- [ ] Wire `AskDispatcher` to delegate input collection to `ApprovalAdapter` internally
- [ ] Implement `TuiApprovalAdapter` with React state bridge
- [ ] Implement active `StdinStreamApprovalAdapter` (replaces passive pattern)
- [ ] PTY smoke tests for approval path through terminal
- [ ] Formalize session lifecycle events (beyond ask/approval)
