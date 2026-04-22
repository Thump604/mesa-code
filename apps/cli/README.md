# @roo-code/cli

Command line interface for Roo Code, aimed at a local/private-first workflow.

## Overview

This fork is pushing Roo toward a CLI-native product instead of a VS Code-shaped one.
The direction is:

- local and self-hosted endpoints first
- no mandatory cloud account for normal use
- `llama.cpp` and `vllm-mlx` as first-class runtimes
- OpenAI-compatible and Anthropic-compatible endpoint support

The transition is in progress. Discovery flows like `roo list commands`, `roo list modes`,
`roo list models`, and `roo list sessions` are already CLI-native. Some interactive runtime
paths still reuse upstream compatibility layers while that execution core is being pulled out,
but interactive entrypoints now go through a CLI-owned runtime boundary instead of constructing
the extension host directly at each call site.

## Installation

### Quick Install (Recommended)

Install the Roo Code CLI with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/apps/cli/install.sh | sh
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
ROO_VERSION=0.1.0 curl -fsSL https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/apps/cli/install.sh | sh
```

### Updating

Re-run the install script to update to the latest version:

```bash
curl -fsSL https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/apps/cli/install.sh | sh
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

For local/private deployments, the CLI can target explicit runtime profiles for
`llama.cpp` and `vllm-mlx` while speaking either OpenAI-compatible or
Anthropic-compatible APIs.

```bash
# OpenAI-compatible vllm-mlx endpoint
roo \
  --runtime vllm-mlx \
  --protocol openai \
  --base-url http://127.0.0.1:8080/v1 \
  --model qwen3-coder \
  "Summarize the repository"

# Anthropic-compatible llama.cpp adapter endpoint
roo \
  --runtime llama.cpp \
  --protocol anthropic \
  --base-url http://127.0.0.1:8081 \
  --model claude-local \
  "Review the staged diff"
```

The CLI should not own model-serving telemetry for these runtimes. Use the
metrics and observability surfaces exposed by `llama.cpp` and `vllm-mlx`
themselves.

### Stdin Stream Mode (`--stdin-prompt-stream`)

For programmatic control (one process, multiple prompts), use `--stdin-prompt-stream` with `--print`.
Send NDJSON commands via stdin:

```bash
printf '{"command":"start","requestId":"1","prompt":"1+1=?"}\n' | roo --print --stdin-prompt-stream --output-format stream-json

# Optional: provide taskId per start command
printf '{"command":"start","requestId":"1","taskId":"018f7fc8-7c96-7f7c-98aa-2ec4ff7f6d87","prompt":"1+1=?"}\n' | roo --print --stdin-prompt-stream --output-format stream-json
```

### Roo Cloud Compatibility Authentication

If you explicitly need the legacy Roo-hosted compatibility path, you can still authenticate:

```bash
# Log in to Roo Cloud compatibility mode (opens browser)
roo auth login

# Check compatibility auth status
roo auth status

# Log out
roo auth logout
```

The `auth login` command:

1. Opens your browser to authenticate with Roo Cloud compatibility mode
2. Receives a secure token via localhost callback
3. Stores the token in `~/.config/roo/credentials.json`

Tokens are valid for 90 days. The CLI will prompt you to re-authenticate when your token expires.

Normal local/private usage should prefer `--provider`, `--runtime`, `--protocol`, `--base-url`,
and provider environment variables instead of this flow.

**Authentication Flow:**

```
┌──────┐         ┌─────────┐         ┌───────────────┐
│  CLI │         │ Browser │         │ Roo Cloud     │
└──┬───┘         └────┬────┘         └───────┬───────┘
   │                  │                      │
   │ Open auth URL    │                      │
   │─────────────────>│                      │
   │                  │                      │
   │                  │ Authenticate         │
   │                  │─────────────────────>│
   │                  │                      │
   │                  │<─────────────────────│
   │                  │ Token via callback   │
   │<─────────────────│                      │
   │                  │                      │
   │ Store token      │                      │
   │                  │                      │
```

## Options

| Option                                  | Description                                                                             | Default                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------- |
| `[prompt]`                              | Your prompt (positional argument, optional)                                             | None                                    |
| `--prompt-file <path>`                  | Read prompt from a file instead of command line argument                                | None                                    |
| `--create-with-session-id <session-id>` | Create a new task using the provided session ID (UUID)                                  | None                                    |
| `-w, --workspace <path>`                | Workspace path to operate in                                                            | Current directory                       |
| `-p, --print`                           | Print response and exit (non-interactive mode)                                          | `false`                                 |
| `--stdin-prompt-stream`                 | Read NDJSON control commands from stdin (requires `--print`)                            | `false`                                 |
| `-d, --debug`                           | Enable debug output (includes detailed debug information, prompts, paths, etc)          | `false`                                 |
| `-a, --require-approval`                | Require manual approval before actions execute                                          | `false`                                 |
| `-k, --api-key <key>`                   | API key for the LLM provider                                                            | From env var                            |
| `--provider <provider>`                 | API provider (roo, anthropic, openai, openrouter, etc.)                                 | Resolved from settings and local config |
| `--protocol <protocol>`                 | API standard for local/self-hosted endpoints: `openai` or `anthropic`                   | `openai`                                |
| `--runtime <runtime>`                   | Local runtime profile: `llama.cpp` or `vllm-mlx`                                        | None                                    |
| `--base-url <url>`                      | Base URL for OpenAI- or Anthropic-compatible endpoints                                  | None                                    |
| `-m, --model <model>`                   | Model to use                                                                            | Resolved from provider/runtime settings |
| `--mode <mode>`                         | Mode to start in (code, architect, ask, debug, etc.)                                    | `code`                                  |
| `--terminal-shell <path>`               | Absolute shell path for inline terminal command execution                               | Auto-detected shell                     |
| `-r, --reasoning-effort <effort>`       | Reasoning effort level (unspecified, disabled, none, minimal, low, medium, high, xhigh) | `medium`                                |
| `--consecutive-mistake-limit <n>`       | Consecutive error/repetition limit before guidance prompt (`0` disables the limit)      | `10`                                    |
| `--ephemeral`                           | Run without persisting state (uses temporary storage)                                   | `false`                                 |
| `--oneshot`                             | Exit upon task completion                                                               | `false`                                 |
| `--output-format <format>`              | Output format with `--print`: `text`, `json`, or `stream-json`                          | `text`                                  |

## Auth Commands

| Command           | Description                                   |
| ----------------- | --------------------------------------------- |
| `roo auth login`  | Authenticate for Roo Cloud compatibility mode |
| `roo auth logout` | Clear stored Roo compatibility token          |
| `roo auth status` | Show current Roo compatibility auth status    |

## Environment Variables

The CLI will look for API keys in environment variables if not provided via `--api-key`:

| Provider          | Environment Variable        |
| ----------------- | --------------------------- |
| roo               | `ROO_API_KEY`               |
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

**Compatibility Authentication Environment Variables:**

| Variable          | Description                                                                   |
| ----------------- | ----------------------------------------------------------------------------- |
| `ROO_WEB_APP_URL` | Override the Roo Cloud compatibility URL (default: `https://app.roocode.com`) |

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
3. The interactive execution core is still in transition; some paths reuse upstream runtime compatibility layers until the fork finishes pulling them into CLI-owned modules.
4. The roadmap goal is to remove the VS Code-shaped runtime boundary entirely from normal CLI operation.

## Development

```bash
# Run directly from source (no build required)
pnpm dev --protocol openai --base-url http://127.0.0.1:8080/v1 --model qwen3-coder --print "Hello"

# Run tests
pnpm test

# Type checking
pnpm check-types

# Linting
pnpm lint
```

By default the `start` script points `ROO_CODE_PROVIDER_URL` at `http://localhost:8080/proxy` for local development. To point at the production API instead, override the environment variable:

```bash
ROO_CODE_PROVIDER_URL=https://api.roocode.com/proxy pnpm dev --provider roo --api-key $ROO_API_KEY --print "Hello"
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
