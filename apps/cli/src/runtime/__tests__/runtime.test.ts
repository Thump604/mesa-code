import { EventEmitter } from "events"

import { describe, expect, it, vi } from "vitest"

import type { ClineMessage } from "@roo-code/types"

import type { JsonEventEmitter } from "@/agent/json-event-emitter.js"

import { BundleApiCliRuntime } from "../bundle-runtime.js"

function createRuntimeHarness() {
	const startNewTask = vi.fn().mockResolvedValue("task-1")
	const resumeTask = vi.fn().mockResolvedValue(undefined)
	const clearCurrentTask = vi.fn().mockResolvedValue(undefined)
	const cancelCurrentTask = vi.fn().mockResolvedValue(undefined)
	const sendMessage = vi.fn().mockResolvedValue(undefined)
	const pressPrimaryButton = vi.fn().mockResolvedValue(undefined)
	const pressSecondaryButton = vi.fn().mockResolvedValue(undefined)
	const setConfiguration = vi.fn().mockResolvedValue(undefined)
	const searchWorkspaceFiles = vi
		.fn()
		.mockResolvedValue([{ path: "src/index.ts", type: "file" as const, label: "index.ts" }])

	const api = new EventEmitter() as EventEmitter & {
		startNewTask: typeof startNewTask
		resumeTask: typeof resumeTask
		clearCurrentTask: typeof clearCurrentTask
		cancelCurrentTask: typeof cancelCurrentTask
		sendMessage: typeof sendMessage
		pressPrimaryButton: typeof pressPrimaryButton
		pressSecondaryButton: typeof pressSecondaryButton
		getConfiguration: () => { mode: string }
		setConfiguration: typeof setConfiguration
		getCurrentTaskStack: () => string[]
		isTaskInHistory: (taskId: string) => Promise<boolean>
	}

	api.startNewTask = startNewTask
	api.resumeTask = resumeTask
	api.clearCurrentTask = clearCurrentTask
	api.cancelCurrentTask = cancelCurrentTask
	api.sendMessage = sendMessage
	api.pressPrimaryButton = pressPrimaryButton
	api.pressSecondaryButton = pressSecondaryButton
	api.getConfiguration = () => ({ mode: "code" })
	api.setConfiguration = setConfiguration
	api.getCurrentTaskStack = () => ["task-1"]
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
		startNewTask,
		resumeTask,
		clearCurrentTask,
		cancelCurrentTask,
		sendMessage,
		pressPrimaryButton,
		pressSecondaryButton,
		setConfiguration,
		searchWorkspaceFiles,
	}
}

describe("BundleApiCliRuntime", () => {
	it("routes task controls through the activated bundle API", async () => {
		const {
			runtime,
			resumeTask,
			clearCurrentTask,
			cancelCurrentTask,
			sendMessage,
			pressPrimaryButton,
			pressSecondaryButton,
			setConfiguration,
			searchWorkspaceFiles,
		} = createRuntimeHarness()

		const messages: unknown[] = []
		runtime.onMessage((message) => messages.push(message))

		await runtime.activate()

		runtime.selectTask("task-1")
		await Promise.resolve()
		expect(resumeTask).toHaveBeenCalledWith("task-1")

		runtime.sendTaskMessage("continue", ["image.png"])
		await Promise.resolve()
		expect(sendMessage).toHaveBeenCalledWith("continue", ["image.png"])

		runtime.queueMessage("queued", ["queued.png"])
		await Promise.resolve()
		expect(sendMessage).toHaveBeenCalledWith("queued", ["queued.png"])

		runtime.approve()
		runtime.reject()
		await Promise.resolve()
		expect(pressPrimaryButton).toHaveBeenCalledOnce()
		expect(pressSecondaryButton).toHaveBeenCalledOnce()

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

	it("separates task launch from completion waiting", async () => {
		const { runtime, startNewTask, resumeTask } = createRuntimeHarness()

		await runtime.activate()

		await runtime.startTask("launch only", "task-launch")
		await runtime.showTask("task-resume")

		expect(startNewTask).toHaveBeenCalledWith({
			configuration: {},
			text: "launch only",
			images: undefined,
			newTab: undefined,
		})
		expect(resumeTask).toHaveBeenCalledWith("task-resume")

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
			const { runtime, api, resumeTask } = createRuntimeHarness()
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
					api.emit("message", { taskId: "task-1", action: "created", message: restoredMessage })
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
