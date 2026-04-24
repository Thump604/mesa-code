# Mesa Code

Mesa Code is an early public fork of Roo Code focused on one narrow goal:
building a terminal-native coding agent that treats local AI runtimes as
first-class systems, not just endpoint URLs.

The project is being shaped for developers who run local or self-hosted models
and want the agent to know what is actually running: which model was requested,
which model is active, whether it is ready, which runtime features are
qualified, and how tool approvals behave across CLI, TUI, and automation
surfaces.

## Status

This fork is in active development and is not packaged as a stable release yet.
The public roadmap is a draft and will change as the CLI architecture settles.

The product name is **Mesa Code**. The repository still contains forked Roo Code
package names and compatibility paths while the rename is staged. The intended
CLI command is `mesa`; `roo` will remain a compatibility alias during migration.

See [ROADMAP.md](ROADMAP.md) for the current public plan.

## Direction

- CLI and TUI first
- local/self-hosted runtimes first
- no required cloud account in the happy path
- OpenAI-compatible and Anthropic-compatible local endpoint support
- runtime readiness and model identity checks before claiming success
- first-class support for local runtime observability
- stable text, JSON, and stream contracts for automation
- explicit user control over tools, approvals, model selection, and config
- editor integration later, after the CLI core is solid

## Local Runtime Goals

Mesa Code is being shaped around local model engines such as:

- `vllm-mlx`
- `llama.cpp`
- OpenAI-compatible local servers
- Anthropic-compatible local servers

The CLI should not hide local runtime complexity behind fake green buttons. If
a runtime feature is not qualified, the CLI should say so clearly and fail
closed.

## Why Not Just Another Coding CLI?

Pi is impressively light. OpenCode and Kilo Code are strong agent CLIs. Mesa
Code is aimed at a different gap: the local runtime/operator layer.

The goal is for the CLI to understand:

- what model was requested
- what model is actually serving
- whether the requested model is ready
- whether runtime features are qualified for that model
- what the runtime health and queue state look like
- whether approval behavior is consistent across TUI, CLI, and stream modes

That makes local inference easier to trust and easier to automate.

## Development

Prerequisites:

- Node.js 20.x
- `pnpm`

Install dependencies:

```bash
pnpm install
```

Build the CLI:

```bash
pnpm --filter @roo-code/cli build
```

Run CLI checks:

```bash
pnpm --filter @roo-code/cli check-types
pnpm --filter @roo-code/cli test
```

Run monorepo checks:

```bash
pnpm check-types
pnpm lint
```

## Repository Layout

- [apps/cli](apps/cli) - terminal CLI and TUI work
- [src](src) - existing Roo extension/runtime code being carved apart
- [packages/core](packages/core) - shared core logic
- [packages/types](packages/types) - shared contracts and provider/model types
- [webview-ui](webview-ui) - upstream webview UI retained while the fork narrows
- [ROADMAP.md](ROADMAP.md) - public draft roadmap

## Contributing

This fork is not ready for broad drive-by contribution yet, but focused
collaboration is welcome around:

- CLI/TUI session architecture
- local runtime adapters
- terminal UX
- model/runtime observability
- privacy-first defaults
- tests for command-line and PTY behavior

Open an issue or discussion before starting large changes so the work lines up
with the fork direction.

## License

This repository remains under the upstream [Apache 2.0](LICENSE) license.
