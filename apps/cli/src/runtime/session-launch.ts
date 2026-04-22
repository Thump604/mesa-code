import type { ExtensionMessage } from "@roo-code/types"

import type { TaskCompletedEvent } from "@/agent/events.js"

import type { CliRuntime, CliRuntimeOptions, CreateCliRuntime } from "./runtime.js"

import { resolveWorkspaceResumeSessionId } from "@/lib/task-history/index.js"

export interface InitialSessionLaunchOptions {
	initialPrompt?: string
	initialTaskId?: string
	initialSessionId?: string
	continueSession?: boolean
}

export type InitialSessionLaunch =
	| {
			kind: "idle"
	  }
	| {
			kind: "start"
			prompt: string
			taskId?: string
	  }
	| {
			kind: "resume"
			sessionId: string
	  }

export interface ActivateCliRuntimeSessionOptions {
	runtime: CliRuntime
	initialLaunch: InitialSessionLaunchOptions
	onMessage?: (message: ExtensionMessage) => void
	onTaskCompleted?: (event: TaskCompletedEvent) => void | Promise<void>
	onError?: (error: Error) => void
	afterActivate?: (runtime: CliRuntime) => void | Promise<void>
}

export interface RunInitialSessionLaunchOptions {
	runtime: Pick<CliRuntime, "runTask" | "resumeTask">
	launch: InitialSessionLaunch
	onStart?: (launch: Extract<InitialSessionLaunch, { kind: "start" }>) => void | Promise<void>
	onResume?: (launch: Extract<InitialSessionLaunch, { kind: "resume" }>) => void | Promise<void>
	onIdle?: (launch: Extract<InitialSessionLaunch, { kind: "idle" }>) => void | Promise<void>
}

export interface StartCliRuntimeSessionOptions
	extends Omit<ActivateCliRuntimeSessionOptions, "runtime">,
		Omit<RunInitialSessionLaunchOptions, "runtime" | "launch"> {
	createCliRuntime: CreateCliRuntime
	runtimeOptions: CliRuntimeOptions
	afterCreate?: (runtime: CliRuntime) => void | Promise<void>
}

export interface StartedCliRuntimeSession {
	runtime: CliRuntime
	launch: InitialSessionLaunch
}

export async function resolveInitialSessionLaunch(
	runtime: Pick<CliRuntime, "readTaskHistory">,
	options: InitialSessionLaunchOptions,
): Promise<InitialSessionLaunch> {
	const requestedSessionId = options.initialSessionId?.trim()

	if (requestedSessionId || options.continueSession) {
		return {
			kind: "resume",
			sessionId: resolveWorkspaceResumeSessionId(await runtime.readTaskHistory(), requestedSessionId),
		}
	}

	if (options.initialPrompt) {
		return {
			kind: "start",
			prompt: options.initialPrompt,
			taskId: options.initialTaskId?.trim() || undefined,
		}
	}

	return { kind: "idle" }
}

export async function activateCliRuntimeSession({
	runtime,
	initialLaunch,
	onMessage,
	onTaskCompleted,
	onError,
	afterActivate,
}: ActivateCliRuntimeSessionOptions): Promise<InitialSessionLaunch> {
	if (onMessage) {
		runtime.onMessage(onMessage)
	}

	if (onTaskCompleted) {
		runtime.onTaskCompleted((event) => {
			void onTaskCompleted(event)
		})
	}

	if (onError) {
		runtime.onError(onError)
	}

	await runtime.activate()
	await afterActivate?.(runtime)
	return resolveInitialSessionLaunch(runtime, initialLaunch)
}

export async function startCliRuntimeSession({
	createCliRuntime,
	runtimeOptions,
	afterCreate,
	initialLaunch,
	onMessage,
	onTaskCompleted,
	onError,
	afterActivate,
	onStart,
	onResume,
	onIdle,
}: StartCliRuntimeSessionOptions): Promise<StartedCliRuntimeSession> {
	const runtime = createCliRuntime(runtimeOptions)
	await afterCreate?.(runtime)
	const launch = await activateCliRuntimeSession({
		runtime,
		initialLaunch,
		onMessage,
		onTaskCompleted,
		onError,
		afterActivate,
	})

	await runInitialSessionLaunch({
		runtime,
		launch,
		onStart,
		onResume,
		onIdle,
	})

	return {
		runtime,
		launch,
	}
}

export async function runInitialSessionLaunch({
	runtime,
	launch,
	onStart,
	onResume,
	onIdle,
}: RunInitialSessionLaunchOptions): Promise<void> {
	switch (launch.kind) {
		case "resume":
			if (onResume) {
				await onResume(launch)
				return
			}

			await runtime.resumeTask(launch.sessionId)
			return
		case "start":
			if (onStart) {
				await onStart(launch)
				return
			}

			await runtime.runTask(launch.prompt, launch.taskId)
			return
		case "idle":
			await onIdle?.(launch)
			return
	}
}
