import { useEffect, useRef, useCallback, useMemo } from "react"
import { useApp } from "ink"

import { CliSessionController, type CliRuntimeOptions, type CreateCliRuntime } from "@/runtime/index.js"
import { createSessionLifecycleStartOptions } from "@/runtime/index.js"

import { useCLIStore } from "../store.js"
import { createTuiSessionLifecycle } from "../tui-session-lifecycle.js"

import type { ExtensionMessage } from "@roo-code/types"

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
	consecutiveMistakeLimit,
	user,
	provider,
	apiKey,
	baseUrl,
	model,
	workspacePath,
	extensionPath,
	nonInteractive,
	ephemeral,
	debug,
	exitOnComplete,
	terminalShell,
	exitOnError,
	onRuntimeMessage,
	createCliRuntime,
}: UseCliRuntimeOptions): UseCliRuntimeReturn {
	const { exit } = useApp()
	const { addMessage, setComplete, setLoading, setHasStartedTask, setError, setCurrentTaskId, setIsResumingTask } =
		useCLIStore()

	const sessionControllerRef = useRef<CliSessionController | null>(null)
	const isReadyRef = useRef(false)
	const pendingInitialTaskIdRef = useRef<string | undefined>(initialTaskId?.trim() || undefined)

	const cleanup = useCallback(async () => {
		const sessionController = sessionControllerRef.current
		sessionControllerRef.current = null
		isReadyRef.current = false

		await sessionController?.cleanup()
	}, [])

	useEffect(() => {
		const init = async () => {
			try {
				const requestedSessionId = initialSessionId?.trim()
				const sessionController = new CliSessionController({
					createCliRuntime,
					runtimeOptions: {
						mode,
						user,
						reasoningEffort,
						consecutiveMistakeLimit,
						provider,
						apiKey,
						baseUrl,
						model,
						workspacePath,
						extensionPath,
						nonInteractive,
						ephemeral,
						debug,
						exitOnComplete,
						terminalShell,
						exitOnError,
						disableOutput: true,
					},
				})
				sessionControllerRef.current = sessionController

				const lifecycle = createTuiSessionLifecycle({
					onRuntimeMessage,
					exitOnComplete,
					onExit: exit,
					cleanup,
					addMessage,
					setComplete,
					setLoading,
					setHasStartedTask,
					setError,
					setCurrentTaskId,
					setIsResumingTask,
					clearPendingInitialTaskId: () => {
						pendingInitialTaskIdRef.current = undefined
					},
				})

				await sessionController.start(
					createSessionLifecycleStartOptions(sessionController, lifecycle, {
						initialPrompt,
						initialTaskId: pendingInitialTaskIdRef.current,
						initialSessionId: requestedSessionId,
						continueSession,
					}),
				)
				isReadyRef.current = true
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
		if (!sessionControllerRef.current) {
			return Promise.reject(new Error("CLI runtime not ready"))
		}

		const taskId = pendingInitialTaskIdRef.current
		pendingInitialTaskIdRef.current = undefined
		return sessionControllerRef.current.runTask(prompt, taskId)
	}, [])

	const refreshCliMetadata = useCallback(() => {
		sessionControllerRef.current?.refreshCliMetadata()
	}, [])

	const selectTask = useCallback((taskId: string) => {
		sessionControllerRef.current?.selectTask(taskId)
	}, [])

	const setMode = useCallback((modeSlug: string) => {
		sessionControllerRef.current?.setMode(modeSlug)
	}, [])

	const searchFiles = useCallback((query: string) => {
		sessionControllerRef.current?.searchFiles(query)
	}, [])

	const clearTask = useCallback(() => {
		sessionControllerRef.current?.clearTask()
	}, [])

	const cancelTask = useCallback(() => {
		sessionControllerRef.current?.cancelTask()
	}, [])

	const sendTaskMessage = useCallback((text: string, images?: string[]) => {
		sessionControllerRef.current?.sendTaskMessage(text, images)
	}, [])

	const approve = useCallback(() => {
		sessionControllerRef.current?.approve()
	}, [])

	const reject = useCallback(() => {
		sessionControllerRef.current?.reject()
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
