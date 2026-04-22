import { useEffect, useRef, useCallback, useMemo } from "react"
import { useApp } from "ink"
import { randomUUID } from "crypto"
import type { ExtensionMessage } from "@roo-code/types"

import {
	activateCliRuntimeSession,
	runInitialSessionLaunch,
	type CliRuntime,
	type CliRuntimeOptions,
	type CreateCliRuntime,
} from "@/runtime/index.js"

import { useCLIStore } from "../store.js"

export interface UseCliRuntimeOptions extends CliRuntimeOptions {
	initialPrompt?: string
	initialTaskId?: string
	initialSessionId?: string
	continueSession?: boolean
	onRuntimeMessage: (msg: ExtensionMessage) => void
	createCliRuntime: CreateCliRuntime
}

export interface UseCliRuntimeReturn {
	isReady: boolean
	runTask: ((prompt: string) => Promise<void>) | null
	refreshCliMetadata: (() => void) | null
	selectTask: ((taskId: string) => void) | null
	setMode: ((modeSlug: string) => void) | null
	searchFiles: ((query: string) => void) | null
	clearTask: (() => void) | null
	cancelTask: (() => void) | null
	sendTaskMessage: ((text: string, images?: string[]) => void) | null
	approve: (() => void) | null
	reject: (() => void) | null
	cleanup: () => Promise<void>
}

export function useCliRuntime({
	initialPrompt,
	initialTaskId,
	initialSessionId,
	continueSession,
	mode,
	reasoningEffort,
	user,
	provider,
	apiKey,
	model,
	workspacePath,
	extensionPath,
	nonInteractive,
	ephemeral,
	debug,
	exitOnComplete,
	onRuntimeMessage,
	createCliRuntime,
}: UseCliRuntimeOptions): UseCliRuntimeReturn {
	const { exit } = useApp()
	const { addMessage, setComplete, setLoading, setHasStartedTask, setError, setCurrentTaskId, setIsResumingTask } =
		useCLIStore()

	const runtimeRef = useRef<CliRuntime | null>(null)
	const isReadyRef = useRef(false)
	const pendingInitialTaskIdRef = useRef<string | undefined>(initialTaskId?.trim() || undefined)

	const cleanup = useCallback(async () => {
		if (runtimeRef.current) {
			await runtimeRef.current.dispose()
			runtimeRef.current = null
			isReadyRef.current = false
		}
	}, [])

	useEffect(() => {
		const init = async () => {
			try {
				const requestedSessionId = initialSessionId?.trim()

				const runtime = createCliRuntime({
					mode,
					user,
					reasoningEffort,
					provider,
					apiKey,
					model,
					workspacePath,
					extensionPath,
					nonInteractive,
					ephemeral,
					debug,
					exitOnComplete,
					disableOutput: true,
				})

				runtimeRef.current = runtime
				isReadyRef.current = true

				const initialLaunch = await activateCliRuntimeSession({
					runtime,
					initialLaunch: {
						initialPrompt,
						initialTaskId: pendingInitialTaskIdRef.current,
						initialSessionId: requestedSessionId,
						continueSession,
					},
					onMessage: onRuntimeMessage,
					onTaskCompleted: async () => {
						setComplete(true)
						setLoading(false)

						if (exitOnComplete) {
							await cleanup()
							exit()
							setTimeout(() => process.exit(0), 100)
						}
					},
					onError: (err: Error) => {
						setError(err.message)
						setLoading(false)
					},
					afterActivate: (activeRuntime) => {
						activeRuntime.refreshCliMetadata()
					},
				})

				await runInitialSessionLaunch({
					runtime,
					launch: initialLaunch,
					onIdle: () => {
						setLoading(false)
					},
					onResume: async (launch) => {
						setCurrentTaskId(launch.sessionId)
						setIsResumingTask(true)
						setHasStartedTask(true)
						setLoading(true)
						runtime.selectTask(launch.sessionId)
					},
					onStart: async (launch) => {
						setLoading(false)
						setHasStartedTask(true)
						setLoading(true)
						addMessage({ id: randomUUID(), role: "user", content: launch.prompt })
						pendingInitialTaskIdRef.current = undefined
						await runtime.runTask(launch.prompt, launch.taskId)
					},
				})
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
				setLoading(false)
			}
		}

		init()

		return () => {
			cleanup()
		}
	}, []) // Run once on mount

	const runTask = useCallback((prompt: string): Promise<void> => {
		if (!runtimeRef.current) {
			return Promise.reject(new Error("CLI runtime not ready"))
		}

		const taskId = pendingInitialTaskIdRef.current
		pendingInitialTaskIdRef.current = undefined
		return runtimeRef.current.runTask(prompt, taskId)
	}, [])

	const refreshCliMetadata = useCallback(() => {
		runtimeRef.current?.refreshCliMetadata()
	}, [])

	const selectTask = useCallback((taskId: string) => {
		runtimeRef.current?.selectTask(taskId)
	}, [])

	const setMode = useCallback((modeSlug: string) => {
		runtimeRef.current?.setMode(modeSlug)
	}, [])

	const searchFiles = useCallback((query: string) => {
		runtimeRef.current?.searchFiles(query)
	}, [])

	const clearTask = useCallback(() => {
		runtimeRef.current?.clearTask()
	}, [])

	const cancelTask = useCallback(() => {
		runtimeRef.current?.cancelTask()
	}, [])

	const sendTaskMessage = useCallback((text: string, images?: string[]) => {
		runtimeRef.current?.sendTaskMessage(text, images)
	}, [])

	const approve = useCallback(() => {
		runtimeRef.current?.approve()
	}, [])

	const reject = useCallback(() => {
		runtimeRef.current?.reject()
	}, [])

	return useMemo(
		() => ({
			isReady: isReadyRef.current,
			runTask,
			refreshCliMetadata,
			selectTask,
			setMode,
			searchFiles,
			clearTask,
			cancelTask,
			sendTaskMessage,
			approve,
			reject,
			cleanup,
		}),
		[
			runTask,
			refreshCliMetadata,
			selectTask,
			setMode,
			searchFiles,
			clearTask,
			cancelTask,
			sendTaskMessage,
			approve,
			reject,
			cleanup,
		],
	)
}
