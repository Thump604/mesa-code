import { describe, expect, it, vi } from "vitest"

import { CliSessionController } from "../session-controller.js"

function createRuntimeHarness(taskHistory = [{ id: "latest", task: "task", ts: 100, workspace: "/workspace" }]) {
	return {
		activate: vi.fn().mockResolvedValue(undefined),
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
		onMessage: vi.fn(),
		onTaskCompleted: vi.fn(),
		onError: vi.fn(),
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
		controller.selectTask("task-123")
		controller.setMode("architect")
		controller.searchFiles("@runtime")
		controller.clearTask()
		controller.sendTaskMessage("follow up")
		controller.queueMessage("queued follow up")
		controller.approve()
		controller.reject()
		controller.cancelTask()

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
