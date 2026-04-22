import type { TaskSessionEntry } from "@roo-code/core/cli"
import type { ClineAsk, ExtensionMessage, ReasoningEffortExtended, RooCodeSettings } from "@roo-code/types"

import type { SupportedProvider } from "@/types/index.js"
import type { User } from "@/lib/sdk/index.js"
import type { AgentStateInfo } from "@/agent/agent-state.js"
import type { TaskCompletedEvent } from "@/agent/events.js"
import type { JsonEventEmitter } from "@/agent/json-event-emitter.js"

import { BundleApiCliRuntime } from "./bundle-runtime.js"

export interface CliRuntimeOptions {
	mode: string
	reasoningEffort?: ReasoningEffortExtended | "unspecified" | "disabled"
	consecutiveMistakeLimit?: number
	user: User | null
	provider: SupportedProvider
	apiKey?: string
	baseUrl?: string
	model: string
	workspacePath: string
	extensionPath: string
	nonInteractive?: boolean
	ephemeral: boolean
	debug: boolean
	exitOnComplete: boolean
	terminalShell?: string
	exitOnError?: boolean
	disableOutput?: boolean
}

export interface CliRuntime {
	activate(): Promise<void>
	startTask(prompt: string, taskId?: string, configuration?: RooCodeSettings, images?: string[]): Promise<void>
	showTask(taskId: string): Promise<void>
	waitForTaskCompletion(): Promise<void>
	runTask(prompt: string, taskId?: string, configuration?: RooCodeSettings, images?: string[]): Promise<void>
	resumeTask(taskId: string): Promise<void>
	refreshCliMetadata(): void
	requestRooModels(): void
	selectTask(taskId: string): void
	setMode(modeSlug: string): void
	searchFiles(query: string): void
	clearTask(): void
	sendTaskMessage(text: string, images?: string[]): void
	queueMessage(text: string, images?: string[]): void
	approve(): void
	reject(): void
	onMessage(listener: (message: ExtensionMessage) => void): () => void
	onTaskCompleted(listener: (event: TaskCompletedEvent) => void): () => void
	onError(listener: (error: Error) => void): () => void
	attachJsonEmitter(emitter: JsonEventEmitter): void
	readTaskHistory(): Promise<TaskSessionEntry[]>
	getRuntimeOptions(): Pick<CliRuntimeOptions, "provider" | "apiKey" | "baseUrl">
	getAgentState(): AgentStateInfo
	isWaitingForInput(): boolean
	hasActiveTask(): boolean
	getCurrentAsk(): ClineAsk | undefined
	cancelTask(): void
	dispose(): Promise<void>
}

export interface CreateCliRuntime {
	(options: CliRuntimeOptions): CliRuntime
}

export function createCliRuntime(options: CliRuntimeOptions): CliRuntime {
	return new BundleApiCliRuntime(options)
}
