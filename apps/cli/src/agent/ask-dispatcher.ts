/**
 * AskDispatcher - Routes ask messages through the shared approval contract.
 *
 * Responsibilities:
 * - Classifies asks via classifyAsk() from approval-adapter.ts
 * - Formats ask output for the terminal (display-only)
 * - Delegates input collection to the shared ApprovalAdapter
 * - Tracks handled asks to avoid duplicates
 *
 * The adapter handles the decision/input boundary. AskDispatcher handles
 * output formatting and protocol-level concerns (extension-auto-handled asks,
 * exitOnError, followup timeout prompts).
 */

import { type ClineMessage, type ClineAsk, type ClineAskResponse, isNonBlockingAsk } from "@roo-code/types"
import { debugLog } from "@roo-code/core/cli"

import { FOLLOWUP_TIMEOUT_SECONDS } from "@/types/index.js"

import {
	classifyAsk,
	AutoApprovalAdapter,
	InteractiveApprovalAdapter,
	type ApprovalAdapter,
	type ApprovalRequest,
} from "./approval-adapter.js"
import type { OutputManager } from "./output-manager.js"
import type { PromptManager } from "./prompt-manager.js"

// =============================================================================
// Types
// =============================================================================

export interface AskDispatcherOptions {
	outputManager: OutputManager
	promptManager: PromptManager
	sendAskResponse: (response: ClineAskResponse, text?: string) => void
	nonInteractive?: boolean
	exitOnError?: boolean
	disabled?: boolean
}

export interface AskHandleResult {
	handled: boolean
	response?: ClineAskResponse
	error?: Error
}

// =============================================================================
// AskDispatcher Class
// =============================================================================

export class AskDispatcher {
	private readonly outputManager: OutputManager
	private readonly promptManager: PromptManager
	private readonly sendAskResponseCallback: (response: ClineAskResponse, text?: string) => void
	private readonly nonInteractive: boolean
	private readonly exitOnError: boolean
	private readonly disabled: boolean
	private readonly adapter: ApprovalAdapter
	private readonly handledAsks = new Set<number>()

	constructor(options: AskDispatcherOptions) {
		this.outputManager = options.outputManager
		this.promptManager = options.promptManager
		this.sendAskResponseCallback = options.sendAskResponse
		this.nonInteractive = options.nonInteractive ?? false
		this.exitOnError = options.exitOnError ?? false
		this.disabled = options.disabled ?? false

		this.adapter = this.nonInteractive
			? new AutoApprovalAdapter()
			: new InteractiveApprovalAdapter(
					{
						promptForYesNo: (prompt) => this.promptManager.promptForYesNo(prompt),
						promptForInput: (prompt) => this.promptManager.promptForInput(prompt),
					},
					{ exitOnError: this.exitOnError },
				)
	}

	// ===========================================================================
	// Public API
	// ===========================================================================

	async handleAsk(message: ClineMessage): Promise<AskHandleResult> {
		if (this.disabled) {
			return { handled: false }
		}

		const ts = message.ts
		const ask = message.ask
		const text = message.text || ""

		if (this.handledAsks.has(ts)) {
			return { handled: true }
		}

		if (message.type !== "ask" || !ask) {
			return { handled: false }
		}

		if (message.partial) {
			return { handled: false }
		}

		this.handledAsks.add(ts)

		try {
			// Shared classification — all modes use classifyAsk
			const request = classifyAsk(ask, message)

			if (!request) {
				if (isNonBlockingAsk(ask)) {
					this.sendAskResponseCallback("yesButtonClicked")
					return { handled: true, response: "yesButtonClicked" }
				}

				debugLog("[AskDispatcher] Unknown ask type", { ask, ts })
				return await this.handleUnclassifiedAsk(ts, ask, text)
			}

			// Format output for this ask type (display-only, no input)
			this.formatAskOutput(request)

			// Exit-on-error for API failures (process-level concern, not adapter)
			if (request.kind === "retry" && this.exitOnError) {
				console.error(`[CLI] API request failed: ${text || "Unknown error"}`)
				process.exit(1)
			}

			// In non-interactive mode, some asks are auto-handled by the extension
			// via autoApprovalEnabled settings. AskDispatcher acknowledges them
			// without sending an explicit response.
			if (this.nonInteractive && this.isExtensionAutoHandled(request)) {
				if (request.kind === "retry") {
					this.outputManager.output("\n[retrying api request]")
				}

				return { handled: true }
			}

			// Followup with non-interactive timeout — special case that preserves
			// the timeout prompt behavior (gives user a brief input window).
			if (request.kind === "respond" && this.nonInteractive) {
				return await this.handleNonInteractiveFollowup(request)
			}

			// Delegate decision/input to the shared approval adapter
			const response = await this.adapter.handle(request)

			// Post-process followup responses (numbered suggestion resolution)
			if (request.kind === "respond" && response.response === "messageResponse") {
				response.text = this.resolveFollowupText(text, response.text ?? "")
			}

			// Non-interactive output for continue/resume responses
			if (
				this.nonInteractive &&
				request.kind === "continue" &&
				response.response === "yesButtonClicked" &&
				(request.ask === "resume_task" || request.ask === "resume_completed_task")
			) {
				this.outputManager.output("\n[continuing task]")
			}

			this.sendAskResponseCallback(response.response, response.text)
			return { handled: true, response: response.response }
		} catch (error) {
			this.handledAsks.delete(ts)
			return {
				handled: false,
				error: error instanceof Error ? error : new Error(String(error)),
			}
		}
	}

	isHandled(ts: number): boolean {
		return this.handledAsks.has(ts)
	}

	clear(): void {
		this.handledAsks.clear()
	}

	// ===========================================================================
	// Output formatting (display-only, no input collection)
	// ===========================================================================

	private formatAskOutput(request: ApprovalRequest): void {
		const { ask, message } = request
		const text = message.text || ""
		const ts = message.ts

		switch (ask) {
			case "followup":
				this.formatFollowupOutput(text)
				return
			case "command":
				this.outputManager.output("\n[command request]")
				this.outputManager.output(`  Command: ${text || "(no command specified)"}`)
				this.outputManager.markDisplayed(ts, text, false)
				return
			case "tool":
				this.formatToolOutput(ts, text)
				return
			case "use_mcp_server":
				this.formatMcpOutput(ts, text)
				return
			case "api_req_failed":
				this.outputManager.output("\n[api request failed]")
				this.outputManager.output(`  Error: ${text || "Unknown error"}`)
				this.outputManager.markDisplayed(ts, text, false)
				return
			case "mistake_limit_reached":
				this.outputManager.output("\n[mistake limit reached]")
				if (text) this.outputManager.output(`  Details: ${text}`)
				this.outputManager.markDisplayed(ts, text, false)
				return
			case "auto_approval_max_req_reached":
				this.outputManager.output("\n[auto-approval limit reached]")
				if (text) this.outputManager.output(`  Details: ${text}`)
				this.outputManager.markDisplayed(ts, text, false)
				return
			case "resume_task":
			case "resume_completed_task":
				this.outputManager.output(`\n[Resume ${ask === "resume_completed_task" ? "Completed " : ""}Task]`)
				if (text) this.outputManager.output(`  ${text}`)
				this.outputManager.markDisplayed(ts, text, false)
				return
			case "completion_result":
				// Output handled by taskCompleted event
				return
			default:
				this.outputManager.output(`\n[${ask}]`)
				if (text) this.outputManager.output(`  ${text}`)
				this.outputManager.markDisplayed(ts, text, false)
				return
		}
	}

	private formatFollowupOutput(text: string): void {
		let question = text
		let suggestions: Array<{ answer: string; mode?: string | null }> = []

		try {
			const data = JSON.parse(text)
			question = data.question || text
			suggestions = Array.isArray(data.suggest) ? data.suggest : []
		} catch {
			// Use raw text if not JSON
		}

		this.outputManager.output("\n[question]", question)

		if (suggestions.length > 0) {
			this.outputManager.output("\nSuggested answers:")
			suggestions.forEach((suggestion, index) => {
				const suggestionText = suggestion.answer || String(suggestion)
				const modeHint = suggestion.mode ? ` (mode: ${suggestion.mode})` : ""
				this.outputManager.output(`  ${index + 1}. ${suggestionText}${modeHint}`)
			})
			this.outputManager.output("")
		}
	}

	private formatToolOutput(ts: number, text: string): void {
		let toolName = "unknown"
		let toolInfo: Record<string, unknown> = {}

		try {
			toolInfo = JSON.parse(text) as Record<string, unknown>
			toolName = (toolInfo.tool as string) || "unknown"
		} catch {
			// Use raw text if not JSON
		}

		const isProtected = toolInfo.isProtected === true

		if (isProtected) {
			this.outputManager.output(`\n[Tool Request] ${toolName} [PROTECTED CONFIGURATION FILE]`)
			this.outputManager.output(`⚠️  WARNING: This tool wants to modify a protected configuration file.`)
			this.outputManager.output(
				`    Protected files include .mesaignore, .mesa/*, .rooignore, .roo/*, and other sensitive config files.`,
			)
		} else {
			this.outputManager.output(`\n[Tool Request] ${toolName}`)
		}

		for (const [key, value] of Object.entries(toolInfo)) {
			if (key === "tool" || key === "isProtected") continue

			let displayValue: string
			if (typeof value === "string") {
				displayValue = value.length > 200 ? value.substring(0, 200) + "..." : value
			} else if (typeof value === "object" && value !== null) {
				const json = JSON.stringify(value)
				displayValue = json.length > 200 ? json.substring(0, 200) + "..." : json
			} else {
				displayValue = String(value)
			}

			this.outputManager.output(`  ${key}: ${displayValue}`)
		}

		this.outputManager.markDisplayed(ts, text, false)
	}

	private formatMcpOutput(ts: number, text: string): void {
		let serverName = "unknown"
		let toolName = ""
		let resourceUri = ""

		try {
			const mcpInfo = JSON.parse(text)
			serverName = mcpInfo.server_name || "unknown"

			if (mcpInfo.type === "use_mcp_tool") {
				toolName = mcpInfo.tool_name || ""
			} else if (mcpInfo.type === "access_mcp_resource") {
				resourceUri = mcpInfo.uri || ""
			}
		} catch {
			// Use raw text if not JSON
		}

		this.outputManager.output("\n[mcp request]")
		this.outputManager.output(`  Server: ${serverName}`)
		if (toolName) {
			this.outputManager.output(`  Tool: ${toolName}`)
		}
		if (resourceUri) {
			this.outputManager.output(`  Resource: ${resourceUri}`)
		}
		this.outputManager.markDisplayed(ts, text, false)
	}

	// ===========================================================================
	// Special-case handlers
	// ===========================================================================

	/**
	 * In non-interactive mode, some asks are auto-handled by the extension
	 * (via autoApprovalEnabled). AskDispatcher does not send an explicit response.
	 */
	private isExtensionAutoHandled(request: ApprovalRequest): boolean {
		return (
			request.kind === "approve" || // command, tool, mcp — extension auto-approves
			request.kind === "acknowledge" || // completion_result — taskCompleted event handles
			request.kind === "retry" // api_req_failed — extension auto-retries
		)
	}

	/**
	 * Non-interactive followup with timeout prompt.
	 * Preserves the behavior where the user gets a brief input window
	 * before the default answer is used.
	 */
	private async handleNonInteractiveFollowup(request: ApprovalRequest): Promise<AskHandleResult> {
		const text = request.message.text || ""
		const { suggestions, defaultAnswer } = this.parseFollowupSuggestions(text)

		const timeoutMs = FOLLOWUP_TIMEOUT_SECONDS * 1000
		const result = await this.promptManager.promptWithTimeout(
			suggestions.length > 0
				? `Enter number (1-${suggestions.length}) or type your answer (auto-select in ${Math.round(timeoutMs / 1000)}s): `
				: `Your answer (auto-select in ${Math.round(timeoutMs / 1000)}s): `,
			timeoutMs,
			defaultAnswer,
		)

		let responseText = result.value.trim()
		responseText = this.resolveNumberedSuggestion(responseText, suggestions)

		if (result.timedOut || result.cancelled) {
			this.outputManager.output(`[Using default: ${defaultAnswer || "(empty)"}]`)
		}

		this.sendAskResponseCallback("messageResponse", responseText)
		return { handled: true, response: "messageResponse" }
	}

	/**
	 * Handle ask types not recognized by classifyAsk.
	 * Fallback for forward-compatibility.
	 */
	private async handleUnclassifiedAsk(ts: number, ask: ClineAsk, text: string): Promise<AskHandleResult> {
		if (this.nonInteractive) {
			if (text) {
				this.outputManager.output(`\n[${ask}]`, text)
			}

			return { handled: true }
		}

		this.outputManager.output(`\n[${ask}]`)
		if (text) {
			this.outputManager.output(`  ${text}`)
		}
		this.outputManager.markDisplayed(ts, text, false)

		try {
			const approved = await this.promptManager.promptForYesNo("Approve? (y/n): ")
			this.sendAskResponseCallback(approved ? "yesButtonClicked" : "noButtonClicked")
			return { handled: true, response: approved ? "yesButtonClicked" : "noButtonClicked" }
		} catch {
			this.outputManager.output("[Defaulting to: no]")
			this.sendAskResponseCallback("noButtonClicked")
			return { handled: true, response: "noButtonClicked" }
		}
	}

	// ===========================================================================
	// Helpers
	// ===========================================================================

	private parseFollowupSuggestions(text: string): {
		suggestions: Array<{ answer: string; mode?: string | null }>
		defaultAnswer: string
	} {
		let suggestions: Array<{ answer: string; mode?: string | null }> = []

		try {
			const data = JSON.parse(text)
			suggestions = Array.isArray(data.suggest) ? data.suggest : []
		} catch {
			// Not JSON
		}

		const firstSuggestion = suggestions.length > 0 ? suggestions[0] : null
		const defaultAnswer = firstSuggestion?.answer ?? ""

		return { suggestions, defaultAnswer }
	}

	/**
	 * Post-process followup response text — resolve numbered suggestion selections.
	 */
	private resolveFollowupText(rawAskText: string, responseText: string): string {
		const { suggestions } = this.parseFollowupSuggestions(rawAskText)
		if (suggestions.length === 0) return responseText
		return this.resolveNumberedSuggestion(responseText, suggestions)
	}

	private resolveNumberedSuggestion(
		input: string,
		suggestions: Array<{ answer: string; mode?: string | null }>,
	): string {
		const num = parseInt(input, 10)
		if (!isNaN(num) && num >= 1 && num <= suggestions.length) {
			const selectedSuggestion = suggestions[num - 1]
			if (selectedSuggestion) {
				const selected = selectedSuggestion.answer || String(selectedSuggestion)
				this.outputManager.output(`Selected: ${selected}`)
				return selected
			}
		}
		return input
	}
}
