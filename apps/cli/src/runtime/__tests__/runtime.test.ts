import { describe, expect, it, vi } from "vitest"

import { AgentLoopState, type AgentStateInfo } from "@/agent/agent-state.js"
import type { ExtensionHost } from "@/agent/extension-host.js"
import type { JsonEventEmitter } from "@/agent/json-event-emitter.js"

import { ExtensionBackedCliRuntime } from "../runtime.js"

const AGENT_STATE: AgentStateInfo = {
	state: AgentLoopState.WAITING_FOR_INPUT,
	isWaitingForInput: true,
	isRunning: false,
	isStreaming: false,
	currentAsk: "followup",
	requiredAction: "answer",
	description: "waiting for input",
}

function createHostStub() {
	const offTaskCompleted = vi.fn()
	const offError = vi.fn()

	const host = {
		activate: vi.fn().mockResolvedValue(undefined),
		runTask: vi.fn().mockResolvedValue(undefined),
		resumeTask: vi.fn().mockResolvedValue(undefined),
		sendToExtension: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
		getRuntimeOptions: vi.fn().mockReturnValue({
			provider: "openai",
			apiKey: "test-key",
			baseUrl: "http://127.0.0.1:8080/v1",
		}),
		getAgentState: vi.fn().mockReturnValue(AGENT_STATE),
		isWaitingForInput: vi.fn().mockReturnValue(true),
		dispose: vi.fn().mockResolvedValue(undefined),
		client: {
			on: vi.fn((event: string) => {
				if (event === "taskCompleted") {
					return offTaskCompleted
				}

				if (event === "error") {
					return offError
				}

				return vi.fn()
			}),
			hasActiveTask: vi.fn().mockReturnValue(true),
			getCurrentAsk: vi.fn().mockReturnValue("followup"),
			cancelTask: vi.fn(),
		},
	}

	return {
		host: host as unknown as ExtensionHost,
		rawHost: host,
		offTaskCompleted,
		offError,
	}
}

describe("ExtensionBackedCliRuntime", () => {
	it("delegates runtime message and task controls to the extension-backed host", async () => {
		const { host, rawHost } = createHostStub()
		const runtime = new ExtensionBackedCliRuntime(host)

		await runtime.activate()
		await runtime.runTask("hello", "task-1")
		await runtime.resumeTask("task-1")
		runtime.sendMessage({ type: "requestModes" })
		runtime.cancelTask()

		expect(rawHost.activate).toHaveBeenCalledOnce()
		expect(rawHost.runTask).toHaveBeenCalledWith("hello", "task-1", undefined, undefined)
		expect(rawHost.resumeTask).toHaveBeenCalledWith("task-1")
		expect(rawHost.sendToExtension).toHaveBeenCalledWith({ type: "requestModes" })
		expect(rawHost.client.cancelTask).toHaveBeenCalledOnce()
	})

	it("wraps extension-host events behind runtime subscriptions", () => {
		const { host, rawHost, offTaskCompleted, offError } = createHostStub()
		const runtime = new ExtensionBackedCliRuntime(host)
		const onMessage = vi.fn()
		const onTaskCompleted = vi.fn()
		const onError = vi.fn()

		const unsubscribeMessage = runtime.onMessage(onMessage)
		const unsubscribeTaskCompleted = runtime.onTaskCompleted(onTaskCompleted)
		const unsubscribeError = runtime.onError(onError)

		expect(rawHost.on).toHaveBeenCalledWith("extensionWebviewMessage", expect.any(Function))
		expect(rawHost.client.on).toHaveBeenCalledWith("taskCompleted", onTaskCompleted)
		expect(rawHost.client.on).toHaveBeenCalledWith("error", onError)

		const messageHandler = rawHost.on.mock.calls[0]?.[1] as ((message: unknown) => void) | undefined
		expect(messageHandler).toBeTypeOf("function")

		messageHandler?.({ type: "state" })
		expect(onMessage).toHaveBeenCalledWith({ type: "state" })

		unsubscribeMessage()
		unsubscribeTaskCompleted()
		unsubscribeError()

		expect(rawHost.off).toHaveBeenCalledWith("extensionWebviewMessage", messageHandler)
		expect(offTaskCompleted).toHaveBeenCalledOnce()
		expect(offError).toHaveBeenCalledOnce()
	})

	it("exposes runtime state helpers and json-emitter attachment", async () => {
		const { host, rawHost } = createHostStub()
		const runtime = new ExtensionBackedCliRuntime(host)
		const attachToClient = vi.fn()
		const emitter = {
			attachToClient,
		} as unknown as JsonEventEmitter

		runtime.attachJsonEmitter(emitter)

		expect(runtime.getRuntimeOptions()).toEqual({
			provider: "openai",
			apiKey: "test-key",
			baseUrl: "http://127.0.0.1:8080/v1",
		})
		expect(runtime.getAgentState()).toEqual(AGENT_STATE)
		expect(runtime.isWaitingForInput()).toBe(true)
		expect(runtime.hasActiveTask()).toBe(true)
		expect(runtime.getCurrentAsk()).toBe("followup")
		expect(attachToClient).toHaveBeenCalledWith(rawHost.client)

		await runtime.dispose()
		expect(rawHost.dispose).toHaveBeenCalledOnce()
	})
})
