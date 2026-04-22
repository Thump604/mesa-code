import type { ExtensionMessage } from "@roo-code/types"

import type { TaskCompletedEvent } from "@/agent/events.js"

import type { CliSessionController, CliSessionControllerStartOptions } from "./session-controller.js"
import type { CliRuntime } from "./runtime.js"
import type { InitialSessionLaunch } from "./session-launch.js"

type LifecycleLaunch<K extends InitialSessionLaunch["kind"]> = Extract<InitialSessionLaunch, { kind: K }>

export interface CliSessionLifecycle {
	onMessage?: (message: ExtensionMessage, controller: CliSessionController) => void
	onTaskCompleted?: (event: TaskCompletedEvent, controller: CliSessionController) => void | Promise<void>
	onError?: (error: Error, controller: CliSessionController) => void
	afterActivate?: (runtime: CliRuntime, controller: CliSessionController) => void | Promise<void>
	onStart?: (launch: LifecycleLaunch<"start">, controller: CliSessionController) => void | Promise<void>
	onResume?: (launch: LifecycleLaunch<"resume">, controller: CliSessionController) => void | Promise<void>
	onIdle?: (launch: LifecycleLaunch<"idle">, controller: CliSessionController) => void | Promise<void>
	dispose?: () => void | Promise<void>
}

export function createSessionLifecycleStartOptions(
	controller: CliSessionController,
	lifecycle: CliSessionLifecycle,
	initialLaunch: CliSessionControllerStartOptions["initialLaunch"],
): CliSessionControllerStartOptions {
	return {
		initialLaunch,
		onMessage: lifecycle.onMessage ? (message) => lifecycle.onMessage?.(message, controller) : undefined,
		onTaskCompleted: lifecycle.onTaskCompleted
			? (event) => lifecycle.onTaskCompleted?.(event, controller)
			: undefined,
		onError: lifecycle.onError ? (error) => lifecycle.onError?.(error, controller) : undefined,
		afterActivate: lifecycle.afterActivate
			? (runtime) => lifecycle.afterActivate?.(runtime, controller)
			: undefined,
		onStart: lifecycle.onStart ? (launch) => lifecycle.onStart?.(launch, controller) : undefined,
		onResume: lifecycle.onResume ? (launch) => lifecycle.onResume?.(launch, controller) : undefined,
		onIdle: lifecycle.onIdle ? (launch) => lifecycle.onIdle?.(launch, controller) : undefined,
	}
}
