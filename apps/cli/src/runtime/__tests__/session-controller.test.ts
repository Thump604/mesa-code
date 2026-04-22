import { describe, expect, it, vi } from "vitest"

import { CliSessionController } from "../session-controller.js"

function createRuntimeHarness(taskHistory = [{ id: "latest", task: "task", ts: 100, workspace: "/workspace" }]) {
	return {
		activate: vi.fn().mockResolvedValue(undefined),
		startTask: vi.fn().mockResolvedValue(undefined),
		showTask: vi.fn().mockResolvedValue(undefined),
		waitForTaskCompletion: vi.fn().mockResolvedValue(undefined),
		runTask: vi.fn().mockResolvedValue(undefined),
		resumeTask: vi.fn().mockResolvedValue(undefined),
		refreshCliMetadata: vi.fn(),
		requestRooModels: vi.fn(),
		selectTask: vi.fn(),
		setMode: vi.fn(),
		searchFiles: vi.fn(),
		clearTask: vi.fn(),
		sendTaskMessage: vi.fn(),
		queueMessage: vi.fn(),
		approve: vi.fn(),
		reject: vi.fn(),
		onMessage: vi.fn().mockReturnValue(vi.fn()),
		onTaskCompleted: vi.fn().mockReturnValue(vi.fn()),
		onError: vi.fn().mockReturnValue(vi.fn()),
		attachJsonEmitter: vi.fn(),
		readTaskHistory: vi.fn().mockResolvedValue(taskHistory),
		getRuntimeOptions: vi.fn().mockReturnValue({
			provider: "openai",
			apiKey: "sk-local",
			baseUrl: "http://127.0.0.1:8080/v1",
		}),
		getAgentState: vi.fn().mockReturnValue({
			isWaitingForInput: false,
			currentAsk: undefined,
			hasActiveTask: false,
		}),
		isWaitingForInput: vi.fn().mockReturnValue(false),
		hasActiveTask: vi.fn().mockReturnValue(false),
		getCurrentAsk: vi.fn().mockReturnValue(undefined),
		cancelTask: vi.fn(),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
}

describe("CliSessionController", () => {
	it("starts once, exposes the runtime action surface, and cleans up idempotently", async () => {
		const runtime = createRuntimeHarness()
		const createCliRuntime = vi.fn().mockReturnValue(runtime)
		const controller = new CliSessionController({
			createCliRuntime,
			runtimeOptions: {
				mode: "code",
				user: null,
				provider: "openai",
				model: "qwen3.6-27b",
				baseUrl: "http://127.0.0.1:8080/v1",
				workspacePath: "/workspace",
				extensionPath: "/extension",
				ephemeral: false,
				debug: false,
				exitOnComplete: false,
			},
		})
		const onStart = vi.fn().mockResolvedValue(undefined)
		const onMessage = vi.fn()
		const onTaskCompleted = vi.fn()
		const onError = vi.fn()

		await expect(
			controller.start({
				initialLaunch: { initialPrompt: "Summarize the repo" },
				onStart,
			}),
		).resolves.toMatchObject({
			runtime,
			launch: {
				kind: "start",
				prompt: "Summarize the repo",
			},
		})

		expect(createCliRuntime).toHaveBeenCalledOnce()
		expect(runtime.activate).toHaveBeenCalledOnce()
		expect(onStart).toHaveBeenCalledWith({
			kind: "start",
			prompt: "Summarize the repo",
			taskId: undefined,
		})

		controller.refreshCliMetadata()
		await controller.startTask("Summarize", "task-456", { autoApprovalEnabled: true }, ["image.png"])
		await controller.showTask("task-123")
		await controller.waitForTaskCompletion()
		const disposeMessage = controller.onMessage(onMessage)
		const disposeTaskCompleted = controller.onTaskCompleted(onTaskCompleted)
		const disposeError = controller.onError(onError)
		controller.selectTask("task-123")
		controller.setMode("architect")
		controller.searchFiles("@runtime")
		controller.clearTask()
		controller.sendTaskMessage("follow up")
		controller.queueMessage("queued follow up")
		controller.approve()
		controller.reject()
		controller.cancelTask()

		expect(runtime.startTask).toHaveBeenCalledWith("Summarize", "task-456", { autoApprovalEnabled: true }, [
			"image.png",
		])
		expect(runtime.showTask).toHaveBeenCalledWith("task-123")
		expect(runtime.waitForTaskCompletion).toHaveBeenCalledOnce()
		expect(runtime.onMessage).toHaveBeenCalledWith(onMessage)
		expect(runtime.onTaskCompleted).toHaveBeenCalledWith(onTaskCompleted)
		expect(runtime.onError).toHaveBeenCalledWith(onError)
		expect(runtime.refreshCliMetadata).toHaveBeenCalledOnce()
		expect(runtime.selectTask).toHaveBeenCalledWith("task-123")
		expect(runtime.setMode).toHaveBeenCalledWith("architect")
		expect(runtime.searchFiles).toHaveBeenCalledWith("@runtime")
		expect(runtime.clearTask).toHaveBeenCalledOnce()
		expect(runtime.sendTaskMessage).toHaveBeenCalledWith("follow up", undefined)
		expect(runtime.queueMessage).toHaveBeenCalledWith("queued follow up", undefined)
		expect(runtime.approve).toHaveBeenCalledOnce()
		expect(runtime.reject).toHaveBeenCalledOnce()
		expect(runtime.cancelTask).toHaveBeenCalledOnce()
		expect(controller.getAgentState()).toEqual({
			isWaitingForInput: false,
			currentAsk: undefined,
			hasActiveTask: false,
		})
		expect(controller.isWaitingForInput()).toBe(false)
		expect(controller.hasActiveTask()).toBe(false)
		expect(controller.getCurrentAsk()).toBeUndefined()

		disposeMessage()
		disposeTaskCompleted()
		disposeError()
		await controller.cleanup()
		await controller.cleanup()

		expect(runtime.dispose).toHaveBeenCalledOnce()
		expect(controller.getRuntime()).toBeNull()
		expect(controller.getLaunch()).toBeNull()
	})

	it("fails closed when callers touch the runtime before start", () => {
		const controller = new CliSessionController({
			createCliRuntime: vi.fn(),
			runtimeOptions: {
				mode: "code",
				user: null,
				provider: "openai",
				model: "qwen3.6-27b",
				baseUrl: "http://127.0.0.1:8080/v1",
				workspacePath: "/workspace",
				extensionPath: "/extension",
				ephemeral: false,
				debug: false,
				exitOnComplete: false,
			},
		})

		expect(() => controller.getRuntimeOrThrow()).toThrow("CLI runtime not ready")
		expect(() => controller.refreshCliMetadata()).toThrow("CLI runtime not ready")
	})

	it("rejects duplicate starts", async () => {
		const runtime = createRuntimeHarness()
		const controller = new CliSessionController({
			createCliRuntime: vi.fn().mockReturnValue(runtime),
			runtimeOptions: {
				mode: "code",
				user: null,
				provider: "openai",
				model: "qwen3.6-27b",
				baseUrl: "http://127.0.0.1:8080/v1",
				workspacePath: "/workspace",
				extensionPath: "/extension",
				ephemeral: false,
				debug: false,
				exitOnComplete: false,
			},
		})

		await controller.start({
			initialLaunch: { initialPrompt: "Summarize the repo" },
		})

		await expect(
			controller.start({
				initialLaunch: { initialPrompt: "Summarize the repo again" },
			}),
		).rejects.toThrow("CLI session controller already started")
	})
})
