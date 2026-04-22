import { useEffect, useRef, useCallback, useMemo } from "react"
import { useApp } from "ink"
import { randomUUID } from "crypto"
import pWaitFor from "p-wait-for"
import type { ExtensionMessage, HistoryItem, WebviewMessage } from "@roo-code/types"

import type { CliRuntime, CliRuntimeOptions, CreateCliRuntime } from "@/runtime/index.js"
import { arePathsEqual } from "@/lib/utils/path.js"

import { useCLIStore } from "../store.js"

const TASK_HISTORY_WAIT_TIMEOUT_MS = 2_000

function extractTaskHistory(message: ExtensionMessage): HistoryItem[] | undefined {
	if (message.type === "state" && Array.isArray(message.state?.taskHistory)) {
		return message.state.taskHistory as HistoryItem[]
	}

	if (message.type === "taskHistoryUpdated" && Array.isArray(message.taskHistory)) {
		return message.taskHistory as HistoryItem[]
	}

	return undefined
}

function getMostRecentTaskId(taskHistory: HistoryItem[], workspacePath: string): string | undefined {
	const workspaceTasks = taskHistory.filter(
		(item) => typeof item.workspace === "string" && arePathsEqual(item.workspace, workspacePath),
	)

	if (workspaceTasks.length === 0) {
		return undefined
	}

	const sorted = [...workspaceTasks].sort((a, b) => b.ts - a.ts)
	return sorted[0]?.id
}

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
	sendRuntimeMessage: ((msg: WebviewMessage) => void) | null
	runTask: ((prompt: string) => Promise<void>) | null
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
				let taskHistorySnapshot: HistoryItem[] = []
				let hasReceivedTaskHistory = false

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

				runtime.onMessage((msg) => {
					const taskHistory = extractTaskHistory(msg)

					if (taskHistory) {
						taskHistorySnapshot = taskHistory
						hasReceivedTaskHistory = true
					}

					onRuntimeMessage(msg)
				})

				runtime.onTaskCompleted(async () => {
					setComplete(true)
					setLoading(false)

					if (exitOnComplete) {
						await cleanup()
						exit()
						setTimeout(() => process.exit(0), 100)
					}
				})

				runtime.onError((err: Error) => {
					setError(err.message)
					setLoading(false)
				})

				await runtime.activate()

				runtime.sendMessage({ type: "requestCommands" })
				runtime.sendMessage({ type: "requestModes" })

				if (requestedSessionId || continueSession) {
					await pWaitFor(() => hasReceivedTaskHistory, {
						interval: 25,
						timeout: TASK_HISTORY_WAIT_TIMEOUT_MS,
					}).catch(() => undefined)

					if (requestedSessionId && hasReceivedTaskHistory) {
						const hasRequestedTask = taskHistorySnapshot.some((item) => item.id === requestedSessionId)

						if (!hasRequestedTask) {
							throw new Error(`Session not found in task history: ${requestedSessionId}`)
						}
					}

					const resolvedSessionId =
						requestedSessionId || getMostRecentTaskId(taskHistorySnapshot, workspacePath)

					if (continueSession && !resolvedSessionId) {
						throw new Error("No previous tasks found to continue in this workspace.")
					}

					if (resolvedSessionId) {
						setCurrentTaskId(resolvedSessionId)
						setIsResumingTask(true)
						setHasStartedTask(true)
						setLoading(true)
						runtime.sendMessage({ type: "showTaskWithId", text: resolvedSessionId })
						return
					}
				}

				setLoading(false)

				if (initialPrompt) {
					setHasStartedTask(true)
					setLoading(true)
					addMessage({ id: randomUUID(), role: "user", content: initialPrompt })
					const taskId = pendingInitialTaskIdRef.current
					pendingInitialTaskIdRef.current = undefined
					await runtime.runTask(initialPrompt, taskId)
				}
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

	const sendRuntimeMessage = useCallback((msg: WebviewMessage) => {
		runtimeRef.current?.sendMessage(msg)
	}, [])

	const runTask = useCallback((prompt: string): Promise<void> => {
		if (!runtimeRef.current) {
			return Promise.reject(new Error("CLI runtime not ready"))
		}

		const taskId = pendingInitialTaskIdRef.current
		pendingInitialTaskIdRef.current = undefined
		return runtimeRef.current.runTask(prompt, taskId)
	}, [])

	return useMemo(
		() => ({ isReady: isReadyRef.current, sendRuntimeMessage, runTask, cleanup }),
		[sendRuntimeMessage, runTask, cleanup],
	)
}
