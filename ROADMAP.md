# Public Roadmap Draft

This roadmap is a public draft for the local/private-first Roo Code CLI fork.
It is intentionally high level. Internal operator notes, private runtime
qualification details, and machine-specific control-plane plans do not belong
in this repository.

## 1. CLI/TUI Core

Build one shared session engine for command-line, print, stdin-stream, and TUI
flows.

- One session event contract
- Shared tool approval semantics
- Shared cancellation and resume behavior
- Renderer-specific output only where necessary
- PTY smoke tests for interactive terminal paths

## 2. Local Runtime Support

Make local runtime use predictable and explicit.

- OpenAI-compatible local endpoint support
- Anthropic-compatible local endpoint support
- `vllm-mlx` support
- `llama.cpp` support after qualification
- fail-closed behavior for unqualified runtime features
- clear doctor and readiness output

## 3. Model Selection And Setup

Make model selection understandable without requiring users to become runtime
operators.

- explicit model/profile selection
- local model discovery
- storage planning
- future model acquisition flows
- no silent fallback to the wrong model

## 4. Observability

Normalize runtime signals without hiding where they come from.

- health and readiness checks
- metrics adapters for local model engines
- OpenTelemetry-aligned naming where practical
- useful command-line diagnostics
- no fake status indicators

## 5. Privacy And Control

Keep local/private behavior as the default product posture.

- no required cloud account for local workflows
- no telemetry by default
- explicit provider selection
- clear approval controls for tools and shell commands
- private configuration stored locally

## 6. Migration From Roo Code

Preserve useful migration paths without staying trapped in the old product
shape.

- import useful local settings where possible
- document behavior differences
- keep compatibility where it helps users
- remove cloud/auth assumptions from the CLI happy path

## Not First

These are intentionally not the first priority:

- full VS Code extension parity
- hosted routing features
- cloud account flows
- broad marketplace packaging before the CLI is stable
