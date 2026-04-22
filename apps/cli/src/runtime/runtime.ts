import type { ClineAsk, ExtensionMessage, RooCodeSettings, WebviewMessage } from "@roo-code/types"

import type { AgentStateInfo } from "@/agent/agent-state.js"
import type { TaskCompletedEvent } from "@/agent/events.js"
import { ExtensionHost, type ExtensionHostOptions } from "@/agent/extension-host.js"
import type { JsonEventEmitter } from "@/agent/json-event-emitter.js"

export type CliRuntimeOptions = ExtensionHostOptions

export interface CliRuntime {
	activate(): Promise<void>
	runTask(prompt: string, taskId?: string, configuration?: RooCodeSettings, images?: string[]): Promise<void>
	resumeTask(taskId: string): Promise<void>
	sendMessage(message: WebviewMessage): void
	onMessage(listener: (message: ExtensionMessage) => void): () => void
	onTaskCompleted(listener: (event: TaskCompletedEvent) => void): () => void
	onError(listener: (error: Error) => void): () => void
	attachJsonEmitter(emitter: JsonEventEmitter): void
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

export class ExtensionBackedCliRuntime implements CliRuntime {
	constructor(private readonly host: ExtensionHost) {}

	activate(): Promise<void> {
		return this.host.activate()
	}

	runTask(prompt: string, taskId?: string, configuration?: RooCodeSettings, images?: string[]): Promise<void> {
		return this.host.runTask(prompt, taskId, configuration, images)
	}

	resumeTask(taskId: string): Promise<void> {
		return this.host.resumeTask(taskId)
	}

	sendMessage(message: WebviewMessage): void {
		this.host.sendToExtension(message)
	}

	onMessage(listener: (message: ExtensionMessage) => void): () => void {
		const handler = (message: unknown) => listener(message as ExtensionMessage)
		this.host.on("extensionWebviewMessage", handler)
		return () => this.host.off("extensionWebviewMessage", handler)
	}

	onTaskCompleted(listener: (event: TaskCompletedEvent) => void): () => void {
		return this.host.client.on("taskCompleted", listener)
	}

	onError(listener: (error: Error) => void): () => void {
		return this.host.client.on("error", listener)
	}

	attachJsonEmitter(emitter: JsonEventEmitter): void {
		emitter.attachToClient(this.host.client)
	}

	getRuntimeOptions(): Pick<CliRuntimeOptions, "provider" | "apiKey" | "baseUrl"> {
		return this.host.getRuntimeOptions()
	}

	getAgentState(): AgentStateInfo {
		return this.host.getAgentState()
	}

	isWaitingForInput(): boolean {
		return this.host.isWaitingForInput()
	}

	hasActiveTask(): boolean {
		return this.host.client.hasActiveTask()
	}

	getCurrentAsk(): ClineAsk | undefined {
		return this.host.client.getCurrentAsk()
	}

	cancelTask(): void {
		this.host.client.cancelTask()
	}

	dispose(): Promise<void> {
		return this.host.dispose()
	}
}

export function createCliRuntime(options: CliRuntimeOptions): CliRuntime {
	return new ExtensionBackedCliRuntime(new ExtensionHost(options))
}
