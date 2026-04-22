# Roo Code Fork

> A local/private-first fork of Roo Code, aimed at becoming the best coding CLI
> for self-hosted and offline-capable environments.

This repository is no longer being treated as "upstream Roo, but maintained."
The direction here is narrower and stricter:

- CLI-first
- local model runtimes first
- no required cloud account
- no hosted routing assumptions in the happy path
- telemetry off by default
- explicit operator control over tools, models, and config

The final product name and package namespace are still pending. Until that is
decided, this repo uses a temporary fork identity and documents the migration
away from the original cloud-shaped product model.

## Current Focus

The immediate goal is to turn the existing Roo CLI and runtime into a serious
local/private coding agent surface, with first-class support for:

- `llama.cpp`
- `vllm-mlx`
- OpenAI-compatible local endpoints
- Anthropic-compatible local endpoints
- stable non-interactive CLI contracts
- migration for former Roo users

The fork is not trying to rebuild every part of the original VS Code product
before the CLI is strong.

## Current Status

What is already in motion on the fork branch:

- captured upstream baseline and offline mirror
- local/private roadmap in [FORK_ROADMAP.md](FORK_ROADMAP.md)
- CLI support for `--runtime llama.cpp|vllm-mlx`
- CLI support for `--protocol openai|anthropic`
- protocol-aware `--base-url`
- local loopback placeholder-key behavior for self-hosted endpoints

What is next:

- bundle-API runtime backend instead of direct `ExtensionHost` control
- CLI-owned workspace file search/autocomplete instead of extension-side lookup
- Anthropic-compatible model discovery/listing
- fully CLI-native execution core beyond the transitional bundle backend
- local doctor/bootstrap flows
- stronger migration/import from Roo local settings

## Roadmap

The canonical roadmap lives in [FORK_ROADMAP.md](FORK_ROADMAP.md).

Key themes:

- local/private defaults
- first-class local runtimes
- runtime-native telemetry and metrics
- stable JSON and stream interfaces
- security-conscious MCP and shell boundaries
- editor bridge later, not first

## Quick Start

### Prerequisites

- Node.js 20.x
- `pnpm`

### Install

```bash
pnpm install
```

### Build the CLI

```bash
pnpm --filter @roo-code/cli build
```

### Run the CLI Against a Local Runtime

```bash
# OpenAI-compatible vllm-mlx endpoint
roo \
  --runtime vllm-mlx \
  --protocol openai \
  --base-url http://127.0.0.1:8080/v1 \
  --model qwen3-coder \
  "Summarize this repository"

# Anthropic-compatible llama.cpp adapter endpoint
roo \
  --runtime llama.cpp \
  --protocol anthropic \
  --base-url http://127.0.0.1:8081 \
  --model claude-local \
  "Review the staged diff"
```

The fork should not invent duplicate model-serving telemetry for those runtimes.
Observability should come from the engine itself, especially for `llama.cpp`
and `vllm-mlx`.

## Development

### CLI checks

```bash
pnpm --filter @roo-code/cli check-types
pnpm --filter @roo-code/cli test
pnpm --filter @roo-code/cli build
```

### Monorepo checks

```bash
pnpm check-types
pnpm lint
```

## Repo Structure

- [apps/cli](apps/cli) - terminal entrypoint and CLI runtime
- [src](src) - existing extension/runtime implementation being carved apart
- [packages/core](packages/core) - shared core logic
- [packages/types](packages/types) - shared contracts and provider/model types
- [webview-ui](webview-ui) - existing webview frontend
- [FORK_ROADMAP.md](FORK_ROADMAP.md) - fork strategy and execution plan

## Compatibility Direction

The intended compatibility model is:

- preserve useful Roo session/config migration paths
- preserve structured CLI output contracts
- remove Roo cloud-auth assumptions from the CLI surface
- treat local/self-hosted runtimes as the primary product surface

This repo is not promising extension parity first.

## License

This repository remains under the upstream [Apache 2.0](LICENSE) license unless
and until the project owners intentionally change the legal posture within the
bounds of that license.
