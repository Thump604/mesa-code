import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

import pWaitFor from "p-wait-for"

import type { TaskSessionEntry } from "@roo-code/core/cli"
import type { Command, ModelRecord, WebviewMessage } from "@roo-code/types"
import { getProviderDefaultModelId } from "@roo-code/types"

import { ExtensionHost, type ExtensionHostOptions } from "@/agent/index.js"
import { readWorkspaceTaskSessions } from "@/lib/task-history/index.js"
import { loadSettings, loadToken } from "@/lib/storage/index.js"
import { getDefaultExtensionPath } from "@/lib/utils/extension.js"
import { getApiKeyFromEnv } from "@/lib/utils/provider.js"
import { isRecord } from "@/lib/utils/guards.js"
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

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const REQUEST_TIMEOUT_MS = 10_000

type ListFormat = "json" | "text"

type BaseListOptions = {
	workspace?: string
	extension?: string
	apiKey?: string
	provider?: SupportedProvider
	protocol?: SupportedApiStandard
	runtime?: SupportedLocalRuntime
	baseUrl?: string
	format?: string
	debug?: boolean
}

type CommandLike = Pick<Command, "name" | "source" | "filePath" | "description" | "argumentHint">
type ModeLike = { slug: string; name: string }
type SessionLike = TaskSessionEntry
type ListHostOptions = { ephemeral: boolean }

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

function resolveExtensionPath(extension: string | undefined): string {
	const resolved = path.resolve(extension || getDefaultExtensionPath(__dirname))

	if (!fs.existsSync(path.join(resolved, "extension.js"))) {
		throw new Error(`Extension bundle not found at: ${resolved}`)
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

async function createListHost(options: BaseListOptions, hostOptions: ListHostOptions): Promise<ExtensionHost> {
	validateProtocolAndRuntime(options)

	const workspacePath = resolveWorkspacePath(options.workspace)
	const extensionPath = resolveExtensionPath(options.extension)
	const rooToken = await loadToken()
	const settings = await loadSettings()
	const protocol = resolveEffectiveProtocol(options.protocol, options.provider, settings)
	const runtime = resolveEffectiveRuntime(options.runtime, settings)
	const provider = resolveEffectiveProvider(options.provider, settings, Boolean(rooToken), protocol, runtime)
	const baseUrl = resolveConfiguredBaseUrl(options.baseUrl, settings, protocol)
	const model =
		resolveEffectiveModel(undefined, settings, provider, baseUrl, runtime) || getProviderDefaultModelId(provider)
	const apiKey =
		(provider === "roo" ? rooToken : undefined) ||
		resolveConfiguredApiKey(provider, options.apiKey, settings, getApiKeyFromEnv(provider), baseUrl)

	const extensionHostOptions: ExtensionHostOptions = {
		mode: "code",
		reasoningEffort: undefined,
		user: null,
		provider,
		model,
		apiKey,
		baseUrl,
		workspacePath,
		extensionPath,
		nonInteractive: true,
		ephemeral: hostOptions.ephemeral,
		debug: options.debug ?? false,
		exitOnComplete: true,
		exitOnError: false,
		disableOutput: true,
	}

	const host = new ExtensionHost(extensionHostOptions)

	await host.activate()

	// Best effort wait; mode/commands requests can still succeed without this.
	await pWaitFor(() => host.client.isInitialized(), {
		interval: 25,
		timeout: 2_000,
	}).catch(() => undefined)

	return host
}

/**
 * Send a request to the extension and wait for a matching response message.
 * Returns `undefined` from `extract` to skip non-matching messages, or the
 * parsed value to resolve the promise.
 */
function requestFromExtension<T>(
	host: ExtensionHost,
	requestMessage: WebviewMessage,
	extract: (message: Record<string, unknown>) => T | undefined,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false
		const requestType = requestMessage.type

		const cleanup = () => {
			clearTimeout(timeoutId)
			host.off("extensionWebviewMessage", onMessage)
			offError()
		}

		const finish = (fn: () => void) => {
			if (settled) return
			settled = true
			cleanup()
			fn()
		}

		const onMessage = (message: unknown) => {
			if (!isRecord(message)) {
				return
			}

			let result: T | undefined
			try {
				result = extract(message)
			} catch (error) {
				finish(() => reject(error instanceof Error ? error : new Error(String(error))))
				return
			}

			if (result !== undefined) {
				finish(() => resolve(result))
			}
		}

		const offError = host.client.on("error", (error) => {
			finish(() => reject(error))
		})

		const timeoutId = setTimeout(() => {
			finish(() =>
				reject(new Error(`Timed out waiting for ${requestType} response after ${REQUEST_TIMEOUT_MS}ms`)),
			)
		}, REQUEST_TIMEOUT_MS)

		host.on("extensionWebviewMessage", onMessage)
		host.sendToExtension(requestMessage)
	})
}

function requestCommands(host: ExtensionHost): Promise<CommandLike[]> {
	return requestFromExtension(host, { type: "requestCommands" }, (message) => {
		if (message.type !== "commands") {
			return undefined
		}
		return Array.isArray(message.commands) ? (message.commands as CommandLike[]) : []
	})
}

function requestModes(host: ExtensionHost): Promise<ModeLike[]> {
	return requestFromExtension(host, { type: "requestModes" }, (message) => {
		if (message.type !== "modes") {
			return undefined
		}
		return Array.isArray(message.modes) ? (message.modes as ModeLike[]) : []
	})
}

function requestRouterModels(host: ExtensionHost, provider: "openrouter" | "vercel-ai-gateway"): Promise<ModelRecord> {
	return requestFromExtension(host, { type: "requestRouterModels", values: { provider } }, (message) => {
		if (message.type !== "routerModels") {
			return undefined
		}

		const routerModels = isRecord(message.routerModels) ? message.routerModels : undefined
		const providerModels = routerModels?.[provider]
		return isRecord(providerModels) ? (providerModels as ModelRecord) : {}
	})
}

function requestRooModels(host: ExtensionHost): Promise<ModelRecord> {
	return requestFromExtension(host, { type: "requestRooModels" }, (message) => {
		if (message.type !== "singleRouterModelFetchResponse") {
			return undefined
		}

		const values = isRecord(message.values) ? message.values : undefined
		if (values?.provider !== "roo") {
			return undefined
		}

		if (message.success === false) {
			const errorMessage =
				typeof message.error === "string" && message.error.length > 0
					? message.error
					: "Failed to fetch Roo models"
			throw new Error(errorMessage)
		}

		return isRecord(values.models) ? (values.models as ModelRecord) : {}
	})
}

function requestOpenAiModels(host: ExtensionHost, baseUrl: string, apiKey: string): Promise<ModelRecord> {
	return requestFromExtension(host, { type: "requestOpenAiModels", values: { baseUrl, apiKey } }, (message) => {
		if (message.type !== "openAiModels") {
			return undefined
		}

		return isRecord(message.openAiModels) ? (message.openAiModels as ModelRecord) : {}
	})
}

async function withHostAndSignalHandlers<T>(
	options: BaseListOptions,
	hostOptions: ListHostOptions,
	fn: (host: ExtensionHost) => Promise<T>,
): Promise<T> {
	const host = await createListHost(options, hostOptions)

	const shutdown = async (exitCode: number) => {
		await host.dispose()
		process.exit(exitCode)
	}

	const onSigint = () => void shutdown(130)
	const onSigterm = () => void shutdown(143)

	process.on("SIGINT", onSigint)
	process.on("SIGTERM", onSigterm)

	try {
		return await fn(host)
	} finally {
		process.off("SIGINT", onSigint)
		process.off("SIGTERM", onSigterm)
		await host.dispose()
	}
}

export async function listCommands(options: BaseListOptions): Promise<void> {
	const format = parseFormat(options.format)

	await withHostAndSignalHandlers(options, { ephemeral: true }, async (host) => {
		const commands = await requestCommands(host)

		if (format === "json") {
			outputJson({ commands })
			return
		}

		outputCommandsText(commands)
	})
}

export async function listModes(options: BaseListOptions): Promise<void> {
	const format = parseFormat(options.format)

	await withHostAndSignalHandlers(options, { ephemeral: true }, async (host) => {
		const modes = await requestModes(host)

		if (format === "json") {
			outputJson({ modes })
			return
		}

		outputModesText(modes)
	})
}

export async function listModels(options: BaseListOptions): Promise<void> {
	const format = parseFormat(options.format)

	await withHostAndSignalHandlers(options, { ephemeral: true }, async (host) => {
		let models: ModelRecord
		const { provider, baseUrl, apiKey } = host.getRuntimeOptions()

		if (provider === "openai") {
			if (!apiKey) {
				throw new Error("OpenAI-compatible model listing requires an API key or local placeholder resolution")
			}

			models = await requestOpenAiModels(host, baseUrl ?? "https://api.openai.com/v1", apiKey)
		} else if (provider === "anthropic") {
			throw new Error(
				"Model listing is not standardized for Anthropic-compatible endpoints yet; set --model explicitly for your runtime.",
			)
		} else if (provider === "openrouter" || provider === "vercel-ai-gateway") {
			models = await requestRouterModels(host, provider)
		} else if (provider === "roo") {
			models = await requestRooModels(host)
		} else {
			throw new Error(`Model listing is not yet supported for provider: ${provider}`)
		}

		if (format === "json") {
			outputJson({ models })
			return
		}

		outputModelsText(models)
	})
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
