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

For the runtime control-plane gap between the current CLI slice and the target
production contract, see
[RUNTIME_CONTROL_PLANE_GAP_ANALYSIS.md](RUNTIME_CONTROL_PLANE_GAP_ANALYSIS.md).

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
- managed local runtime selection through `roo use`
- persisted runtime state and logs under `~/.roo/`
- dry-run model source and storage planning through `roo use --plan`
- local loopback placeholder-key behavior for self-hosted endpoints

What is next:

- bundle-API runtime backend instead of direct `ExtensionHost` control
- CLI-owned workspace file search/autocomplete instead of extension-side lookup
- runtime/model manager beyond the first `roo use` slice
- Hugging Face-backed model source handling and placement policy
- unified local-runtime observability around Prometheus/OpenTelemetry-style metrics
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
# Start or swap a managed vllm-mlx lane.
roo use \
  --runtime vllm-mlx \
  --protocol openai \
  --model mlx-community/Qwen3-4B-4bit

# Then use the saved profile.
roo "Summarize this repository"

# Save a configuration-only llama.cpp lane against an existing server.
roo use \
  --runtime llama.cpp \
  --protocol anthropic \
  --base-url http://127.0.0.1:8081 \
  --model /models/coder.gguf \
  --no-start

# Plan remote model acquisition and placement without changing anything.
roo use \
  --runtime vllm-mlx \
  --model Qwen/Qwen3.6-35B-A3B \
  --plan
```

The fork should not invent duplicate model-serving telemetry for those runtimes.
Observability should come from the engine itself, especially for `llama.cpp`
and `vllm-mlx`. The CLI’s job is to normalize those signals and make the local
runtime lane easy to bootstrap and inspect.

Where runtime-native placement support is still missing, the CLI should be
explicit about it. `roo use --plan` now shows model source and storage policy
without pretending `--storage-root` is already live-enforced.

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
