# Mesa Code Public Roadmap Draft

Mesa Code is a local-first coding agent CLI/TUI forked from Roo Code. This
roadmap is intentionally high level. Internal operator notes, private runtime
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

The CLI should stay small by default, closer to Pi's explicit tool surface than
to a giant always-on agent shell. Richer operator features should be layered on
deliberately, not forced into the base prompt and tool loop.

## 2. Local Runtime Support

Make local runtime use predictable and explicit.

- OpenAI-compatible local endpoint support
- Anthropic-compatible local endpoint support
- `vllm-mlx` support
- `llama.cpp` support after qualification
- fail-closed behavior for unqualified runtime features
- clear doctor and readiness output
- real cancellation for local OpenAI-compatible and Anthropic-compatible
  streams
- no fake controls: if a runtime feature is not actually qualified, the UI and
  CLI should say so

## 3. Model Selection And Setup

Make model selection understandable without requiring users to become runtime
operators.

- explicit model/profile selection
- local model discovery
- storage planning
- future model acquisition flows
- no silent fallback to the wrong model
- model switching from both command-line and TUI surfaces through the same
  readiness contract
- model-class capability profiles for reasoning, tool use, vision, and context
  behavior

## 4. Observability

Normalize runtime signals without hiding where they come from.

- health and readiness checks
- metrics adapters for local model engines
- OpenTelemetry-aligned naming where practical
- useful command-line diagnostics
- no fake status indicators
- session/tool statistics that make prompt growth, tool count, and context
  pressure visible
- structured stream output suitable for automation and CI

## 5. Privacy And Control

Keep local/private behavior as the default product posture.

- no required cloud account for local workflows
- no telemetry by default
- explicit provider selection
- clear approval controls for tools and shell commands
- private configuration stored locally
- shell-command approval based on a real command parser, not fragile string
  splitting
- oversized tool and MCP outputs handled as local artifacts with previews,
  caps, and clear references

## 6. Mesa Code Rename And Migration

Move from the Roo Code fork identity to Mesa Code without breaking early users.

- keep upstream Roo attribution clear
- retain a `roo` compatibility alias during migration
- add the `mesa` CLI command
- rename public package and install docs in stages
- avoid unnecessary internal namespace churn until the CLI surface is stable

## 7. Migration From Roo Code

Preserve useful migration paths without staying trapped in the old product
shape.

- import useful local settings where possible
- document behavior differences
- keep compatibility where it helps users
- remove cloud/auth assumptions from the CLI happy path

High-value Roo backlog items will be evaluated through the Mesa lens: keep
local endpoint support, cancellation, command approval correctness, model
selection, checkpoint/restore, and MCP/tool-output controls; reject cloud-auth
work as a default-path requirement.

## Not First

These are intentionally not the first priority:

- full VS Code extension parity
- hosted routing features
- cloud account flows
- broad marketplace packaging before the CLI is stable
