import { EventEmitter } from "events"

import { describe, expect, it, vi } from "vitest"

import type { ClineMessage } from "@roo-code/types"

import type { JsonEventEmitter } from "@/agent/json-event-emitter.js"

import { BundleApiCliRuntime } from "../bundle-runtime.js"

function createRuntimeHarness() {
	const approveAsk = vi.fn()
	const denyAsk = vi.fn()
	const submitUserMessage = vi.fn().mockResolvedValue(undefined)
	const addQueuedMessage = vi.fn()
	const startNewTask = vi.fn().mockResolvedValue("task-1")
	const resumeTask = vi.fn().mockResolvedValue(undefined)
	const clearCurrentTask = vi.fn().mockResolvedValue(undefined)
	const cancelCurrentTask = vi.fn().mockResolvedValue(undefined)
	const setConfiguration = vi.fn().mockResolvedValue(undefined)
	const searchWorkspaceFiles = vi
		.fn()
		.mockResolvedValue([{ path: "src/index.ts", type: "file" as const, label: "index.ts" }])

	const currentTask = {
		taskId: "task-1",
		clineMessages: [] as ClineMessage[],
		apiConfiguration: { apiProvider: "openai", openAiModelId: "qwen3-coder" },
		approveAsk,
		denyAsk,
		submitUserMessage,
		messageQueueService: {
			addMessage: addQueuedMessage,
		},
	}

	const api = new EventEmitter() as EventEmitter & {
		startNewTask: typeof startNewTask
		resumeTask: typeof resumeTask
		clearCurrentTask: typeof clearCurrentTask
		cancelCurrentTask: typeof cancelCurrentTask
		sendMessage: (text?: string, images?: string[]) => Promise<void>
		getConfiguration: () => { mode: string }
		setConfiguration: typeof setConfiguration
		getCurrentTaskStack: () => (typeof currentTask)[]
		isTaskInHistory: (taskId: string) => Promise<boolean>
	}

	api.startNewTask = startNewTask
	api.resumeTask = resumeTask
	api.clearCurrentTask = clearCurrentTask
	api.cancelCurrentTask = cancelCurrentTask
	api.sendMessage = vi.fn().mockResolvedValue(undefined)
	api.getConfiguration = () => ({ mode: "code" })
	api.setConfiguration = setConfiguration
	api.getCurrentTaskStack = () => [currentTask]
	api.isTaskInHistory = vi.fn().mockResolvedValue(true)

	const runtime = new BundleApiCliRuntime(
		{
			mode: "code",
			user: null,
			provider: "openai",
			model: "qwen3-coder",
			baseUrl: "http://127.0.0.1:8080/v1",
			workspacePath: "/workspace",
			extensionPath: "/extension",
			ephemeral: false,
			debug: false,
			exitOnComplete: false,
			disableOutput: true,
		},
		{
			loadBundle: vi.fn().mockResolvedValue({ api }),
			readTaskSessions: vi.fn().mockResolvedValue([
				{
					id: "task-1",
					task: "hello",
					ts: 100,
					workspace: "/workspace",
				},
			]),
			searchWorkspaceFiles,
		},
	)

	return {
		runtime,
		api,
		currentTask,
		startNewTask,
		resumeTask,
		clearCurrentTask,
		cancelCurrentTask,
		setConfiguration,
		searchWorkspaceFiles,
		approveAsk,
		denyAsk,
		submitUserMessage,
		addQueuedMessage,
	}
}

describe("BundleApiCliRuntime", () => {
	it("routes task controls through the activated bundle API", async () => {
		const {
			runtime,
			resumeTask,
			clearCurrentTask,
			cancelCurrentTask,
			setConfiguration,
			searchWorkspaceFiles,
			approveAsk,
			denyAsk,
			submitUserMessage,
			addQueuedMessage,
		} = createRuntimeHarness()

		const messages: unknown[] = []
		runtime.onMessage((message) => messages.push(message))

		await runtime.activate()

		runtime.selectTask("task-1")
		await Promise.resolve()
		expect(resumeTask).toHaveBeenCalledWith("task-1")

		runtime.sendTaskMessage("continue", ["image.png"])
		expect(submitUserMessage).toHaveBeenCalledWith("continue", ["image.png"])

		runtime.queueMessage("queued", ["queued.png"])
		expect(addQueuedMessage).toHaveBeenCalledWith("queued", ["queued.png"])

		runtime.approve()
		runtime.reject()
		expect(approveAsk).toHaveBeenCalledOnce()
		expect(denyAsk).toHaveBeenCalledOnce()

		runtime.setMode("architect")
		await Promise.resolve()
		expect(setConfiguration).toHaveBeenCalledWith({ mode: "architect" })

		runtime.searchFiles("index")
		await Promise.resolve()
		expect(searchWorkspaceFiles).toHaveBeenCalledWith({
			workspacePath: "/workspace",
			query: "index",
		})

		runtime.clearTask()
		await Promise.resolve()
		expect(clearCurrentTask).toHaveBeenCalledOnce()

		runtime.cancelTask()
		await Promise.resolve()
		expect(cancelCurrentTask).toHaveBeenCalledOnce()

		expect(messages.some((message) => (message as { type?: string }).type === "state")).toBe(true)
		expect(
			messages.some(
				(message) =>
					(message as { type?: string; results?: Array<{ path: string }> }).type === "fileSearchResults" &&
					(message as { results?: Array<{ path: string }> }).results?.[0]?.path === "src/index.ts",
			),
		).toBe(true)

		await runtime.dispose()
	})

	it("exposes runtime state helpers and json emitter attachment", async () => {
		const { runtime, api } = createRuntimeHarness()
		const attachToClient = vi.fn()
		const emitter = {
			attachToClient,
		} as unknown as JsonEventEmitter

		await runtime.activate()
		runtime.attachJsonEmitter(emitter)

		expect(runtime.getRuntimeOptions()).toEqual({
			provider: "openai",
			apiKey: undefined,
			baseUrl: "http://127.0.0.1:8080/v1",
		})

		const followupMessage = {
			ts: 2,
			type: "ask",
			ask: "followup",
			text: "Need input",
		} as const
		api.emit("message", { taskId: "task-1", action: "created", message: followupMessage })

		expect(runtime.isWaitingForInput()).toBe(true)
		expect(runtime.hasActiveTask()).toBe(true)
		expect(runtime.getCurrentAsk()).toBe("followup")
		expect(attachToClient).toHaveBeenCalledOnce()

		await runtime.dispose()
	})

	it("reads task history through the runtime boundary", async () => {
		const { runtime } = createRuntimeHarness()

		await runtime.activate()

		await expect(runtime.readTaskHistory()).resolves.toEqual([
			{
				id: "task-1",
				task: "hello",
				ts: 100,
				workspace: "/workspace",
			},
		])

		await runtime.dispose()
	})

	it("waits for resumed task history before publishing state", async () => {
		vi.useFakeTimers()

		try {
			const { runtime, currentTask, resumeTask } = createRuntimeHarness()
			const restoredMessage = {
				ts: 42,
				type: "say",
				say: "text",
				text: "restored history",
				partial: false,
			} as const satisfies ClineMessage
			const messages: unknown[] = []

			resumeTask.mockImplementation(async () => {
				setTimeout(() => {
					currentTask.clineMessages = [restoredMessage]
				}, 100)
			})

			runtime.onMessage((message) => messages.push(message))
			await runtime.activate()

			runtime.selectTask("task-1")
			await vi.advanceTimersByTimeAsync(250)

			const stateMessages = messages.filter(
				(message): message is { type: string; state?: { clineMessages?: ClineMessage[] } } =>
					typeof message === "object" && message !== null && (message as { type?: string }).type === "state",
			)
			const resumedState = stateMessages.find((message) =>
				message.state?.clineMessages?.some(
					(entry) => entry.ts === restoredMessage.ts && entry.text === restoredMessage.text,
				),
			)

			expect(resumedState).toBeDefined()
		} finally {
			vi.useRealTimers()
		}
	})
})
