# Roo Code Local CLI Fork

This is an early public fork of Roo Code focused on one narrow goal:
building a strong local/private-first coding CLI.

The project direction is intentionally different from maintaining the full
upstream VS Code extension surface. The priority is a terminal-native agent
that works well with local and self-hosted model runtimes, keeps private work
local by default, and exposes predictable command-line behavior for both humans
and automation.

## Status

This fork is in active development and is not packaged as a stable release yet.
The public roadmap is a draft and will change as the CLI architecture settles.

See [ROADMAP.md](ROADMAP.md) for the current public plan.

## Direction

- CLI and TUI first
- local/self-hosted runtimes first
- no required cloud account in the happy path
- OpenAI-compatible and Anthropic-compatible local endpoint support
- first-class support for local runtime observability
- stable text, JSON, and stream contracts for automation
- explicit user control over tools, approvals, model selection, and config
- editor integration later, after the CLI core is solid

## Local Runtime Goals

The fork is being shaped around local model engines such as:

- `vllm-mlx`
- `llama.cpp`
- OpenAI-compatible local servers
- Anthropic-compatible local servers

The CLI should not hide local runtime complexity behind fake green buttons. If
a runtime feature is not qualified, the CLI should say so clearly and fail
closed.

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
