import fs from "fs"
import path from "path"
import { EventEmitter } from "events"
import { createRequire } from "module"
import { fileURLToPath } from "url"

import type {
	ClineAsk,
	ClineMessage,
	ExtensionMessage,
	RooCodeEventName,
	RooCodeSettings,
	TokenUsage,
	ToolUsage,
	WebviewMessage,
} from "@roo-code/types"
import { createVSCodeAPI, clearRuntimeConfig, setRuntimeConfigValues } from "@roo-code/vscode-shim"
import {
	DebugLogger,
	setDebugLogEnabled,
	type TaskSessionEntry,
	readTaskSessionsFromStoragePath,
} from "@roo-code/core/cli"

import { DEFAULT_FLAGS, type SupportedProvider } from "@/types/index.js"
import { createEphemeralStorageDir } from "@/lib/storage/index.js"
import { getProviderSettings } from "@/lib/utils/provider.js"
import { getCliCommands } from "@/lib/discovery/commands.js"
import { loadCliModes } from "@/lib/discovery/modes.js"
import { getAnthropicCompatibleModels, getOpenAiCompatibleModels, getRouterModels } from "@/lib/discovery/models.js"
import { filterSessionsForWorkspace } from "@/lib/task-history/index.js"
import type { AgentStateInfo } from "@/agent/agent-state.js"
import type { TaskCompletedEvent } from "@/agent/events.js"
import { ExtensionClient } from "@/agent/extension-client.js"
import type { JsonEventEmitter } from "@/agent/json-event-emitter.js"
import { searchWorkspaceFiles, type FileSearchResult, type SearchWorkspaceFilesOptions } from "@/runtime/file-search.js"

import type { CliRuntime, CliRuntimeOptions } from "./runtime.js"

const cliLogger = new DebugLogger("CLI")
const __dirname = path.dirname(fileURLToPath(import.meta.url))

type RuntimeMessageListener = (message: ExtensionMessage) => void
type RuntimeErrorListener = (error: Error) => void

type BundleApi = EventEmitter & {
	startNewTask(options: {
		configuration: RooCodeSettings
		text?: string
		images?: string[]
		newTab?: boolean
	}): Promise<string | undefined>
	resumeTask(taskId: string): Promise<void>
	clearCurrentTask(lastMessage?: string): Promise<void>
	cancelCurrentTask(): Promise<void>
	sendMessage(text?: string, images?: string[]): Promise<void>
	pressPrimaryButton(): Promise<void>
	pressSecondaryButton(): Promise<void>
	getConfiguration(): RooCodeSettings
	setConfiguration(values: RooCodeSettings): Promise<void>
	getCurrentTaskStack(): string[]
	isTaskInHistory(taskId: string): Promise<boolean>
}

type ExtensionModule = {
	activate(context: unknown): Promise<BundleApi>
	deactivate?(): Promise<void>
}

type ActivatedBundle = {
	api: BundleApi
	deactivate?: () => Promise<void>
}

export type BundleRuntimeDeps = {
	loadBundle: (options: CliRuntimeOptions & { storageDir?: string }) => Promise<ActivatedBundle>
	readTaskSessions: (globalStoragePath: string) => Promise<TaskSessionEntry[]>
	searchWorkspaceFiles: (options: SearchWorkspaceFilesOptions) => Promise<FileSearchResult[]>
}

const defaultDeps: BundleRuntimeDeps = {
	loadBundle: loadBundleApi,
	readTaskSessions: readTaskSessionsFromStoragePath,
	searchWorkspaceFiles,
}

function findCliPackageRoot(): string {
	let dir = __dirname

	while (dir !== path.dirname(dir)) {
		if (fs.existsSync(path.join(dir, "package.json"))) {
			return dir
		}

		dir = path.dirname(dir)
	}

	return path.resolve(__dirname, "..")
}

const CLI_PACKAGE_ROOT = process.env.ROO_CLI_ROOT || findCliPackageRoot()

function getDiscoveryProvider(
	provider: SupportedProvider,
): "openai" | "anthropic" | "openrouter" | "vercel-ai-gateway" | null {
	if (
		provider === "openai" ||
		provider === "anthropic" ||
		provider === "openrouter" ||
		provider === "vercel-ai-gateway"
	) {
		return provider
	}

	return null
}

async function loadBundleApi(options: CliRuntimeOptions & { storageDir?: string }): Promise<ActivatedBundle> {
	const bundlePath = path.join(options.extensionPath, "extension.js")
	if (!fs.existsSync(bundlePath)) {
		throw new Error(`Extension bundle not found at: ${bundlePath}`)
	}

	const vscode = createVSCodeAPI(options.extensionPath, options.workspacePath, undefined, {
		appRoot: CLI_PACKAGE_ROOT,
		storageDir: options.storageDir,
	})
	;(global as Record<string, unknown>).vscode = vscode

	const require = createRequire(import.meta.url)
	const Module = require("module")
	const originalResolve = Module._resolveFilename

	Module._resolveFilename = function (request: string, parent: unknown, isMain: boolean, resolverOptions: unknown) {
		if (request === "vscode") {
			return "vscode-mock"
		}

		return originalResolve.call(this, request, parent, isMain, resolverOptions)
	}

	require.cache["vscode-mock"] = {
		id: "vscode-mock",
		filename: "vscode-mock",
		loaded: true,
		exports: vscode,
		children: [],
		paths: [],
		path: "",
		isPreloading: false,
		parent: null,
		require,
	} as unknown as NodeJS.Module

	try {
		const extensionModule = require(bundlePath) as ExtensionModule
		const api = await extensionModule.activate(vscode.context)
		return {
			api,
			deactivate: extensionModule.deactivate,
		}
	} finally {
		Module._resolveFilename = originalResolve
	}
}

export class BundleApiCliRuntime implements CliRuntime {
	private readonly options: CliRuntimeOptions
	private readonly deps: BundleRuntimeDeps
	private readonly client: ExtensionClient
	private readonly runtimeMessageListeners = new Set<RuntimeMessageListener>()
	private readonly runtimeErrorListeners = new Set<RuntimeErrorListener>()
	private readonly loggedFirstPartials = new Set<number>()

	private api: BundleApi | null = null
	private deactivateBundle: (() => Promise<void>) | undefined
	private currentTaskId: string | null = null
	private currentMessages: ClineMessage[] = []
	private globalStoragePath: string | null = null
	private ephemeralStorageDir: string | null = null
	private previousCliRuntimeEnv: string | undefined
	private originalConsole: {
		log: typeof console.log
		warn: typeof console.warn
		error: typeof console.error
		debug: typeof console.debug
		info: typeof console.info
	} | null = null
	private originalProcessEmitWarning: typeof process.emitWarning | null = null

	constructor(options: CliRuntimeOptions, deps: Partial<BundleRuntimeDeps> = {}) {
		this.options = options
		this.deps = { ...defaultDeps, ...deps }

		this.previousCliRuntimeEnv = process.env.ROO_CLI_RUNTIME
		process.env.ROO_CLI_RUNTIME = "1"

		if (options.debug) {
			setDebugLogEnabled(true)
		}

		this.setupQuietMode()

		this.client = new ExtensionClient({
			sendMessage: (message) => this.sendToRuntime(message),
			debug: options.debug,
		})
	}

	async activate(): Promise<void> {
		if (this.api) {
			return
		}

		const initialSettings = this.buildInitialSettings()

		let storageDir: string | undefined
		if (this.options.ephemeral) {
			this.ephemeralStorageDir = await createEphemeralStorageDir()
			storageDir = this.ephemeralStorageDir
		}

		clearRuntimeConfig()
		setRuntimeConfigValues("roo-cline", initialSettings as Record<string, unknown>)

		const { api, deactivate } = await this.deps.loadBundle({ ...this.options, storageDir })
		this.api = api
		this.deactivateBundle = deactivate
		this.globalStoragePath = path.join(
			storageDir || path.join(process.env.HOME || process.env.USERPROFILE || ".", ".vscode-mock"),
			"global-storage",
		)

		this.registerApiEventHandlers(api)
		await api.setConfiguration({
			...api.getConfiguration(),
			...initialSettings,
		})
		await this.publishState({ includeMessages: true, includeTaskHistory: true })
	}

	runTask(prompt: string, taskId?: string, configuration?: RooCodeSettings, images?: string[]): Promise<void> {
		this.sendToRuntime({
			type: "newTask",
			text: prompt,
			taskId,
			taskConfiguration: configuration,
			...(images !== undefined ? { images } : {}),
		})
		return this.waitForTaskCompletion()
	}

	resumeTask(taskId: string): Promise<void> {
		this.sendToRuntime({ type: "showTaskWithId", text: taskId })
		return this.waitForTaskCompletion()
	}

	refreshCliMetadata(): void {
		void this.publishCliMetadata()
	}

	requestRooModels(): void {
		void this.publishRouterModels()
	}

	selectTask(taskId: string): void {
		this.sendToRuntime({ type: "showTaskWithId", text: taskId })
	}

	setMode(modeSlug: string): void {
		this.sendToRuntime({ type: "mode", text: modeSlug })
	}

	searchFiles(query: string): void {
		this.sendToRuntime({ type: "searchFiles", query })
	}

	clearTask(): void {
		this.client.clearTask()
	}

	sendTaskMessage(text: string, images?: string[]): void {
		this.client.respond(text, images)
	}

	queueMessage(text: string, images?: string[]): void {
		this.sendToRuntime({ type: "queueMessage", text, ...(images !== undefined ? { images } : {}) })
	}

	approve(): void {
		this.client.approve()
	}

	reject(): void {
		this.client.reject()
	}

	onMessage(listener: RuntimeMessageListener): () => void {
		this.runtimeMessageListeners.add(listener)
		return () => this.runtimeMessageListeners.delete(listener)
	}

	onTaskCompleted(listener: (event: TaskCompletedEvent) => void): () => void {
		return this.client.on("taskCompleted", listener)
	}

	onError(listener: RuntimeErrorListener): () => void {
		const disposeClientListener = this.client.on("error", listener)
		this.runtimeErrorListeners.add(listener)
		return () => {
			disposeClientListener()
			this.runtimeErrorListeners.delete(listener)
		}
	}

	attachJsonEmitter(emitter: JsonEventEmitter): void {
		emitter.attachToClient(this.client)
	}

	async readTaskHistory(): Promise<TaskSessionEntry[]> {
		if (!this.globalStoragePath) {
			return []
		}

		const sessions = await this.deps.readTaskSessions(this.globalStoragePath)
		return filterSessionsForWorkspace(sessions, this.options.workspacePath)
	}

	getRuntimeOptions(): Pick<CliRuntimeOptions, "provider" | "apiKey" | "baseUrl"> {
		return {
			provider: this.options.provider,
			apiKey: this.options.apiKey,
			baseUrl: this.options.baseUrl,
		}
	}

	getAgentState(): AgentStateInfo {
		return this.client.getAgentState()
	}

	isWaitingForInput(): boolean {
		return this.client.isWaitingForInput()
	}

	hasActiveTask(): boolean {
		return this.client.hasActiveTask()
	}

	getCurrentAsk(): ClineAsk | undefined {
		return this.client.getCurrentAsk()
	}

	cancelTask(): void {
		this.client.cancelTask()
	}

	async dispose(): Promise<void> {
		this.client.reset()
		this.loggedFirstPartials.clear()

		if (this.deactivateBundle) {
			try {
				await this.deactivateBundle()
			} catch {
				// Best-effort bundle deactivation.
			}
		}

		this.api = null
		this.deactivateBundle = undefined
		this.currentTaskId = null
		this.currentMessages = []
		this.globalStoragePath = null

		delete (global as Record<string, unknown>).vscode
		clearRuntimeConfig()
		this.restoreConsole()

		if (this.ephemeralStorageDir) {
			try {
				await fs.promises.rm(this.ephemeralStorageDir, { recursive: true, force: true })
			} catch {
				// Best effort cleanup.
			}
			this.ephemeralStorageDir = null
		}

		if (this.previousCliRuntimeEnv === undefined) {
			delete process.env.ROO_CLI_RUNTIME
		} else {
			process.env.ROO_CLI_RUNTIME = this.previousCliRuntimeEnv
		}
	}

	private registerApiEventHandlers(api: BundleApi): void {
		api.on(
			"message" as RooCodeEventName,
			({ taskId, action, message }: { taskId: string; action: "created" | "updated"; message: ClineMessage }) => {
				this.currentTaskId = taskId

				if (action === "created") {
					this.upsertCurrentMessage(message)
					void this.publishState({ includeMessages: true, includeTaskHistory: false })
					return
				}

				this.upsertCurrentMessage(message)
				this.handleRuntimeMessage({ type: "messageUpdated", clineMessage: message } as ExtensionMessage)
			},
		)

		api.on("taskCreated" as RooCodeEventName, (taskId: string) => {
			this.currentTaskId = taskId
			this.currentMessages = []
			void this.publishState({ includeMessages: true, includeTaskHistory: true })
		})

		api.on(
			"taskCompleted" as RooCodeEventName,
			(_taskId: string, _tokenUsage: TokenUsage, _toolUsage: ToolUsage) => {
				void this.publishState({ includeMessages: true, includeTaskHistory: true })
			},
		)

		api.on("taskAborted" as RooCodeEventName, () => {
			void this.publishState({ includeMessages: true, includeTaskHistory: true })
		})
	}

	private buildInitialSettings(): RooCodeSettings {
		const baseSettings: RooCodeSettings = {
			mode: this.options.mode,
			consecutiveMistakeLimit: this.options.consecutiveMistakeLimit ?? DEFAULT_FLAGS.consecutiveMistakeLimit,
			commandExecutionTimeout: 300,
			enableCheckpoints: false,
			experiments: {
				customTools: true,
			},
			...getProviderSettings(this.options.provider, this.options.apiKey, this.options.model, {
				baseUrl: this.options.baseUrl,
			}),
		}

		const initialSettings = this.options.nonInteractive
			? {
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
					alwaysAllowWrite: true,
					alwaysAllowWriteOutsideWorkspace: true,
					alwaysAllowWriteProtected: true,
					alwaysAllowMcp: true,
					alwaysAllowModeSwitch: true,
					alwaysAllowSubtasks: true,
					alwaysAllowExecute: true,
					allowedCommands: ["*"],
					...baseSettings,
				}
			: {
					autoApprovalEnabled: false,
					...baseSettings,
				}

		if (this.options.reasoningEffort && this.options.reasoningEffort !== "unspecified") {
			if (this.options.reasoningEffort === "disabled") {
				initialSettings.enableReasoningEffort = false
			} else {
				initialSettings.enableReasoningEffort = true
				initialSettings.reasoningEffort = this.options.reasoningEffort
			}
		}

		if (this.options.terminalShell) {
			initialSettings.terminalShellIntegrationDisabled = true
			initialSettings.execaShellPath = this.options.terminalShell
		}

		return initialSettings
	}

	private async publishCliMetadata(): Promise<void> {
		try {
			const [commands, modes] = await Promise.all([
				getCliCommands(this.options.workspacePath),
				loadCliModes(this.options.workspacePath),
			])

			this.handleRuntimeMessage({ type: "commands", commands } as ExtensionMessage)
			this.handleRuntimeMessage({
				type: "modes",
				modes: modes.map(({ slug, name }) => ({ slug, name })),
			} as ExtensionMessage)
		} catch (error) {
			this.emitRuntimeError(error)
		}
	}

	private async publishRouterModels(): Promise<void> {
		const provider = getDiscoveryProvider(this.options.provider)
		if (!provider) {
			return
		}

		try {
			let models = {}

			if (provider === "openai") {
				models = await getOpenAiCompatibleModels(
					this.options.baseUrl || "http://127.0.0.1:8080/v1",
					this.options.apiKey,
				)
			} else if (provider === "anthropic") {
				models = await getAnthropicCompatibleModels(
					this.options.baseUrl || "http://127.0.0.1:8080",
					this.options.apiKey,
				)
			} else {
				models = await getRouterModels(provider, {
					apiKey: this.options.apiKey,
					baseUrl: this.options.baseUrl,
				})
			}

			this.handleRuntimeMessage({
				type: "routerModels",
				routerModels: {
					[provider]: models,
				},
			} as ExtensionMessage)
		} catch (error) {
			this.emitRuntimeError(error)
		}
	}

	private async publishState({
		includeMessages,
		includeTaskHistory,
	}: {
		includeMessages: boolean
		includeTaskHistory: boolean
	}): Promise<void> {
		const api = this.api
		if (!api) {
			return
		}

		const state: Record<string, unknown> = {
			mode: api.getConfiguration().mode,
			apiConfiguration: this.getCurrentApiConfiguration(),
		}

		if (includeMessages) {
			this.currentTaskId = api.getCurrentTaskStack().at(-1) ?? this.currentTaskId
			state.clineMessages = this.currentMessages
		}

		if (includeTaskHistory && this.globalStoragePath) {
			const sessions = await this.deps.readTaskSessions(this.globalStoragePath)
			state.taskHistory = filterSessionsForWorkspace(sessions, this.options.workspacePath)
		}

		this.handleRuntimeMessage({ type: "state", state } as ExtensionMessage)
	}

	private upsertCurrentMessage(message: ClineMessage): void {
		const existingIndex = this.currentMessages.findIndex((entry) => entry.ts === message.ts)
		if (existingIndex >= 0) {
			this.currentMessages[existingIndex] = message
			return
		}

		this.currentMessages = [...this.currentMessages, message]
	}

	private async waitForTaskHistoryHydration(taskId: string, timeoutMs = 5_000): Promise<void> {
		const startedAt = Date.now()

		while (Date.now() - startedAt < timeoutMs) {
			if (this.currentTaskId === taskId && this.currentMessages.length > 0) {
				return
			}

			const persistedMessages = await this.readPersistedTaskMessages(taskId)
			if (persistedMessages?.length) {
				this.currentMessages = [...persistedMessages]
				return
			}

			await new Promise((resolve) => setTimeout(resolve, 25))
		}
	}

	private async readPersistedTaskMessages(taskId: string): Promise<ClineMessage[] | null> {
		if (!this.globalStoragePath) {
			return null
		}

		const messagesPath = path.join(this.globalStoragePath, "tasks", taskId, "ui_messages.json")

		try {
			const raw = await fs.promises.readFile(messagesPath, "utf-8")
			const parsed = JSON.parse(raw)
			return Array.isArray(parsed) ? (parsed as ClineMessage[]) : null
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null
			}

			throw error
		}
	}

	private getCurrentApiConfiguration(): Record<string, unknown> {
		return this.api?.getConfiguration()
			? { ...this.api.getConfiguration() }
			: getProviderSettings(this.options.provider, this.options.apiKey, this.options.model, {
					baseUrl: this.options.baseUrl,
				})
	}

	private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
		const api = this.api
		if (!api) {
			throw new Error("CLI runtime not activated")
		}

		switch (message.type) {
			case "newTask": {
				this.currentMessages = []
				this.currentTaskId =
					(await api.startNewTask({
						configuration: message.taskConfiguration || {},
						text: message.text,
						images: message.images,
					})) || this.currentTaskId
				await this.publishState({ includeMessages: true, includeTaskHistory: true })
				return
			}
			case "askResponse": {
				if (message.askResponse === "messageResponse") {
					await api.sendMessage(message.text || "", message.images)
					return
				}

				if (message.askResponse === "yesButtonClicked") {
					await api.pressPrimaryButton()
					return
				}

				if (message.askResponse === "noButtonClicked") {
					await api.pressSecondaryButton()
				}
				return
			}
			case "clearTask": {
				await api.clearCurrentTask()
				this.currentTaskId = null
				this.currentMessages = []
				await this.publishState({ includeMessages: true, includeTaskHistory: true })
				return
			}
			case "cancelTask": {
				await api.cancelCurrentTask()
				return
			}
			case "queueMessage": {
				await api.sendMessage(message.text || "", message.images)
				return
			}
			case "mode": {
				if (!message.text) {
					return
				}

				await api.setConfiguration({
					...api.getConfiguration(),
					mode: message.text,
				})
				await this.publishState({ includeMessages: false, includeTaskHistory: false })
				return
			}
			case "showTaskWithId": {
				if (!message.text) {
					return
				}

				await api.resumeTask(message.text)
				this.currentTaskId = message.text
				await this.waitForTaskHistoryHydration(message.text)
				if (this.currentMessages.length === 0) {
					const persistedMessages = await this.readPersistedTaskMessages(message.text)
					if (persistedMessages?.length) {
						this.currentMessages = [...persistedMessages]
					}
				}
				await this.publishState({ includeMessages: true, includeTaskHistory: true })
				return
			}
			case "searchFiles": {
				try {
					const results = await this.deps.searchWorkspaceFiles({
						workspacePath: this.options.workspacePath,
						query: message.query || "",
					})

					this.handleRuntimeMessage({
						type: "fileSearchResults",
						results,
						requestId: message.requestId,
					} as ExtensionMessage)
				} catch (error) {
					const normalized = error instanceof Error ? error.message : String(error)
					this.handleRuntimeMessage({
						type: "fileSearchResults",
						results: [],
						error: normalized,
						requestId: message.requestId,
					} as ExtensionMessage)
				}
				return
			}
			case "requestCommands":
			case "requestModes": {
				await this.publishCliMetadata()
				return
			}
			case "requestRooModels": {
				await this.publishRouterModels()
				return
			}
			default:
				return
		}
	}

	private sendToRuntime(message: WebviewMessage): void {
		void this.handleWebviewMessage(message).catch((error) => {
			this.emitRuntimeError(error)
		})
	}

	private handleRuntimeMessage(message: ExtensionMessage): void {
		this.client.handleMessage(message)
		for (const listener of this.runtimeMessageListeners) {
			listener(message)
		}
	}

	private emitRuntimeError(error: unknown): void {
		const normalized = error instanceof Error ? error : new Error(String(error))
		for (const listener of this.runtimeErrorListeners) {
			listener(normalized)
		}
	}

	private waitForTaskCompletion(): Promise<void> {
		return new Promise((resolve, reject) => {
			const disposeCompleted = this.client.on("taskCompleted", () => {
				cleanup()
				resolve()
			})

			const disposeErrored = this.client.on("error", (error) => {
				cleanup()
				reject(error)
			})

			let messageHandler: ((message: ClineMessage) => void) | null = null

			if (this.options.exitOnError) {
				messageHandler = (message: ClineMessage) => {
					if (message.type === "say" && message.say === "api_req_retry_delayed") {
						cleanup()
						reject(new Error(message.text?.split("\n")[0] || "API request failed"))
					}
				}

				this.client.on("message", messageHandler)
			}

			const cleanup = () => {
				disposeCompleted()
				disposeErrored()
				if (messageHandler) {
					this.client.off("message", messageHandler)
				}
			}
		})
	}

	private setupQuietMode(): void {
		if (this.originalConsole) {
			return
		}

		this.originalProcessEmitWarning = process.emitWarning
		process.emitWarning = () => {}
		process.on("warning", () => {})

		this.originalConsole = {
			log: console.log,
			warn: console.warn,
			error: console.error,
			debug: console.debug,
			info: console.info,
		}

		console.log = () => {}
		console.warn = () => {}
		console.debug = () => {}
		console.info = () => {}
	}

	private restoreConsole(): void {
		if (!this.originalConsole) {
			return
		}

		console.log = this.originalConsole.log
		console.warn = this.originalConsole.warn
		console.error = this.originalConsole.error
		console.debug = this.originalConsole.debug
		console.info = this.originalConsole.info
		this.originalConsole = null

		if (this.originalProcessEmitWarning) {
			process.emitWarning = this.originalProcessEmitWarning
			this.originalProcessEmitWarning = null
		}
	}

	private logMessageDebug(message: ClineMessage, type: "new" | "updated"): void {
		if (message.partial) {
			if (!this.loggedFirstPartials.has(message.ts)) {
				this.loggedFirstPartials.add(message.ts)
				cliLogger.debug("message:start", { ts: message.ts, type: message.say || message.ask })
			}
			return
		}

		cliLogger.debug(`message:${type === "new" ? "new" : "complete"}`, {
			ts: message.ts,
			type: message.say || message.ask,
		})
		this.loggedFirstPartials.delete(message.ts)
	}
}
