# Runtime Control Plane Gap Analysis

## Purpose

This document turns the product asks in
[`RUNTIME_REQUESTS.md`](./RUNTIME_REQUESTS.md) into an evidence-based runtime
audit and an implementation contract.

`RUNTIME_REQUESTS.md` is the product ask.
This file is the production-systems read of what exists today, what is only
partially true, and what needs to ship next.

Audit date: 2026-04-21

## Decision Summary

- Roo should treat the runtime control plane as a first-class product surface,
  not as an implementation detail behind `roo use`.
- When a local ops control plane exists, Roo should integrate with that control
  plane first. Direct detached `vllm-mlx serve ...` management is a bootstrap
  fallback, not the long-term production contract.
- Preset names such as `fast-qwen` should be treated as product/runtime aliases,
  not hardcoded model IDs inside Roo. The runtime must be able to repoint those
  aliases without requiring CLI changes.
- "Port is open" is not the same thing as "requested model is ready." Roo
  should stop treating those as equivalent.

## Current State At A Glance

| Area                     | Status  | Reality Today                                                                                                                                                    |
| ------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle contract       | Partial | Roo can spawn and track a detached `vllm-mlx` process. Ops has real preset activation and state APIs. There is no single authoritative readiness/state endpoint. |
| Model acquisition        | Missing | Roo can only hand a repo ID to `vllm-mlx serve` and hope the runtime downloads it. There is no first-class acquire/resume contract.                              |
| Storage placement        | Missing | There is no runtime API for model roots, disk policy, free-space planning, or final placement.                                                                   |
| Swap/load semantics      | Partial | Ops exposes preset activation and active state, but load progress and failure semantics are not a clean machine contract.                                        |
| Health/readiness         | Partial | Runtime has `/health`; live runtime does not expose a stable `/ready`; `/metrics` is absent on the current live base.                                            |
| Model discovery          | Partial | Runtime `/v1/models` exists, but it returns a minimal active model list with no capability metadata.                                                             |
| Observability            | Partial | Roo can normalize Prometheus when present. The live runtime currently does not expose a working `/metrics` surface.                                              |
| Structured errors/events | Missing | Failures are still mostly inferred from stderr, logs, or generic HTTP failures.                                                                                  |
| Install/packaging        | Partial | Roo can `uv tool install` `vllm-mlx`, but this is not a real release/channel/install contract.                                                                   |
| Local-first auth         | Partial | Roo already supports loopback no-key behavior and passes `HF_TOKEN`, but runtime-native gated acquisition is still missing.                                      |

## What Exists Today

### Roo CLI

Current Roo runtime behavior is implemented in:

- [`apps/cli/src/runtime/runtime-manager.ts`](./apps/cli/src/runtime/runtime-manager.ts)
- [`apps/cli/src/runtime/observability.ts`](./apps/cli/src/runtime/observability.ts)
- [`apps/cli/src/commands/cli/use.ts`](./apps/cli/src/commands/cli/use.ts)
- [`apps/cli/src/commands/cli/doctor.ts`](./apps/cli/src/commands/cli/doctor.ts)

What Roo can do today:

- resolve a local `vllm-mlx` executable
- optionally install it via `uv tool install`
- spawn a detached `vllm-mlx serve <model>` process
- persist PID/log metadata under `~/.roo/`
- probe `/health`, `/ready`, `/v1/models`, and `/metrics`
- normalize Prometheus metrics if the runtime exposes them

What Roo cannot do yet:

- ask the runtime to acquire a model explicitly
- control placement to the correct disk by policy
- ask for model load or swap progress
- distinguish "runtime process exists" from "requested model is actually ready"
- rely on a stable runtime capability contract

### Ops Control Plane

The local ops layer already has meaningful runtime management surfaces:

- `GET /presets`
- `GET /presets/active`
- `POST /presets/activate/{preset_id}`
- `GET /mode`
- `GET /mode/history`
- `GET /mode/drift`
- `POST /runtime/hold`
- `DELETE /runtime/hold`
- `GET /runtime/hold`
- `GET /inference/live`
- `GET /runtime/backend`
- `GET /models/mlx`
- `GET /models/hf-cache`
- `DELETE /models/hf-cache/{entry_id}`

That means this machine already has a real control plane concept. Roo should
use it instead of pretending the only available contract is "start one detached
runtime process and probe a port."

### Runtime Server

The live runtime itself currently exposes:

- `GET /health`
- `GET /v1/models`

Observed live behavior during this audit:

- `GET /health` returns process/model status such as:
    - `status`
    - `model_loaded`
    - `model_name`
    - `model_type`
- `GET /v1/models` returns a minimal OpenAI-style model list
- `GET /metrics` on the current live runtime returned `404`
- a stable `GET /ready` contract is not currently present on the runtime

## Gap Matrix Against `RUNTIME_REQUESTS.md`

### 1. Managed Runtime Lifecycle Contract

**Current state**

- Roo can start or reuse a detached process.
- Ops can activate presets and report the active preset/model state.

**Gap**

- No single idempotent runtime status contract
- No explicit `loading`, `warming`, `ready`, `failed` state machine
- No operation ID or progress contract for long-running model loads
- No clean `unload model` or `list loaded models` contract

**Required next step**

Define one authoritative status shape for Roo to consume, preferably from ops:

- requested preset/model
- active preset/model
- backend
- runtime process state
- readiness state
- failure reason
- resident models
- current operation and progress, when applicable

### 2. First-Class Model Acquisition

**Current state**

- Roo can only pass a model string to `vllm-mlx serve`
- Ops can inspect local MLX models and Hugging Face cache entries

**Gap**

- No runtime-native acquire/resume API
- No download size estimate contract
- No integrity/finalization contract
- No authoritative "already local" or "where is it stored" API

**Required next step**

Add a first-class model acquisition API:

- acquire by Hugging Face repo ID
- query presence/path
- resume partial download
- report download size and progress
- report final model path and storage root

### 3. Storage Placement And Disk Policy

**Current state**

- Storage policy exists operationally on this machine, but Roo cannot query or
  enforce it through the runtime

**Gap**

- No API for:
    - model roots
    - free-space planning
    - removable-media policy
    - preferred root with fallback root(s)
    - atomic finalize/promote

**Required next step**

Expose storage policy as runtime state, not tribal knowledge.

### 4. Model Swap / Load Semantics

**Current state**

- Ops can activate presets and report active preset/model
- Runtime load/swap behavior is still inferred from process restarts, state
  files, and logs

**Gap**

- No explicit load progress surface
- No standard "this swap will evict X" contract
- No stable structured failure reason for load/swap failures

**Required next step**

Make preset activation and runtime load state machine-readable enough for Roo to
automate against directly.

### 5. Health And Readiness Contract

**Current state**

- Roo doctor already probes `/health`, `/ready`, `/v1/models`, and `/metrics`
- The runtime currently provides `/health` and `/v1/models`

**Gap**

- `/ready` is not stable on the live runtime
- `/metrics` is not currently present on the live runtime
- `/v1/models` is too weak to act as full readiness or discovery
- current health is process-oriented, not target-model-oriented

**Required next step**

Promote a real readiness contract:

- health = server process up
- ready = requested preset/model actually usable
- false readiness must include a reason

### 6. First-Class Model Discovery

**Current state**

- Runtime `/v1/models` returns active model IDs
- Ops `/presets` returns richer preset information including display names and
  model IDs

**Gap**

- No capability metadata at runtime discovery level
- No clear Anthropic-compatible discovery story
- No direct "served default" vs "resident alternatives" contract

**Required next step**

Expose a discovery surface that includes:

- model ID
- preset ID / alias
- capabilities
- max context
- default/active status

### 7. Unified Observability

**Current state**

- Roo can normalize Prometheus metrics into `gen_ai.local.*`
- Ops has its own health and status surfaces

**Gap**

- The live runtime currently does not expose a working `/metrics`
- Load/download/model lifecycle metrics are not a stable runtime contract
- TTFT/decode/load queue semantics are not guaranteed across engines

**Required next step**

Restore or add runtime-native metrics before asking Roo to treat observability
as production-ready.

### 8. Structured Errors And Events

**Current state**

- Roo returns hints based on failed probes
- Ops and runtime write logs

**Gap**

- No standard error codes
- No lifecycle events for download/load/swap
- No structured failure payload for common operational errors

**Required next step**

Define machine-readable event and error payloads before expanding automation on
top of runtime operations.

### 9. Install And Packaging Story

**Current state**

- Roo can install `vllm-mlx` with `uv tool install`

**Gap**

- That is not the same thing as a stable operator-facing packaging story
- No agreed release channel, stable binary naming, or version handshake between
  Roo and the runtime

**Required next step**

Define one recommended install story and make Roo detect/report runtime version
explicitly.

### 10. Local-First Auth Behavior

**Current state**

- Roo already supports loopback/no-key local use
- Roo passes `HF_TOKEN` through to managed runtime start

**Gap**

- There is no runtime-native gated-model acquisition/auth contract
- Auth failures are not yet structured enough for automation

**Required next step**

Keep the local-first default, but expose explicit gated-acquisition auth state.

## What Roo Should Assume Today

Until the production contract is finished:

1. Prefer the ops control plane when it is available locally.
2. Treat preset IDs such as `fast-qwen`, `fast-qwen36`, `coding-quality`, and
   `coding-heavy` as runtime-owned aliases.
3. Do not hardcode current preset-to-model mappings inside Roo.
4. Treat direct detached `vllm-mlx serve ...` startup as a fallback bootstrap
   path, not the primary production contract.
5. Do not claim readiness from "health OK" alone.
6. Do not treat `/v1/models` returning one ID as full discovery.

## Recommended Contract Shape

The smallest useful production contract is not a rewrite. It is:

### Roo

- ~~add an ops-backed runtime adapter~~ **Done (2026-04-23)**
- ~~prefer preset-based selection over raw model-ID selection when ops is present~~ **Done (2026-04-23)**
- ~~treat the current managed detached runtime path as fallback/bootstrap~~ **Done (2026-04-23)**

Implementation:

- `apps/cli/src/lib/ops-control-plane.ts` — typed readiness client (`getOpsReadiness`, `pollOpsReadiness`) consuming `GET /runtime/readiness`
- `apps/cli/src/commands/cli/use.ts` — preset activation polls readiness until `--wait-seconds` expires; returns `ready` only when `readiness.ready && preset.active === requested && model_id matches`; bare preset aliases fail closed when ops is absent
- Branch: `codex/local-private-roadmap`

### Ops

- keep `/presets` and `/presets/active` as first-class
- ~~add one consolidated runtime status/readiness endpoint~~ **Done (2026-04-23)** — `GET /runtime/readiness` on `:8001`
- make preset activation return structured operation state
- expose model acquisition and storage-planning APIs

### Runtime

- provide stable `/ready`
- restore or add stable `/metrics`
- expose richer model discovery and capability metadata

## Suggested Immediate Work Order

### Phase 1 — **Implemented**

- ~~Roo: add an ops control-plane adapter for `roo use`~~ **Done (2026-04-23)**
- ~~Ops: add a consolidated runtime status/readiness payload~~ **Done (2026-04-23)**
- Runtime: restore a stable `/metrics` surface and add `/ready` — **Runtime-owned, not yet delivered**

### Phase 2

- Ops/runtime: add first-class model acquisition + storage placement APIs
- Roo: consume those APIs instead of assuming direct runtime download behavior

### Phase 3

- unify structured events and errors
- expose stable capability discovery for OpenAI-compatible and
  Anthropic-compatible consumers

## Bottom Line

`roo use` is a good first slice, but it is not yet the production runtime
control plane described in [`RUNTIME_REQUESTS.md`](./RUNTIME_REQUESTS.md).

The path forward is not to make Roo more magical. It is to make the runtime and
ops layers explicit enough that Roo can become a thin, reliable operator over a
real local inference platform.
