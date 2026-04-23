import type { ClineMessage, ClineAskResponse } from "@roo-code/types"

import { AskDispatcher, type AskDispatcherOptions } from "../ask-dispatcher.js"

function makeAskMessage(ask: string, text = "", ts = Date.now()): ClineMessage {
	return { type: "ask", ask, text, ts, partial: false } as ClineMessage
}

function createDispatcher(
	overrides: Partial<AskDispatcherOptions> & { responses?: Map<string, boolean | string> } = {},
) {
	const sent: Array<{ response: ClineAskResponse; text?: string }> = []
	const output: string[] = []

	const responses = overrides.responses ?? new Map<string, boolean | string>()

	const outputManager = {
		output: (...args: string[]) => output.push(args.join(" ")),
		outputMessage: () => {},
		outputCompletionResult: () => {},
		markDisplayed: () => {},
		clear: () => {},
	}

	const promptManager = {
		promptForYesNo: vi.fn(async (prompt: string) => {
			const value = responses.get(prompt)
			if (value === undefined) return true
			if (typeof value === "boolean") return value
			return value === "y"
		}),
		promptForInput: vi.fn(async () => {
			return (responses.get("input") as string) ?? ""
		}),
		promptWithTimeout: vi.fn(async (_prompt: string, _timeoutMs: number, defaultValue: string) => {
			return { value: defaultValue, timedOut: true, cancelled: false }
		}),
	}

	const options: AskDispatcherOptions = {
		outputManager: outputManager as unknown as AskDispatcherOptions["outputManager"],
		promptManager: promptManager as unknown as AskDispatcherOptions["promptManager"],
		sendAskResponse: (response, text) => sent.push({ response, text }),
		nonInteractive: overrides.nonInteractive ?? false,
		exitOnError: overrides.exitOnError ?? false,
		disabled: overrides.disabled ?? false,
	}

	const dispatcher = new AskDispatcher(options)
	return { dispatcher, sent, output, promptManager }
}

// =============================================================================
// AskDispatcher routes through shared classifyAsk + ApprovalAdapter
// =============================================================================

describe("AskDispatcher", () => {
	describe("interactive mode (uses InteractiveApprovalAdapter)", () => {
		it("prompts for tool approval and sends approved response", async () => {
			const { dispatcher, sent } = createDispatcher()
			const message = makeAskMessage("tool", JSON.stringify({ tool: "write_to_file", path: "/tmp/x" }))

			const result = await dispatcher.handleAsk(message)

			expect(result.handled).toBe(true)
			expect(result.response).toBe("yesButtonClicked")
			expect(sent).toHaveLength(1)
			expect(sent[0]!.response).toBe("yesButtonClicked")
		})

		it("prompts for tool approval and sends denied response", async () => {
			const responses = new Map([["Approve? (y/n): ", false]])
			const { dispatcher, sent } = createDispatcher({ responses })
			const message = makeAskMessage("tool", JSON.stringify({ tool: "write_to_file" }))

			const result = await dispatcher.handleAsk(message)

			expect(result.handled).toBe(true)
			expect(result.response).toBe("noButtonClicked")
			expect(sent[0]!.response).toBe("noButtonClicked")
		})

		it("prompts for command approval", async () => {
			const { dispatcher, sent, output } = createDispatcher()
			const message = makeAskMessage("command", "rm -rf /tmp/test")

			await dispatcher.handleAsk(message)

			expect(sent[0]!.response).toBe("yesButtonClicked")
			expect(output.some((o) => o.includes("[command request]"))).toBe(true)
		})

		it("prompts for MCP approval", async () => {
			const { dispatcher, sent, output } = createDispatcher()
			const message = makeAskMessage("use_mcp_server", JSON.stringify({ server_name: "data-lookup" }))

			await dispatcher.handleAsk(message)

			expect(sent[0]!.response).toBe("yesButtonClicked")
			expect(output.some((o) => o.includes("[mcp request]"))).toBe(true)
		})

		it("prompts for text on followup and sends messageResponse", async () => {
			const responses = new Map([["input", "my answer"]])
			const { dispatcher, sent } = createDispatcher({ responses })
			const message = makeAskMessage("followup", JSON.stringify({ question: "What do you think?" }))

			const result = await dispatcher.handleAsk(message)

			expect(result.response).toBe("messageResponse")
			expect(sent[0]!.response).toBe("messageResponse")
			expect(sent[0]!.text).toBe("my answer")
		})

		it("prompts for retry on api_req_failed", async () => {
			const { dispatcher, sent, output } = createDispatcher()
			const message = makeAskMessage("api_req_failed", "rate limit exceeded")

			await dispatcher.handleAsk(message)

			expect(sent[0]!.response).toBe("yesButtonClicked")
			expect(output.some((o) => o.includes("[api request failed]"))).toBe(true)
		})

		it("auto-continues resume_task without prompting", async () => {
			const { dispatcher, sent } = createDispatcher()
			const message = makeAskMessage("resume_task", "Previous task state")

			await dispatcher.handleAsk(message)

			expect(sent[0]!.response).toBe("yesButtonClicked")
		})

		it("auto-acknowledges completion_result without sending a response", async () => {
			const { dispatcher, sent } = createDispatcher()
			const message = makeAskMessage("completion_result", "Done!")

			const result = await dispatcher.handleAsk(message)

			expect(result.handled).toBe(true)
			// completion_result is extension-auto-handled (no response sent)
			// In interactive mode, isExtensionAutoHandled returns false,
			// but the adapter returns yesButtonClicked for acknowledge
			expect(sent).toHaveLength(1)
			expect(sent[0]!.response).toBe("yesButtonClicked")
		})
	})

	describe("non-interactive mode (uses AutoApprovalAdapter)", () => {
		it("does not send response for tool asks (extension auto-handles)", async () => {
			const { dispatcher, sent } = createDispatcher({ nonInteractive: true })
			const message = makeAskMessage("tool", JSON.stringify({ tool: "read_file" }))

			const result = await dispatcher.handleAsk(message)

			expect(result.handled).toBe(true)
			expect(sent).toHaveLength(0) // Extension handles it
		})

		it("does not send response for command asks (extension auto-handles)", async () => {
			const { dispatcher, sent } = createDispatcher({ nonInteractive: true })
			const message = makeAskMessage("command", "ls -la")

			const result = await dispatcher.handleAsk(message)

			expect(result.handled).toBe(true)
			expect(sent).toHaveLength(0)
		})

		it("does not send response for MCP asks (extension auto-handles)", async () => {
			const { dispatcher, sent } = createDispatcher({ nonInteractive: true })
			const message = makeAskMessage("use_mcp_server", JSON.stringify({ server_name: "test" }))

			const result = await dispatcher.handleAsk(message)

			expect(result.handled).toBe(true)
			expect(sent).toHaveLength(0)
		})

		it("does not send response for api_req_failed (extension auto-retries)", async () => {
			const { dispatcher, sent, output } = createDispatcher({ nonInteractive: true })
			const message = makeAskMessage("api_req_failed", "timeout")

			await dispatcher.handleAsk(message)

			expect(sent).toHaveLength(0)
			expect(output.some((o) => o.includes("[retrying api request]"))).toBe(true)
		})

		it("sends yesButtonClicked for mistake_limit_reached", async () => {
			const { dispatcher, sent } = createDispatcher({ nonInteractive: true })
			const message = makeAskMessage("mistake_limit_reached", "Too many errors")

			await dispatcher.handleAsk(message)

			expect(sent).toHaveLength(1)
			expect(sent[0]!.response).toBe("yesButtonClicked")
		})

		it("sends yesButtonClicked for auto_approval_max_req_reached", async () => {
			const { dispatcher, sent } = createDispatcher({ nonInteractive: true })
			const message = makeAskMessage("auto_approval_max_req_reached")

			await dispatcher.handleAsk(message)

			expect(sent).toHaveLength(1)
			expect(sent[0]!.response).toBe("yesButtonClicked")
		})

		it("sends yesButtonClicked for resume_task", async () => {
			const { dispatcher, sent, output } = createDispatcher({ nonInteractive: true })
			const message = makeAskMessage("resume_task")

			await dispatcher.handleAsk(message)

			expect(sent).toHaveLength(1)
			expect(sent[0]!.response).toBe("yesButtonClicked")
			expect(output.some((o) => o.includes("[continuing task]"))).toBe(true)
		})

		it("uses timeout prompt for followup in non-interactive mode", async () => {
			const { dispatcher, sent, promptManager } = createDispatcher({ nonInteractive: true })
			const message = makeAskMessage(
				"followup",
				JSON.stringify({ question: "Pick one", suggest: [{ answer: "A" }] }),
			)

			await dispatcher.handleAsk(message)

			expect(sent).toHaveLength(1)
			expect(sent[0]!.response).toBe("messageResponse")
			expect(promptManager.promptWithTimeout).toHaveBeenCalled()
		})
	})

	describe("dedup and validation", () => {
		it("skips already-handled asks", async () => {
			const { dispatcher, sent } = createDispatcher({ nonInteractive: true })
			const message = makeAskMessage("mistake_limit_reached")

			await dispatcher.handleAsk(message)
			await dispatcher.handleAsk(message) // same ts

			expect(sent).toHaveLength(1)
		})

		it("skips non-ask messages", async () => {
			const { dispatcher, sent } = createDispatcher()
			const message = { type: "say", text: "hello", ts: Date.now() } as ClineMessage

			const result = await dispatcher.handleAsk(message)

			expect(result.handled).toBe(false)
			expect(sent).toHaveLength(0)
		})

		it("skips partial messages", async () => {
			const { dispatcher, sent } = createDispatcher()
			const message = { type: "ask", ask: "tool", text: "partial", ts: Date.now(), partial: true } as ClineMessage

			const result = await dispatcher.handleAsk(message)

			expect(result.handled).toBe(false)
			expect(sent).toHaveLength(0)
		})

		it("returns handled: false when disabled (TUI mode)", async () => {
			const { dispatcher, sent } = createDispatcher({ disabled: true })
			const message = makeAskMessage("tool", JSON.stringify({ tool: "read_file" }))

			const result = await dispatcher.handleAsk(message)

			expect(result.handled).toBe(false)
			expect(sent).toHaveLength(0)
		})
	})

	describe("fail-closed behavior", () => {
		it("fails closed to noButtonClicked when prompt throws in interactive mode", async () => {
			const { dispatcher, sent, promptManager } = createDispatcher()
			;(promptManager.promptForYesNo as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("stdin closed"))
			const message = makeAskMessage("tool", JSON.stringify({ tool: "write_to_file" }))

			const result = await dispatcher.handleAsk(message)

			expect(result.handled).toBe(true)
			expect(result.response).toBe("noButtonClicked")
			expect(sent[0]!.response).toBe("noButtonClicked")
		})

		it("returns empty text when followup prompt throws", async () => {
			const { dispatcher, sent, promptManager } = createDispatcher()
			;(promptManager.promptForInput as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("stdin closed"))
			const message = makeAskMessage("followup", "What?")

			await dispatcher.handleAsk(message)

			expect(sent[0]!.response).toBe("messageResponse")
			expect(sent[0]!.text).toBe("")
		})
	})

	describe("non-blocking asks", () => {
		it("auto-approves command_output", async () => {
			const { dispatcher, sent } = createDispatcher()
			const message = makeAskMessage("command_output", "output text")

			const result = await dispatcher.handleAsk(message)

			expect(result.handled).toBe(true)
			expect(result.response).toBe("yesButtonClicked")
			expect(sent).toHaveLength(1)
		})
	})
})
