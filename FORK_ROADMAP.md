# Local/Private Fork Roadmap

## Thesis

Roo Code has real distribution, but the best opportunity is not "keep Roo alive as-is."
The better opportunity is a focused fork that becomes the best local/private coding CLI for teams and individuals who do not want cloud lock-in, forced auth, telemetry by default, or vendor-hosted routing.

This fork should optimize for:

- local-first usage
- private deployment
- explicit operator control
- strong migration for existing Roo users
- CLI quality over feature sprawl

This fork should not try to win by rebuilding every part of the current Roo product surface at once.
It is explicitly not a "save the VS Code extension" project. The core bet is the CLI.

## Product Position

### What we are building

A CLI-native coding agent for local and private environments:

- local OpenAI-compatible endpoints first
- self-hosted friendly
- offline-capable by default
- import path for Roo users
- strong session and automation ergonomics
- strong MCP and tool execution controls

### What we are not building first

- a new cloud product
- mandatory account auth
- hosted model routing
- telemetry-led growth loops
- editor continuity as the primary mission
- a full replacement for the Roo VS Code extension in v1, and possibly not at all unless the CLI is already strong enough to justify a thin adapter

## Why This Fork Can Work

Roo already proved demand for:

- custom modes
- multi-model workflows
- MCP-heavy usage
- power-user configuration
- agentic UX inside developer workflows

The open gap is that the terminal market is shifting toward:

- Codex
- Claude Code
- OpenCode
- Qwen Code
- Pi

That market is growing, but it still lacks a clear winner for local/private-first operation with a strong open migration path.

## Strategic Bet

Do not compete as "another generic coding agent."
Compete as:

> the serious local/private coding CLI

If the fork is successful, users should describe it as:

- the best CLI for self-hosted models
- the best CLI for air-gapped or restricted environments
- the easiest landing spot for former Roo power users
- the safest place to run MCP-heavy workflows without cloud coupling

## Core Principles

1. Local by default
   The default happy path should be a local or self-hosted OpenAI-compatible endpoint.

2. No account required
   Installation, first run, and normal use must work without vendor login.

3. Telemetry off by default
   Any analytics must be opt-in and easy to audit.
   Model-serving telemetry should stay with the local runtime itself. For
   `llama.cpp` and `vllm-mlx`, the fork should rely on those engines' native
   metrics/telemetry surfaces instead of inventing duplicate CLI-side model
   observability.

4. Private configuration is a product feature
   Config, sessions, prompts, modes, and model registries must be easy to keep local.

5. Fail closed
   Tool permissions, MCP, and shell execution should prefer explicit approval and clear boundaries.

6. CLI first, extension later
   The CLI should be the product. If editor integrations exist later, they should be thin adapters over CLI-owned state and execution.

## Roadmap

### Phase 0: Capture And Continuity

Goal: preserve the codebase and make future work independent of upstream availability.

- secure the fork and keep it synced to the final upstream state
- keep an offline mirror and bundle snapshot
- tag the imported baseline
- document what is upstream Roo versus fork-owned
- freeze a continuity branch for archaeology and regression checks

Exit criteria:

- fork is fully captured
- tags and release history are preserved
- baseline import is reproducible

### Phase 1: Hard Fork Definition

Goal: define the fork as a separate product, not an unofficial mirror.

- choose final product name and namespace
- replace branding, package names, binary names, and release channels
- create a fork charter and security posture
- define support policy and compatibility policy
- open a migration note for Roo users

Exit criteria:

- no user-facing dependency on Roo cloud naming
- install story is under fork-owned names
- legal and operational identity is clear

### Phase 2: Local/Private Foundation

Goal: make local/private the default contract.

- remove cloud auth commands from the CLI
- remove Roo router assumptions and hosted provider defaults
- default provider resolution to local OpenAI-compatible endpoints
- make telemetry opt-in and auditable
- keep model-serving observability with the runtime engine, not the CLI
- support clean config import from Roo local settings
- add a first-run local setup doctor for Ollama, LM Studio, `llama.cpp`, `vllm-mlx`, and OpenAI-compatible APIs

Exit criteria:

- first run works without cloud account creation
- local model endpoint is the default documented path
- no forced hosted dependency remains in the CLI happy path

### Phase 3: CLI Replatform

Goal: stop treating the CLI as a thin shell around the extension runtime.

- carve out a CLI-native execution core
- introduce a CLI-owned `CliRuntime` boundary so `run`, TUI, and stdin-stream stop depending directly on the VS Code host API
- move session storage and state handling into CLI-owned modules
- replace extension-host mediated discovery and control paths with direct CLI-owned implementations
- keep structured output modes stable: text, json, stream-json
- preserve resume, continue, and harness flows
- remove extension-host coupling until the CLI can operate independently

Exit criteria:

- CLI no longer requires the VS Code extension host as the runtime boundary
- core agent loop is testable without the VS Code stack
- CLI startup, reliability, and debuggability improve materially

### Phase 4: Best-In-Class Local Model UX

Goal: make local model use better than cloud-native competitors.

- first-class profiles for local backends
- explicit runtime profiles for `llama.cpp` and `vllm-mlx`
- support both OpenAI-compatible and Anthropic-compatible local endpoint standards
- add first-class Anthropic-compatible model discovery/listing instead of requiring manual model IDs everywhere
- model capability registry with context, reasoning, tool, and vision metadata
- local presets tuned for common runtimes
- clear timeout and retry behavior for slow local inference
- durable streaming and partial-output handling
- import/export for mode packs, prompts, and model registries
- surface runtime-native metrics instead of duplicating model-serving telemetry in the fork

Exit criteria:

- using local models feels deliberate, not like a fallback mode
- operators can manage multiple local runtimes without config sprawl

### Phase 5: Security And Enterprise-Private Fit

Goal: become the trustworthy choice for sensitive environments.

- tighten MCP trust boundaries
- tighten shell and file-write approval policies
- add clear audit logs for local operator actions
- support offline documentation and deterministic config export
- define hardened deployment guidance for enterprise/private use

Exit criteria:

- the fork has a concrete security story beyond "open source"
- risk boundaries are legible to security-conscious users

### Phase 6: Optional Editor Bridge

Goal: support editor users without making the extension the product center again.

- provide a thin editor bridge to the CLI
- keep terminal-native state as the source of truth
- reuse CLI session and model infrastructure
- avoid rebuilding cloud-shaped webview complexity unless demand proves it
- do not reintroduce editor-only features that pull the runtime back behind a VS Code boundary

Exit criteria:

- any editor support is a thin adapter, not a parallel product
- CLI remains the primary product and architecture center

## First 30 Days

### Week 1

- capture and tag the final upstream baseline
- define fork name
- publish fork charter
- create roadmap, security stance, and migration intent docs

### Week 2

- remove cloud-auth-first flows from CLI onboarding
- add local-provider-first startup path
- add explicit config import from Roo local settings

### Week 3

- identify extension-host dependencies in the CLI
- isolate session, provider, and output contracts
- stabilize the structured non-interactive interface
- replace discovery and listing paths with CLI-native implementations
- add Anthropic-compatible model discovery/listing support for local runtimes

### Week 4

- ship first alpha to former Roo power users
- collect feedback only from local/private-heavy usage
- decide whether editor bridge is urgent or can wait

## First Releases

### Release A: Continuity

- same codebase
- fork branding
- synced baseline
- no product promise except continuity

### Release B: Private Default

- local endpoint defaults
- cloud auth removed from normal CLI path
- telemetry off by default
- migration guide for Roo users

### Release C: Native CLI Core

- major reduction in extension-host coupling
- stable JSON and stream interfaces
- better local runtime handling
- first-class model discovery for both OpenAI-compatible and Anthropic-compatible local runtimes

## Comparison Target

The fork should benchmark itself against:

- Codex for terminal quality and workflow sharpness
- OpenCode for open CLI product shape
- Pi for local/private ergonomics
- Claude Code for usability and session flow

It should not benchmark itself against old Roo sentiment alone.

## Kill Criteria

Do not keep investing if the fork cannot achieve at least two of these:

- clear local/private differentiation
- strong migration pull from Roo power users
- better local model UX than the major terminal competitors
- sustainable maintenance surface for a small team

If it becomes "Roo maintenance with less momentum," stop.

## Immediate Next Decisions

1. Decide whether the fork is CLI-only for v1 or CLI-plus-extension continuity.
2. Decide final product name and package namespace.
3. Decide whether to preserve Roo config format directly or support one-way import only.
4. Decide whether to keep MCP on by default or require explicit enablement in the fork.
