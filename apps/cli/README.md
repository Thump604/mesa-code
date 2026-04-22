# @roo-code/cli

Command line interface for Roo Code, aimed at a local/private-first workflow.

## Overview

This fork is pushing Roo toward a CLI-native product instead of a VS Code-shaped one.
The direction is:

- local and self-hosted endpoints first
- no mandatory cloud account for normal use
- no Roo cloud auth commands in the supported CLI surface
- `llama.cpp` and `vllm-mlx` as first-class runtimes
- OpenAI-compatible and Anthropic-compatible endpoint support
- terminal-native prompt profile with lean default tool/skill scaffolding
- preset-aware `roo use` through the local ops control plane when available
- managed direct-runtime bootstrap fallback through `roo use`
- unified observability for local runtimes using Prometheus scrapes normalized into an OpenTelemetry-aligned namespace

The default provider contract is now local OpenAI-compatible inference. Remote
providers like `openrouter` are explicit opt-in via `--provider` or saved config.

The transition is in progress. Discovery flows like `roo list commands`, `roo list modes`,
`roo list models`, and `roo list sessions` are already CLI-native. Some interactive runtime
paths still reuse upstream compatibility layers while that execution core is being pulled out,
but interactive entrypoints now go through a CLI-owned runtime boundary that activates the
extension bundle through its returned API surface instead of constructing `ExtensionHost`
directly at each call site. Task selection, mode changes, and task-message submission are
expressed as CLI-owned runtime operations rather than raw VS Code webview messages in the
caller layer. TUI and print-mode entrypoints also now share one runtime-backed session
controller for `start`, `resume`, and `continue`, including shared runtime creation,
activation, resolution, action methods, and disposal hooks instead of each surface
carrying its own session bootstrap and runtime wiring. They now also share one
session-lifecycle contract for launch, completion, error, and resume behavior,
with only surface-specific rendering above that layer. Print-mode terminal output
and approval prompting now also live in an explicit CLI text surface instead of
being hidden inside the runtime backend, so the runtime boundary is closer to
transport/session only.
The remaining non-interactive shell loop now also lives in a dedicated CLI
runner instead of being inlined inside `run.ts`, so signal handling, cleanup,
JSON emitter attachment, and stdin-stream settlement are owned by one module.
Workspace
file search for `@` mentions is also CLI-owned now, including
ripgrep-backed indexing, fuzzy ranking, and `.rooignore` filtering.

The CLI path also now uses a terminal-native prompt profile instead of the
heavier editor-era defaults. That means skills are loaded when clearly relevant
or explicitly requested, tool use is not quota-driven, and the agent is told to
keep working until a real blocker or completion point instead of pausing after
every successful tool call.

## Installation

### Quick Install (Recommended)

Install the Roo Code CLI with a single command:

```bash
ROO_REPO=Thump604/Roo-Code \
  curl -fsSL https://raw.githubusercontent.com/Thump604/Roo-Code/main/apps/cli/install.sh | sh
```

**Requirements:**

- Node.js 20 or higher
- macOS Apple Silicon (M1/M2/M3/M4) or Linux x64

**Custom installation directory:**

```bash
ROO_INSTALL_DIR=/opt/roo-code ROO_BIN_DIR=/usr/local/bin curl -fsSL ... | sh
```

**Install a specific version:**

```bash
ROO_REPO=Thump604/Roo-Code ROO_VERSION=0.1.0 \
  curl -fsSL https://raw.githubusercontent.com/Thump604/Roo-Code/main/apps/cli/install.sh | sh
```

### Updating

Re-run the install script to update to the latest version:

```bash
ROO_REPO=Thump604/Roo-Code \
  curl -fsSL https://raw.githubusercontent.com/Thump604/Roo-Code/main/apps/cli/install.sh | sh
```

Or run:

```bash
roo upgrade
```

### Uninstalling

```bash
rm -rf ~/.roo/cli ~/.local/bin/roo
```

### Development Installation

For contributing or development:

```bash
# From the monorepo root.
pnpm install

# Build the CLI.
pnpm --filter @roo-code/cli build
```

If you are working on the current interactive runtime path, the upstream extension bundle is
still used as a transitional dependency:

```bash
pnpm --filter roo-cline bundle
```

## TUI Smoke Tests

The CLI now has a real PTY-driven TUI smoke lane for high-value interactive
flows. It runs against a live local OpenAI-compatible endpoint, uses an
isolated temporary `HOME`, builds the CLI and extension bundle first, and
drives the Ink UI through a pseudo-terminal instead of relying on mocks.

```bash
pnpm --filter @roo-code/cli test:tui:smoke
```

List or filter the available cases:

```bash
pnpm --filter @roo-code/cli test:tui:smoke:list
python3 apps/cli/scripts/tui/run.py --match approval
```

Current smoke coverage:

- launch and render
- live prompt submission
- approval-required tool execution to completion
- autocomplete picker navigation
- resume an existing session across a TUI restart

## Non-Interactive Smoke Tests

The CLI also has a live non-interactive smoke lane for the two automation-facing
surfaces that matter most: `--print` and `--stdin-prompt-stream`.
It uses the built CLI entry, discovers the live served model from `/v1/models`,
and verifies real output or stream control completion against the active local
runtime instead of relying on unit tests alone.

```bash
pnpm --filter @roo-code/cli test:noninteractive:smoke
```

List or filter the available cases:

```bash
pnpm --filter @roo-code/cli test:noninteractive:smoke:list
python3 apps/cli/scripts/noninteractive/run.py --match stdin
python3 apps/cli/scripts/noninteractive/run.py --timeout 30
```

Current smoke coverage:

- live `--print` prompt execution
- live `--stdin-prompt-stream` start/result/shutdown flow

## Usage

### Interactive Mode (Default)

By default, the CLI auto-approves actions and runs in interactive TUI mode:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:8080/v1

roo "What is this project?" -w ~/Documents/my-project
```

You can also run without a prompt and enter it interactively in TUI mode:

```bash
roo -w ~/Documents/my-project
```

In interactive mode:

- Tool executions are auto-approved
- Commands are auto-approved
- Followup questions show suggestions with a 60-second timeout, then auto-select the first suggestion
- Browser and MCP actions are auto-approved

### Approval-Required Mode (`--require-approval`)

If you want manual approval prompts, enable approval-required mode:

```bash
roo "Refactor the utils.ts file" --require-approval -w ~/Documents/my-project
```

In approval-required mode:

- Tool, command, browser, and MCP actions prompt for yes/no approval
- Followup questions wait for manual input (no auto-timeout)

### Print Mode (`--print`)

Use `--print` for non-interactive execution and machine-readable output:

```bash
# Prompt is required
roo --print "Summarize this repository"

# Create a new task with a specific session ID (UUID)
roo --print --create-with-session-id 018f7fc8-7c96-7f7c-98aa-2ec4ff7f6d87 "Summarize this repository"
```

### Local Runtime Profiles

For local/private deployments, `roo use` now prefers the local ops control
plane for runtime-owned presets and active-model tracking. When ops is not
present, the CLI falls back to its managed direct-runtime bootstrap lane,
including detached `vllm-mlx` process management and persisted runtime
logs/state under `~/.roo/`.

That is still a transitional slice, not the full production control plane yet.
The gap between today’s fallback bootstrap path and the target runtime/ops
contract is tracked in
[`RUNTIME_CONTROL_PLANE_GAP_ANALYSIS.md`](../../RUNTIME_CONTROL_PLANE_GAP_ANALYSIS.md).

```bash
# Prefer the ops control plane for runtime-owned preset aliases.
roo use fast-qwen

# Start or swap the managed vllm-mlx lane.
roo use \
  --runtime vllm-mlx \
  --protocol openai \
  --model mlx-community/Qwen3-4B-4bit

# Then use the saved local lane.
roo "Summarize the repository"

# Save a configuration-only llama.cpp profile against an existing local server.
roo use \
  --runtime llama.cpp \
  --protocol anthropic \
  --base-url http://127.0.0.1:8081 \
  --model /models/coder.gguf \
  --no-start

# Dry-run the model source and storage plan for a remote model.
roo use \
  --runtime vllm-mlx \
  --model Qwen/Qwen3.6-35B-A3B \
  --plan

# Dry-run a specific storage-root policy.
roo use \
  --runtime vllm-mlx \
  --model Qwen/Qwen3.6-35B-A3B \
  --plan \
  --storage-root ~/ai-models
```

The CLI should not own model-serving telemetry for these runtimes. Use the
metrics and observability surfaces exposed by `llama.cpp` and `vllm-mlx`
themselves.

The fork’s job is to unify those runtime-native signals into a consistent
operator surface. The new `roo doctor` command probes health, model discovery,
and `/metrics`, then normalizes runtime metrics into a stable
`gen_ai.local.*` namespace for downstream OpenTelemetry collection or
dashboards. `roo use` builds on the same contract to verify that the managed
runtime lane is actually responding before it returns when possible. When ops is
available, `roo use` should follow ops-owned preset/model state rather than
inventing its own alias or readiness semantics.

`--storage-root` is currently planning-only. The CLI will show the placement
plan and block obviously external/removable targets unless
`--allow-external-storage` is set, but live execution still depends on
runtime-native placement support.

### Local Runtime Doctor

Use `roo doctor` to probe a local runtime profile with sensible loopback
defaults:

```bash
# vllm-mlx / OpenAI-compatible default
roo doctor --runtime vllm-mlx

# llama.cpp / Anthropic-compatible default
roo doctor --runtime llama.cpp --protocol anthropic

# JSON output for automation
roo doctor --runtime vllm-mlx --format json
```

Managed `vllm-mlx` state is persisted in `~/.roo/runtime-state.json`. Detached
runtime logs are written to `~/.roo/runtime-logs/`.

### First-Run Local Contract

If you do not explicitly choose a provider, the CLI assumes a local/self-hosted
OpenAI-compatible endpoint. The simplest local setup is:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:8080/v1
roo --model qwen3-coder "Summarize the repository"
```

If you want a remote provider, make that choice explicit:

```bash
roo --provider openrouter --api-key "$OPENROUTER_API_KEY" --model anthropic/claude-sonnet-4 "Review the diff"
```

### Stdin Stream Mode (`--stdin-prompt-stream`)

For programmatic control (one process, multiple prompts), use `--stdin-prompt-stream` with `--print`.
Send NDJSON commands via stdin:

```bash
printf '{"command":"start","requestId":"1","prompt":"1+1=?"}\n' | roo --print --stdin-prompt-stream --output-format stream-json

# Optional: provide taskId per start command
printf '{"command":"start","requestId":"1","taskId":"018f7fc8-7c96-7f7c-98aa-2ec4ff7f6d87","prompt":"1+1=?"}\n' | roo --print --stdin-prompt-stream --output-format stream-json
```

## Options

| Option                                  | Description                                                                             | Default                             |
| --------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------- |
| `[prompt]`                              | Your prompt (positional argument, optional)                                             | None                                |
| `--prompt-file <path>`                  | Read prompt from a file instead of command line argument                                | None                                |
| `--create-with-session-id <session-id>` | Create a new task using the provided session ID (UUID)                                  | None                                |
| `-w, --workspace <path>`                | Workspace path to operate in                                                            | Current directory                   |
| `-p, --print`                           | Print response and exit (non-interactive mode)                                          | `false`                             |
| `--stdin-prompt-stream`                 | Read NDJSON control commands from stdin (requires `--print`)                            | `false`                             |
| `-d, --debug`                           | Enable debug output (includes detailed debug information, prompts, paths, etc)          | `false`                             |
| `-a, --require-approval`                | Require manual approval before actions execute                                          | `false`                             |
| `-k, --api-key <key>`                   | API key for the LLM provider                                                            | From env var                        |
| `--provider <provider>`                 | API provider (openai, anthropic, openrouter, openai-native, etc.)                       | Resolved from flags/settings        |
| `--protocol <protocol>`                 | API standard for local/self-hosted endpoints: `openai` or `anthropic`                   | `openai`                            |
| `--runtime <runtime>`                   | Local runtime profile: `llama.cpp` or `vllm-mlx`                                        | None                                |
| `--base-url <url>`                      | Base URL for OpenAI- or Anthropic-compatible endpoints                                  | None                                |
| `-m, --model <model>`                   | Model to use                                                                            | Required for local runtime profiles |
| `--mode <mode>`                         | Mode to start in (code, architect, ask, debug, etc.)                                    | `code`                              |
| `--terminal-shell <path>`               | Absolute shell path for inline terminal command execution                               | Auto-detected shell                 |
| `-r, --reasoning-effort <effort>`       | Reasoning effort level (unspecified, disabled, none, minimal, low, medium, high, xhigh) | `medium`                            |
| `--consecutive-mistake-limit <n>`       | Consecutive error/repetition limit before guidance prompt (`0` disables the limit)      | `10`                                |
| `--ephemeral`                           | Run without persisting state (uses temporary storage)                                   | `false`                             |
| `--oneshot`                             | Exit upon task completion                                                               | `false`                             |
| `--output-format <format>`              | Output format with `--print`: `text`, `json`, or `stream-json`                          | `text`                              |

## Environment Variables

The CLI will look for API keys in environment variables if not provided via `--api-key`:

| Provider          | Environment Variable        |
| ----------------- | --------------------------- |
| anthropic         | `ANTHROPIC_API_KEY`         |
| openai            | `OPENAI_API_KEY`            |
| openai-native     | `OPENAI_API_KEY`            |
| openrouter        | `OPENROUTER_API_KEY`        |
| gemini            | `GOOGLE_API_KEY`            |
| vercel-ai-gateway | `VERCEL_AI_GATEWAY_API_KEY` |

For protocol-aware local/private base URLs, the CLI also reads:

| Standard  | Environment Variable |
| --------- | -------------------- |
| anthropic | `ANTHROPIC_BASE_URL` |
| openai    | `OPENAI_BASE_URL`    |

## Architecture

The target architecture is a CLI-native runtime. The current state is transitional:

```
┌──────────────────────┐
│ CLI entry and UX     │
│ (commands, TUI, I/O) │
└──────────┬───────────┘
           │
    ┌──────┴──────────────┐
    │                     │
    ▼                     ▼
┌──────────────┐   ┌──────────────────────┐
│ CLI-native   │   │ Transitional runtime │
│ discovery    │   │ compatibility layer  │
│ and storage  │   │ (being reduced)      │
└──────────────┘   └──────────────────────┘
```

## How It Works

1. `index.ts` parses CLI flags and routes into command handlers or the interactive TUI.
2. CLI-native paths handle command discovery, mode discovery, model discovery, settings, and session history directly.
3. The interactive execution core is still in transition; the current backend activates the extension bundle and drives the returned API surface directly instead of using the fake webview transport.
4. Workspace file search and autocomplete are already carved out into CLI-owned modules, so the bundle backend is no longer responsible for `@` file lookup behavior.
5. Local runtime doctor/observability is CLI-owned. It probes health and metrics endpoints directly instead of relying on extension-side plumbing.
6. Local runtime lifecycle is now starting to move into CLI-owned modules through `roo use`, managed process state, and runtime log tracking.
7. Model-source and storage planning is now CLI-owned through `roo use --plan`, with explicit planning-only boundaries where runtime support is still missing.
8. The roadmap goal is still to replace the remaining bundle-backed execution path with a fully CLI-native engine.

## Development

```bash
# Run directly from source (no build required)
pnpm dev --base-url http://127.0.0.1:8080/v1 --model qwen3-coder --print "Hello"

# Or use the default local contract through env vars
OPENAI_BASE_URL=http://127.0.0.1:8080/v1 pnpm dev --model qwen3-coder "Hello"

# Run tests
pnpm test

# Type checking
pnpm check-types

# Linting
pnpm lint
```

## Releasing

Official releases are created via the GitHub Actions workflow at `.github/workflows/cli-release.yml`.

To trigger a release:

1. Go to **Actions** → **CLI Release**
2. Click **Run workflow**
3. Optionally specify a version (defaults to `package.json` version)
4. Click **Run workflow**

The workflow will:

1. Build the CLI on all platforms (macOS Apple Silicon, Linux x64)
2. Create platform-specific tarballs with bundled ripgrep
3. Verify each tarball
4. Create a GitHub release with all tarballs attached

### Local Builds

For local development and testing, use the build script:

```bash
# Build tarball for your current platform
./apps/cli/scripts/build.sh

# Build and install locally
./apps/cli/scripts/build.sh --install

# Fast build (skip verification)
./apps/cli/scripts/build.sh --skip-verify
```
