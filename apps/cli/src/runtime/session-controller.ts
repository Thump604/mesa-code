import type { ClineAsk, ExtensionMessage, RooCodeSettings } from "@roo-code/types"

import type { AgentStateInfo } from "@/agent/agent-state.js"
import type { TaskCompletedEvent } from "@/agent/events.js"
import type { JsonEventEmitter } from "@/agent/json-event-emitter.js"

import type { CliRuntime, CliRuntimeOptions, CreateCliRuntime } from "./runtime.js"
import type { InitialSessionLaunch, StartCliRuntimeSessionOptions, StartedCliRuntimeSession } from "./session-launch.js"

import { startCliRuntimeSession } from "./session-launch.js"

export interface CliSessionControllerOptions {
	createCliRuntime: CreateCliRuntime
	runtimeOptions: CliRuntimeOptions
}

export type CliSessionControllerStartOptions = Omit<
	StartCliRuntimeSessionOptions,
	"createCliRuntime" | "runtimeOptions" | "afterCreate"
>

export class CliSessionController {
	private readonly createCliRuntime: CreateCliRuntime
	private readonly runtimeOptions: CliRuntimeOptions
	private runtime: CliRuntime | null = null
	private launch: InitialSessionLaunch | null = null

	constructor({ createCliRuntime, runtimeOptions }: CliSessionControllerOptions) {
		this.createCliRuntime = createCliRuntime
		this.runtimeOptions = runtimeOptions
	}

	async start(options: CliSessionControllerStartOptions): Promise<StartedCliRuntimeSession> {
		if (this.runtime) {
			throw new Error("CLI session controller already started")
		}

		const startedSession = await startCliRuntimeSession({
			createCliRuntime: this.createCliRuntime,
			runtimeOptions: this.runtimeOptions,
			afterCreate: (runtime) => {
				this.runtime = runtime
			},
			...options,
		})

		this.launch = startedSession.launch
		return startedSession
	}

	getRuntime(): CliRuntime | null {
		return this.runtime
	}

	getRuntimeOrThrow(): CliRuntime {
		if (!this.runtime) {
			throw new Error("CLI runtime not ready")
		}

		return this.runtime
	}

	getLaunch(): InitialSessionLaunch | null {
		return this.launch
	}

	startTask(prompt: string, taskId?: string, configuration?: RooCodeSettings, images?: string[]): Promise<void> {
		return this.getRuntimeOrThrow().startTask(prompt, taskId, configuration, images)
	}

	showTask(taskId: string): Promise<void> {
		return this.getRuntimeOrThrow().showTask(taskId)
	}

	waitForTaskCompletion(): Promise<void> {
		return this.getRuntimeOrThrow().waitForTaskCompletion()
	}

	runTask(prompt: string, taskId?: string, configuration?: RooCodeSettings, images?: string[]): Promise<void> {
		return this.startTask(prompt, taskId, configuration, images).then(() => this.waitForTaskCompletion())
	}

	onMessage(listener: (message: ExtensionMessage) => void): () => void {
		return this.getRuntimeOrThrow().onMessage(listener)
	}

	onTaskCompleted(listener: (event: TaskCompletedEvent) => void): () => void {
		return this.getRuntimeOrThrow().onTaskCompleted(listener)
	}

	onError(listener: (error: Error) => void): () => void {
		return this.getRuntimeOrThrow().onError(listener)
	}

	refreshCliMetadata(): void {
		this.getRuntimeOrThrow().refreshCliMetadata()
	}

	requestRooModels(): void {
		this.getRuntimeOrThrow().requestRooModels()
	}

	selectTask(taskId: string): void {
		this.getRuntimeOrThrow().selectTask(taskId)
	}

	setMode(modeSlug: string): void {
		this.getRuntimeOrThrow().setMode(modeSlug)
	}

	searchFiles(query: string): void {
		this.getRuntimeOrThrow().searchFiles(query)
	}

	clearTask(): void {
		this.getRuntimeOrThrow().clearTask()
	}

	sendTaskMessage(text: string, images?: string[]): void {
		this.getRuntimeOrThrow().sendTaskMessage(text, images)
	}

	queueMessage(text: string, images?: string[]): void {
		this.getRuntimeOrThrow().queueMessage(text, images)
	}

	approve(): void {
		this.getRuntimeOrThrow().approve()
	}

	reject(): void {
		this.getRuntimeOrThrow().reject()
	}

	cancelTask(): void {
		this.getRuntimeOrThrow().cancelTask()
	}

	attachJsonEmitter(emitter: JsonEventEmitter): void {
		this.getRuntimeOrThrow().attachJsonEmitter(emitter)
	}

	getAgentState(): AgentStateInfo {
		return this.getRuntimeOrThrow().getAgentState()
	}

	isWaitingForInput(): boolean {
		return this.getRuntimeOrThrow().isWaitingForInput()
	}

	hasActiveTask(): boolean {
		return this.getRuntimeOrThrow().hasActiveTask()
	}

	getCurrentAsk(): ClineAsk | undefined {
		return this.getRuntimeOrThrow().getCurrentAsk()
	}

	async cleanup(): Promise<void> {
		const runtime = this.runtime
		this.runtime = null
		this.launch = null

		if (!runtime) {
			return
		}

		await runtime.dispose()
	}
}
