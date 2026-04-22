import { randomUUID } from "crypto"

import type { ExtensionMessage } from "@roo-code/types"

import type { CliSessionLifecycle } from "@/runtime/session-lifecycle.js"

export interface TuiSessionLifecycleOptions {
	onRuntimeMessage: (msg: ExtensionMessage) => void
	exitOnComplete?: boolean
	onExit: () => void
	cleanup: () => Promise<void>
	addMessage: (message: { id: string; role: "user"; content: string }) => void
	setComplete: (complete: boolean) => void
	setLoading: (loading: boolean) => void
	setHasStartedTask: (started: boolean) => void
	setError: (error: string | null) => void
	setCurrentTaskId: (taskId: string | null) => void
	setIsResumingTask: (isResuming: boolean) => void
	clearPendingInitialTaskId: () => void
}

export function createTuiSessionLifecycle({
	onRuntimeMessage,
	exitOnComplete,
	onExit,
	cleanup,
	addMessage,
	setComplete,
	setLoading,
	setHasStartedTask,
	setError,
	setCurrentTaskId,
	setIsResumingTask,
	clearPendingInitialTaskId,
}: TuiSessionLifecycleOptions): CliSessionLifecycle {
	return {
		onMessage: (message) => {
			onRuntimeMessage(message)
		},
		onTaskCompleted: async () => {
			setComplete(true)
			setLoading(false)

			if (exitOnComplete) {
				await cleanup()
				onExit()
				setTimeout(() => process.exit(0), 100)
			}
		},
		onError: (error) => {
			setError(error.message)
			setLoading(false)
		},
		afterActivate: (_runtime, controller) => {
			controller.refreshCliMetadata()
		},
		onIdle: () => {
			setLoading(false)
		},
		onResume: async (launch, controller) => {
			setCurrentTaskId(launch.sessionId)
			setIsResumingTask(true)
			setHasStartedTask(true)
			setLoading(true)
			await controller.showTask(launch.sessionId)
		},
		onStart: async (launch, controller) => {
			setLoading(false)
			setHasStartedTask(true)
			setLoading(true)
			addMessage({ id: randomUUID(), role: "user", content: launch.prompt })
			clearPendingInitialTaskId()
			await controller.startTask(launch.prompt, launch.taskId)
		},
	}
}
