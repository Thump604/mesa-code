import type { ClineAsk, ClineMessage } from "@roo-code/types"

import {
	classifyAsk,
	shouldRouteAsAskResponse,
	sendApprovalResponse,
	AutoApprovalAdapter,
	InteractiveApprovalAdapter,
	type ApprovalRequest,
} from "../approval-adapter.js"

function makeMessage(ask: ClineAsk, text = ""): ClineMessage {
	return { type: "ask", ask, text, ts: Date.now() } as ClineMessage
}

// =============================================================================
// classifyAsk
// =============================================================================

describe("classifyAsk", () => {
	it.each(["command", "tool", "use_mcp_server"] as const)("classifies %s as approve", (ask) => {
		const result = classifyAsk(ask, makeMessage(ask))
		expect(result).not.toBeNull()
		expect(result!.kind).toBe("approve")
		expect(result!.ask).toBe(ask)
	})

	it("classifies followup as respond", () => {
		const result = classifyAsk("followup", makeMessage("followup"))
		expect(result).not.toBeNull()
		expect(result!.kind).toBe("respond")
	})

	it("classifies resume_task as continue", () => {
		const result = classifyAsk("resume_task", makeMessage("resume_task"))
		expect(result).not.toBeNull()
		expect(result!.kind).toBe("continue")
	})

	it("classifies completion_result as acknowledge", () => {
		const result = classifyAsk("completion_result", makeMessage("completion_result"))
		expect(result).not.toBeNull()
		expect(result!.kind).toBe("acknowledge")
	})

	it("classifies api_req_failed as retry", () => {
		const result = classifyAsk("api_req_failed", makeMessage("api_req_failed"))
		expect(result).not.toBeNull()
		expect(result!.kind).toBe("retry")
	})

	it.each(["mistake_limit_reached", "resume_completed_task", "auto_approval_max_req_reached"] as const)(
		"classifies %s as continue",
		(ask) => {
			const result = classifyAsk(ask, makeMessage(ask))
			expect(result).not.toBeNull()
			expect(result!.kind).toBe("continue")
		},
	)

	it("returns null for non-blocking asks (command_output)", () => {
		const result = classifyAsk("command_output", makeMessage("command_output"))
		expect(result).toBeNull()
	})

	it("returns null for unknown ask types", () => {
		const result = classifyAsk("unknown_ask" as ClineAsk, makeMessage("unknown_ask" as ClineAsk))
		expect(result).toBeNull()
	})
})

// =============================================================================
// shouldRouteAsAskResponse
// =============================================================================

describe("shouldRouteAsAskResponse", () => {
	it("returns false when not waiting for input", () => {
		expect(shouldRouteAsAskResponse(false, "tool")).toBe(false)
	})

	it("returns false when currentAsk is undefined", () => {
		expect(shouldRouteAsAskResponse(true, undefined)).toBe(false)
	})

	it("returns false for non-blocking asks", () => {
		expect(shouldRouteAsAskResponse(true, "command_output")).toBe(false)
	})

	it("returns false for unknown asks", () => {
		expect(shouldRouteAsAskResponse(true, "unknown_ask" as ClineAsk)).toBe(false)
	})

	it.each([
		"followup",
		"tool",
		"command",
		"use_mcp_server",
		"completion_result",
		"resume_task",
		"resume_completed_task",
		"mistake_limit_reached",
		"api_req_failed",
		"auto_approval_max_req_reached",
	] as ClineAsk[])("routes %s as ask response when waiting", (ask) => {
		expect(shouldRouteAsAskResponse(true, ask)).toBe(true)
	})
})

// =============================================================================
// sendApprovalResponse
// =============================================================================

describe("sendApprovalResponse", () => {
	it("calls approve for yesButtonClicked", () => {
		const target = { approve: vi.fn(), reject: vi.fn(), sendTaskMessage: vi.fn() }
		sendApprovalResponse(target, { response: "yesButtonClicked" })
		expect(target.approve).toHaveBeenCalledOnce()
		expect(target.reject).not.toHaveBeenCalled()
		expect(target.sendTaskMessage).not.toHaveBeenCalled()
	})

	it("calls reject for noButtonClicked", () => {
		const target = { approve: vi.fn(), reject: vi.fn(), sendTaskMessage: vi.fn() }
		sendApprovalResponse(target, { response: "noButtonClicked" })
		expect(target.reject).toHaveBeenCalledOnce()
		expect(target.approve).not.toHaveBeenCalled()
	})

	it("calls sendTaskMessage for messageResponse", () => {
		const target = { approve: vi.fn(), reject: vi.fn(), sendTaskMessage: vi.fn() }
		sendApprovalResponse(target, { response: "messageResponse", text: "hello", images: ["img.png"] })
		expect(target.sendTaskMessage).toHaveBeenCalledWith("hello", ["img.png"])
		expect(target.approve).not.toHaveBeenCalled()
	})

	it("sends empty text when messageResponse has no text", () => {
		const target = { approve: vi.fn(), reject: vi.fn(), sendTaskMessage: vi.fn() }
		sendApprovalResponse(target, { response: "messageResponse" })
		expect(target.sendTaskMessage).toHaveBeenCalledWith("", undefined)
	})
})

// =============================================================================
// AutoApprovalAdapter — parity: all asks auto-approve
// =============================================================================

describe("AutoApprovalAdapter", () => {
	const adapter = new AutoApprovalAdapter()

	it("approves interactive asks", async () => {
		const request: ApprovalRequest = { kind: "approve", ask: "tool", message: makeMessage("tool") }
		const response = await adapter.handle(request)
		expect(response.response).toBe("yesButtonClicked")
	})

	it("returns empty text for followup asks", async () => {
		const request: ApprovalRequest = { kind: "respond", ask: "followup", message: makeMessage("followup") }
		const response = await adapter.handle(request)
		expect(response.response).toBe("messageResponse")
		expect(response.text).toBe("")
	})

	it("auto-retries failed API requests", async () => {
		const request: ApprovalRequest = {
			kind: "retry",
			ask: "api_req_failed",
			message: makeMessage("api_req_failed", "connection timeout"),
		}
		const response = await adapter.handle(request)
		expect(response.response).toBe("yesButtonClicked")
	})

	it("auto-continues resumable asks", async () => {
		const request: ApprovalRequest = { kind: "continue", ask: "resume_task", message: makeMessage("resume_task") }
		const response = await adapter.handle(request)
		expect(response.response).toBe("yesButtonClicked")
	})

	it("auto-acknowledges completion", async () => {
		const request: ApprovalRequest = {
			kind: "acknowledge",
			ask: "completion_result",
			message: makeMessage("completion_result"),
		}
		const response = await adapter.handle(request)
		expect(response.response).toBe("yesButtonClicked")
	})
})

// =============================================================================
// InteractiveApprovalAdapter — parity: prompts for input
// =============================================================================

describe("InteractiveApprovalAdapter", () => {
	const makeDeps = (approveResult = true, inputResult = "answer") => ({
		promptForYesNo: vi.fn().mockResolvedValue(approveResult),
		promptForInput: vi.fn().mockResolvedValue(inputResult),
	})

	it("prompts yes/no for approval and returns approved", async () => {
		const deps = makeDeps(true)
		const adapter = new InteractiveApprovalAdapter(deps)
		const response = await adapter.handle({ kind: "approve", ask: "tool", message: makeMessage("tool") })
		expect(response.response).toBe("yesButtonClicked")
		expect(deps.promptForYesNo).toHaveBeenCalled()
	})

	it("prompts yes/no for approval and returns denied", async () => {
		const deps = makeDeps(false)
		const adapter = new InteractiveApprovalAdapter(deps)
		const response = await adapter.handle({ kind: "approve", ask: "command", message: makeMessage("command") })
		expect(response.response).toBe("noButtonClicked")
	})

	it("prompts for text on followup", async () => {
		const deps = makeDeps(true, "my response")
		const adapter = new InteractiveApprovalAdapter(deps)
		const response = await adapter.handle({ kind: "respond", ask: "followup", message: makeMessage("followup") })
		expect(response.response).toBe("messageResponse")
		expect(response.text).toBe("my response")
		expect(deps.promptForInput).toHaveBeenCalled()
	})

	it("throws on retry when exitOnError is set", async () => {
		const deps = makeDeps()
		const adapter = new InteractiveApprovalAdapter(deps, { exitOnError: true })
		const request: ApprovalRequest = {
			kind: "retry",
			ask: "api_req_failed",
			message: makeMessage("api_req_failed", "rate limit exceeded"),
		}
		await expect(adapter.handle(request)).rejects.toThrow("rate limit exceeded")
	})

	it("prompts for retry when exitOnError is not set", async () => {
		const deps = makeDeps(true)
		const adapter = new InteractiveApprovalAdapter(deps)
		const response = await adapter.handle({
			kind: "retry",
			ask: "api_req_failed",
			message: makeMessage("api_req_failed"),
		})
		expect(response.response).toBe("yesButtonClicked")
		expect(deps.promptForYesNo).toHaveBeenCalled()
	})

	it("auto-continues resumable asks without prompting", async () => {
		const deps = makeDeps()
		const adapter = new InteractiveApprovalAdapter(deps)
		const response = await adapter.handle({
			kind: "continue",
			ask: "resume_task",
			message: makeMessage("resume_task"),
		})
		expect(response.response).toBe("yesButtonClicked")
		expect(deps.promptForYesNo).not.toHaveBeenCalled()
	})

	it("auto-acknowledges completion without prompting", async () => {
		const deps = makeDeps()
		const adapter = new InteractiveApprovalAdapter(deps)
		const response = await adapter.handle({
			kind: "acknowledge",
			ask: "completion_result",
			message: makeMessage("completion_result"),
		})
		expect(response.response).toBe("yesButtonClicked")
		expect(deps.promptForYesNo).not.toHaveBeenCalled()
	})

	it("fails closed to noButtonClicked when prompt throws", async () => {
		const deps = {
			promptForYesNo: vi.fn().mockRejectedValue(new Error("stdin closed")),
			promptForInput: vi.fn().mockRejectedValue(new Error("stdin closed")),
		}
		const adapter = new InteractiveApprovalAdapter(deps)
		const response = await adapter.handle({ kind: "approve", ask: "tool", message: makeMessage("tool") })
		expect(response.response).toBe("noButtonClicked")
	})

	it("returns empty text when followup prompt throws", async () => {
		const deps = {
			promptForYesNo: vi.fn(),
			promptForInput: vi.fn().mockRejectedValue(new Error("stdin closed")),
		}
		const adapter = new InteractiveApprovalAdapter(deps)
		const response = await adapter.handle({
			kind: "respond",
			ask: "followup",
			message: makeMessage("followup"),
		})
		expect(response.response).toBe("messageResponse")
		expect(response.text).toBe("")
	})
})

// =============================================================================
// Parity: classifyAsk covers all asks that shouldRouteAsAskResponse routes
// =============================================================================

describe("classification parity", () => {
	const ALL_KNOWN_ASKS: ClineAsk[] = [
		"followup",
		"command",
		"command_output",
		"completion_result",
		"tool",
		"api_req_failed",
		"resume_task",
		"resume_completed_task",
		"mistake_limit_reached",
		"use_mcp_server",
		"auto_approval_max_req_reached",
	]

	it("shouldRouteAsAskResponse agrees with classifyAsk for all known ask types", () => {
		for (const ask of ALL_KNOWN_ASKS) {
			const classified = classifyAsk(ask, makeMessage(ask))
			const routed = shouldRouteAsAskResponse(true, ask)
			expect(routed).toBe(classified !== null)
		}
	})

	it("both adapters handle every classified ask type without throwing", async () => {
		const auto = new AutoApprovalAdapter()
		const interactive = new InteractiveApprovalAdapter({
			promptForYesNo: vi.fn().mockResolvedValue(true),
			promptForInput: vi.fn().mockResolvedValue(""),
		})

		for (const ask of ALL_KNOWN_ASKS) {
			const request = classifyAsk(ask, makeMessage(ask))
			if (!request) continue

			const autoResponse = await auto.handle(request)
			expect(autoResponse.response).toBeDefined()

			const interactiveResponse = await interactive.handle(request)
			expect(interactiveResponse.response).toBeDefined()
		}
	})
})
