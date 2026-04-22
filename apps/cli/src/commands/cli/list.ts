import fs from "fs"
import path from "path"

import type { TaskSessionEntry } from "@roo-code/core/cli"
import { type ModelRecord, getProviderDefaultModelId } from "@roo-code/types"

import { getCliCommands } from "@/lib/discovery/commands.js"
import { getAnthropicCompatibleModels, getOpenAiCompatibleModels, getRouterModels } from "@/lib/discovery/models.js"
import { loadCliModes } from "@/lib/discovery/modes.js"
import { readWorkspaceTaskSessions } from "@/lib/task-history/index.js"
import { loadSettings } from "@/lib/storage/index.js"
import { getApiKeyFromEnv } from "@/lib/utils/provider.js"
import {
	resolveConfiguredApiKey,
	resolveConfiguredBaseUrl,
	resolveEffectiveModel,
	resolveEffectiveProtocol,
	resolveEffectiveProvider,
	resolveEffectiveRuntime,
} from "@/lib/utils/runtime-config.js"
import {
	isSupportedApiStandard,
	isSupportedLocalRuntime,
	supportedApiStandards,
	supportedLocalRuntimes,
	type SupportedApiStandard,
	type SupportedLocalRuntime,
	type SupportedProvider,
} from "@/types/index.js"

type ListFormat = "json" | "text"

type BaseListOptions = {
	workspace?: string
	apiKey?: string
	provider?: SupportedProvider
	protocol?: SupportedApiStandard
	runtime?: SupportedLocalRuntime
	baseUrl?: string
	format?: string
	debug?: boolean
}

type CommandLike = Awaited<ReturnType<typeof getCliCommands>>[number]
type ModeLike = { slug: string; name: string }
type SessionLike = TaskSessionEntry

export function parseFormat(rawFormat: string | undefined): ListFormat {
	const format = (rawFormat ?? "json").toLowerCase()
	if (format === "json" || format === "text") {
		return format
	}

	throw new Error(`Invalid format: ${rawFormat}. Must be "json" or "text".`)
}

function resolveWorkspacePath(workspace: string | undefined): string {
	const resolved = workspace ? path.resolve(workspace) : process.cwd()

	if (!fs.existsSync(resolved)) {
		throw new Error(`Workspace path does not exist: ${resolved}`)
	}

	return resolved
}

function validateProtocolAndRuntime(options: BaseListOptions): void {
	const protocol = options.protocol
	if (protocol && !isSupportedApiStandard(protocol)) {
		throw new Error(`Invalid protocol: ${protocol}; must be one of: ${supportedApiStandards.join(", ")}`)
	}

	const runtime = options.runtime
	if (runtime && !isSupportedLocalRuntime(runtime)) {
		throw new Error(`Invalid runtime: ${runtime}; must be one of: ${supportedLocalRuntimes.join(", ")}`)
	}

	if (
		protocol &&
		options.provider &&
		(options.provider === "openai" || options.provider === "anthropic") &&
		options.provider !== protocol
	) {
		throw new Error(
			`--provider ${options.provider} conflicts with --protocol ${protocol}; use matching values or omit --provider`,
		)
	}

	if (runtime && options.provider && !["openai", "anthropic"].includes(options.provider)) {
		throw new Error("--runtime only applies to openai/anthropic-compatible endpoint modes")
	}

	if (protocol && options.provider && !["openai", "anthropic"].includes(options.provider)) {
		throw new Error("--protocol only applies when using openai/anthropic-compatible endpoint modes")
	}
}

function outputJson(data: unknown): void {
	process.stdout.write(JSON.stringify(data, null, 2) + "\n")
}

function outputCommandsText(commands: CommandLike[]): void {
	for (const command of commands) {
		const description = command.description ? ` - ${command.description}` : ""
		process.stdout.write(`/${command.name} (${command.source})${description}\n`)
	}
}

function outputModesText(modes: ModeLike[]): void {
	for (const mode of modes) {
		process.stdout.write(`${mode.slug}\t${mode.name}\n`)
	}
}

function outputModelsText(models: ModelRecord): void {
	for (const modelId of Object.keys(models).sort()) {
		process.stdout.write(`${modelId}\n`)
	}
}

function formatSessionTitle(task: string): string {
	const compact = task.replace(/\s+/g, " ").trim()

	if (!compact) {
		return "(untitled)"
	}

	return compact.length <= 120 ? compact : `${compact.slice(0, 117)}...`
}

function outputSessionsText(sessions: SessionLike[]): void {
	for (const session of sessions) {
		const startedAt = Number.isFinite(session.ts) ? new Date(session.ts).toISOString() : "unknown-time"
		process.stdout.write(`${session.id}\t${startedAt}\t${formatSessionTitle(session.task)}\n`)
	}
}

async function resolveModelOptions(options: BaseListOptions) {
	validateProtocolAndRuntime(options)

	const settings = await loadSettings()
	const protocol = resolveEffectiveProtocol(options.protocol, options.provider, settings)
	const runtime = resolveEffectiveRuntime(options.runtime, settings)
	const provider = resolveEffectiveProvider(options.provider, settings, protocol, runtime)
	const baseUrl = resolveConfiguredBaseUrl(options.baseUrl, settings, protocol)
	const model =
		resolveEffectiveModel(undefined, settings, provider, baseUrl, runtime) || getProviderDefaultModelId(provider)
	const apiKey = resolveConfiguredApiKey(provider, options.apiKey, settings, getApiKeyFromEnv(provider), baseUrl)

	return { provider, protocol, runtime, baseUrl, model, apiKey }
}

export async function listCommands(options: BaseListOptions): Promise<void> {
	const format = parseFormat(options.format)
	const workspacePath = resolveWorkspacePath(options.workspace)
	const commands = await getCliCommands(workspacePath)

	if (format === "json") {
		outputJson({ commands })
		return
	}

	outputCommandsText(commands)
}

export async function listModes(options: BaseListOptions): Promise<void> {
	const format = parseFormat(options.format)
	const workspacePath = resolveWorkspacePath(options.workspace)
	const modes = (await loadCliModes(workspacePath)).map(({ slug, name }) => ({ slug, name }))

	if (format === "json") {
		outputJson({ modes })
		return
	}

	outputModesText(modes)
}

export async function listModels(options: BaseListOptions): Promise<void> {
	const format = parseFormat(options.format)
	const { provider, baseUrl, apiKey } = await resolveModelOptions(options)

	let models: ModelRecord

	if (provider === "openai") {
		if (!apiKey) {
			throw new Error("OpenAI-compatible model listing requires an API key or local placeholder resolution")
		}

		models = await getOpenAiCompatibleModels(baseUrl ?? "https://api.openai.com/v1", apiKey)
	} else if (provider === "anthropic") {
		if (!apiKey) {
			throw new Error("Anthropic-compatible model listing requires an API key or local placeholder resolution")
		}

		models = await getAnthropicCompatibleModels(baseUrl ?? "https://api.anthropic.com", apiKey)
	} else if (provider === "openrouter" || provider === "vercel-ai-gateway") {
		models = await getRouterModels(provider, {
			...(apiKey ? { apiKey } : {}),
			...(baseUrl ? { baseUrl } : {}),
		})
	} else {
		throw new Error(`Model listing is not yet supported for provider: ${provider}`)
	}

	if (format === "json") {
		outputJson({ models })
		return
	}

	outputModelsText(models)
}

export async function listSessions(options: BaseListOptions): Promise<void> {
	const format = parseFormat(options.format)
	const workspacePath = resolveWorkspacePath(options.workspace)
	const sessions = await readWorkspaceTaskSessions(workspacePath)

	if (format === "json") {
		outputJson({ workspace: workspacePath, sessions })
		return
	}

	outputSessionsText(sessions)
}
