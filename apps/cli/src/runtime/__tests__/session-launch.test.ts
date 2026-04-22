import { describe, expect, it, vi } from "vitest"

import type { CliRuntime } from "../runtime.js"
import {
	activateCliRuntimeSession,
	executeInitialSessionLaunch,
	resolveInitialSessionLaunch,
} from "../session-launch.js"

function createRuntimeHarness(taskHistory = [{ id: "latest", task: "task", ts: 100, workspace: "/workspace" }]) {
	return {
		activate: vi.fn().mockResolvedValue(undefined),
		onMessage: vi.fn(),
		onTaskCompleted: vi.fn(),
		onError: vi.fn(),
		readTaskHistory: vi.fn().mockResolvedValue(taskHistory),
		runTask: vi.fn().mockResolvedValue(undefined),
		resumeTask: vi.fn().mockResolvedValue(undefined),
	}
}

describe("resolveInitialSessionLaunch", () => {
	it("returns idle when there is no initial prompt or resume request", async () => {
		const runtime = createRuntimeHarness()

		await expect(resolveInitialSessionLaunch(runtime, {})).resolves.toEqual({ kind: "idle" })
		expect(runtime.readTaskHistory).not.toHaveBeenCalled()
	})

	it("returns a start launch when an initial prompt is provided", async () => {
		const runtime = createRuntimeHarness()

		await expect(
			resolveInitialSessionLaunch(runtime, {
				initialPrompt: "Summarize this repository",
				initialTaskId: "  task-123  ",
			}),
		).resolves.toEqual({
			kind: "start",
			prompt: "Summarize this repository",
			taskId: "task-123",
		})
		expect(runtime.readTaskHistory).not.toHaveBeenCalled()
	})

	it("returns a resume launch for an explicit session id", async () => {
		const runtime = createRuntimeHarness([
			{ id: "task-123", task: "task", ts: 100, workspace: "/workspace" },
			{ id: "task-456", task: "older", ts: 50, workspace: "/workspace" },
		])

		await expect(
			resolveInitialSessionLaunch(runtime, {
				initialSessionId: " task-123 ",
			}),
		).resolves.toEqual({
			kind: "resume",
			sessionId: "task-123",
		})
		expect(runtime.readTaskHistory).toHaveBeenCalledOnce()
	})

	it("resolves --continue to the newest session in the current workspace", async () => {
		const runtime = createRuntimeHarness([
			{ id: "task-new", task: "new", ts: 200, workspace: "/workspace" },
			{ id: "task-old", task: "old", ts: 100, workspace: "/workspace" },
		])

		await expect(
			resolveInitialSessionLaunch(runtime, {
				continueSession: true,
			}),
		).resolves.toEqual({
			kind: "resume",
			sessionId: "task-new",
		})
		expect(runtime.readTaskHistory).toHaveBeenCalledOnce()
	})
})

describe("executeInitialSessionLaunch", () => {
	it("runs a new task for start launches", async () => {
		const runtime = createRuntimeHarness()

		await executeInitialSessionLaunch(runtime, {
			kind: "start",
			prompt: "Explain the current architecture",
			taskId: "task-123",
		})

		expect(runtime.runTask).toHaveBeenCalledWith("Explain the current architecture", "task-123")
		expect(runtime.resumeTask).not.toHaveBeenCalled()
	})

	it("resumes the selected session for resume launches", async () => {
		const runtime = createRuntimeHarness()

		await executeInitialSessionLaunch(runtime, {
			kind: "resume",
			sessionId: "task-456",
		})

		expect(runtime.resumeTask).toHaveBeenCalledWith("task-456")
		expect(runtime.runTask).not.toHaveBeenCalled()
	})

	it("does nothing for idle launches", async () => {
		const runtime = createRuntimeHarness()

		await expect(executeInitialSessionLaunch(runtime, { kind: "idle" })).resolves.toBeUndefined()
		expect(runtime.runTask).not.toHaveBeenCalled()
		expect(runtime.resumeTask).not.toHaveBeenCalled()
	})
})

describe("activateCliRuntimeSession", () => {
	it("activates the runtime, binds listeners, and returns the resolved launch", async () => {
		const runtime = createRuntimeHarness([{ id: "task-new", task: "new", ts: 200, workspace: "/workspace" }])
		const onMessage = vi.fn()
		const onTaskCompleted = vi.fn()
		const onError = vi.fn()
		const afterActivate = vi.fn()

		await expect(
			activateCliRuntimeSession({
				runtime: runtime as unknown as CliRuntime,
				initialLaunch: { continueSession: true },
				onMessage,
				onTaskCompleted,
				onError,
				afterActivate,
			}),
		).resolves.toEqual({
			kind: "resume",
			sessionId: "task-new",
		})

		expect(runtime.onMessage).toHaveBeenCalledWith(onMessage)
		expect(runtime.onTaskCompleted).toHaveBeenCalledOnce()
		expect(runtime.onError).toHaveBeenCalledWith(onError)
		expect(runtime.activate).toHaveBeenCalledOnce()
		expect(afterActivate).toHaveBeenCalledWith(runtime)
		expect(runtime.readTaskHistory).toHaveBeenCalledOnce()
	})
})
