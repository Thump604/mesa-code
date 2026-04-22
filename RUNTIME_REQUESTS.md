# Runtime Requests For Zero-Friction Local AI

## Purpose

This fork is trying to become a local/private-first coding CLI. The biggest
product risk is not prompt UX or TUI polish. It is runtime quality.

This is especially relevant now that `Qwen3.6` is live and should be treated as
one of the primary frontier agentic targets for local/private coding workflows.
If the runtime cannot make `Qwen3.6` easy to acquire, place, start, swap, and
observe, then the platform is not meeting the current bar.

Today, running local AI well across machines is still too manual:

- install steps are inconsistent
- model download and placement are ad hoc
- runtime health and readiness are underspecified
- model swap behavior differs by engine
- observability is fragmented

If the runtime layer improves, the fork can build a much better operator and
end-user experience on top of it. If it does not, the CLI will keep carrying
too much workaround logic.

## Product Goal

The target experience is:

```bash
roo use fast-qwen
```

And the stack should:

1. detect or install the runtime
2. detect whether the model is already local
3. download it from Hugging Face if needed
4. place it on the correct disk by policy
5. start or reuse the runtime
6. load or swap the target model
7. verify readiness
8. expose one clean health and metrics contract

That requires stronger runtime primitives than we have now.

## Immediate Reality Check: Qwen3.6

`Qwen3.6` should be treated as a flagship runtime target, not a corner case.
That means runtime quality now needs to cover all of the following for a large,
modern, agent-oriented model family:

- predictable download and resume behavior
- correct disk placement for very large model assets
- explicit load/swap semantics for resident lanes
- readiness that reflects the requested model, not just a running process
- strong metrics around load time, queueing, TTFT, decode speed, and memory use
- correct capability reporting for coding, reasoning, tool use, and vision

If these features are weak, the user experience degrades exactly where the
market is currently paying attention.

## Highest-Priority Requests

### 1. Managed Runtime Lifecycle Contract

Need a stable, machine-readable control surface for:

- `start`
- `stop`
- `restart`
- `status`
- `load model`
- `swap model`
- `unload model`
- `list loaded models`
- `show active model`

Requirements:

- idempotent operations
- structured JSON output
- explicit state transitions
- no silent fallback to a different default model
- clear distinction between "process is running" and "requested model is ready"

## 2. First-Class Model Acquisition

Need runtime-native support for pulling models by Hugging Face repo/model id.

Requirements:

- start download from repo id
- resume partial downloads
- progress reporting
- size estimation before download
- checksum or integrity verification
- gated-model auth through `HF_TOKEN`
- query whether a model is already present locally
- query where the model is stored on disk

The CLI should not have to reinvent model download orchestration if the runtime
can own it cleanly.

### 3. Storage Placement And Disk Policy

Need explicit runtime support for model placement.

Requirements:

- configurable model root(s)
- report free space before pull
- identify whether a target path is removable/external
- allow policy like:
    - internal SSD only
    - external allowed
    - preferred root with fallback roots
- atomic finalize/promote after successful download
- never silently place large resident models on removable media unless allowed

The current local-AI norm of "somewhere under cache dirs, maybe on the wrong
disk" is not acceptable.

### 4. Model Swap / Load Semantics

Need runtime-reported capabilities per engine and per model lane.

Requirements:

- indicate whether the runtime supports hot swap or requires restart
- expose "loading", "warming", "ready", "failed" states
- show whether a swap is evicting another resident model
- expose load progress and failure reason
- avoid silent process restarts without a structured event

This matters especially for `vllm-mlx`, where model swap is a core advantage.
It also matters directly for `Qwen3.6`, which is precisely the kind of model
family users will want to keep on a fast resident lane and swap deliberately.

### 5. Health And Readiness Contract

Need a stable readiness contract that is stronger than "port is open".

Required surfaces:

- `/health`
- `/ready`
- `/models`
- `/metrics`

Requirements:

- health means process up
- ready means target model actually usable
- readiness should include failure reason when false
- model list should reflect what is truly active, not stale intent
- all of this should be stable enough for operators to automate against

### 6. First-Class Model Discovery

Need real model discovery for both OpenAI-compatible and Anthropic-compatible
contracts.

Requirements:

- list model ids
- indicate served/default model
- include capability metadata when possible:
    - text
    - vision
    - tool calling
    - reasoning
    - embeddings
    - max context
- no fake discovery path that returns misleading defaults

Anthropic-compatible local runtimes especially need a better discovery story.
That matters for `Qwen3.6` too, because users increasingly want to run frontier
open models behind both OpenAI-style and Anthropic-style tooling surfaces.

### 7. Unified Observability

Need runtime-native metrics that can be normalized into one operator standard.

Requirements:

- stable Prometheus metrics
- optional OpenTelemetry export or clean mapping guidance
- standard counters/gauges for:
    - requests
    - active sequences
    - queued requests
    - TTFT
    - decode latency
    - prompt tokens
    - completion tokens
    - cache usage
    - GPU or unified memory usage
    - model load duration
    - download duration
- consistent labels for:
    - runtime
    - model
    - backend
    - status/result

The CLI can normalize metrics, but the runtime must expose real ones first.
For `Qwen3.6`-class workloads, this is not optional. Operators need to know
whether the runtime is downloading, loading, warming, memory-bound, or simply
stalled.

### 8. Structured Errors And Events

Need machine-readable failure and progress output.

Requirements:

- explicit error codes
- download progress events
- load progress events
- startup failure reason
- model incompatibility reason
- auth failure reason for gated downloads
- storage-insufficient reason

Stringly-typed stderr is not enough for a serious control plane.

### 9. Install And Packaging Story

Need a runtime install path that is easy enough for normal users.

Requirements:

- one recommended install method
- versioned releases
- stable binary names
- version command
- clear upgrade path
- architecture support matrix

The local AI ecosystem keeps losing users here. Good runtime quality includes
distribution quality.

### 10. Local-First Auth Behavior

Need local operation to work without cloud assumptions.

Requirements:

- no mandatory account login for local use
- local loopback operation with placeholder or disabled API keys where valid
- `HF_TOKEN` support for gated model pulls
- no remote telemetry requirement

## Nice-To-Have Requests

### A. Dry-Run Planning

Ability to ask the runtime:

- what would be downloaded
- how large it is
- where it would go
- whether enough space exists
- whether a swap or restart would be needed

before actually changing anything.

### B. Runtime Capability Introspection

Expose capabilities such as:

- supports hot swap
- supports Anthropic Messages API
- supports OpenAI Chat Completions
- supports embeddings
- supports tool calling
- supports vision
- supports audio

That lets the CLI adapt behavior honestly instead of guessing.

### C. Explicit Cache And Cleanup Commands

Need runtime-native cache management for:

- list local models
- show model size
- prune unused downloads
- delete model from disk

## What The CLI Will Build On Top

If the runtime provides the above, the CLI can own:

- `roo use`
- model presets
- placement policy selection
- unified observability
- zero-friction first run
- session-aware model/routing choices
- operator UX

The CLI should not be forced to become a second inference runtime just to make
the product usable.

## Bottom Line

The request is simple:

give local/private operators a real runtime contract, not just a raw inference
server.

`Qwen3.6` is the concrete test case. If the runtime stack can make that model
family feel straightforward and reliable, the platform is on the right track.
If not, the product will keep feeling brittle no matter how good the CLI is.

That is the difference between:

- "a local endpoint exists"

and

- "this actually works as a product."
