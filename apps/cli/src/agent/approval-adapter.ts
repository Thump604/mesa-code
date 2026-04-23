/**
 * Shared approval/ask contract for all CLI session modes.
 *
 * This module provides:
 * - `classifyAsk()` — one classification function used by all modes
 * - `shouldRouteAsAskResponse()` — passive check for stdin-stream
 * - `sendApprovalResponse()` — one response dispatch function
 * - `ApprovalAdapter` interface — what each mode implements
 * - `AutoApprovalAdapter` — non-interactive auto-approve
 * - `InteractiveApprovalAdapter` — readline prompt-based approval
 *
 * All ask routing must use classifyAsk. Do not maintain separate ask sets.
 */

import {
	type ClineAsk,
	type ClineMessage,
	type ClineAskResponse,
	isIdleAsk,
	isInteractiveAsk,
	isResumableAsk,
	isNonBlockingAsk,
} from "@roo-code/types"

// =============================================================================
// Types
// =============================================================================

export type ApprovalRequestKind = "approve" | "respond" | "retry" | "continue" | "acknowledge"

export interface ApprovalRequest {
	kind: ApprovalRequestKind
	ask: ClineAsk
	message: ClineMessage
}

export interface ApprovalResponse {
	response: ClineAskResponse
	text?: string
	images?: string[]
}

// =============================================================================
// Classification
// =============================================================================

/**
 * Classify an ask into a normalized ApprovalRequest.
 *
 * Returns null for non-blocking asks (these auto-continue without a request).
 * All other ask types produce a request that an adapter must handle.
 *
 * This is the SINGLE classification function. Both active adapters (print, TUI)
 * and passive routing checks (stdin-stream) must use it. Do not duplicate
 * ask type sets elsewhere.
 */
export function classifyAsk(ask: ClineAsk, message: ClineMessage): ApprovalRequest | null {
	if (isNonBlockingAsk(ask)) {
		return null
	}

	if (isInteractiveAsk(ask)) {
		return {
			kind: ask === "followup" ? "respond" : "approve",
			ask,
			message,
		}
	}

	if (isResumableAsk(ask)) {
		return { kind: "continue", ask, message }
	}

	if (isIdleAsk(ask)) {
		if (ask === "completion_result") {
			return { kind: "acknowledge", ask, message }
		}

		if (ask === "api_req_failed") {
			return { kind: "retry", ask, message }
		}

		return { kind: "continue", ask, message }
	}

	// Unknown ask type — not classified. New ask types must be added to the
	// type guards in @roo-code/types to be routed through the approval contract.
	return null
}

/**
 * Passive routing check for stdin-stream mode.
 *
 * Returns true when an incoming message should be treated as a response to
 * the current ask. Uses classifyAsk internally so the routable set stays
 * synchronized with the active adapter classification.
 */
export function shouldRouteAsAskResponse(waitingForInput: boolean, currentAsk: ClineAsk | undefined): boolean {
	if (!waitingForInput || currentAsk === undefined) {
		return false
	}

	// An ask is routable if classifyAsk produces a request for it.
	// We pass a minimal message — classification depends on the ask type, not content.
	return classifyAsk(currentAsk, { type: "ask" } as ClineMessage) !== null
}

// =============================================================================
// Adapter interface
// =============================================================================

export interface ApprovalAdapter {
	handle(request: ApprovalRequest): Promise<ApprovalResponse>
	dispose(): void
}

// =============================================================================
// Response dispatch
// =============================================================================

/**
 * Send an ApprovalResponse through the session controller.
 *
 * All modes use this single function to translate ApprovalResponse into
 * controller calls. Do not duplicate this logic.
 */
export function sendApprovalResponse(
	target: {
		approve(): void
		reject(): void
		sendTaskMessage(text: string, images?: string[]): void
	},
	response: ApprovalResponse,
): void {
	switch (response.response) {
		case "yesButtonClicked":
			target.approve()
			return
		case "noButtonClicked":
			target.reject()
			return
		case "messageResponse":
			target.sendTaskMessage(response.text ?? "", response.images)
			return
	}
}

// =============================================================================
// Auto-approval adapter (non-interactive print mode)
// =============================================================================

export class AutoApprovalAdapter implements ApprovalAdapter {
	async handle(request: ApprovalRequest): Promise<ApprovalResponse> {
		if (request.kind === "respond") {
			return { response: "messageResponse", text: "" }
		}

		return { response: "yesButtonClicked" }
	}

	dispose(): void {}
}

// =============================================================================
// Interactive approval adapter (interactive print mode)
// =============================================================================

export interface InteractiveApprovalDeps {
	promptForYesNo(prompt: string): Promise<boolean>
	promptForInput(prompt: string): Promise<string>
}

export class InteractiveApprovalAdapter implements ApprovalAdapter {
	constructor(
		private readonly deps: InteractiveApprovalDeps,
		private readonly options: { exitOnError?: boolean } = {},
	) {}

	async handle(request: ApprovalRequest): Promise<ApprovalResponse> {
		switch (request.kind) {
			case "approve":
				return this.collectApproval()
			case "respond":
				return this.collectTextResponse()
			case "retry":
				if (this.options.exitOnError) {
					throw new Error(request.message.text?.split("\n")[0] || "API request failed")
				}
				return this.collectRetryDecision()
			case "continue":
			case "acknowledge":
				return { response: "yesButtonClicked" }
		}
	}

	dispose(): void {}

	private async collectApproval(): Promise<ApprovalResponse> {
		try {
			const approved = await this.deps.promptForYesNo("Approve? (y/n): ")
			return { response: approved ? "yesButtonClicked" : "noButtonClicked" }
		} catch {
			return { response: "noButtonClicked" }
		}
	}

	private async collectTextResponse(): Promise<ApprovalResponse> {
		try {
			const text = await this.deps.promptForInput("Your answer: ")
			return { response: "messageResponse", text: text.trim() }
		} catch {
			return { response: "messageResponse", text: "" }
		}
	}

	private async collectRetryDecision(): Promise<ApprovalResponse> {
		try {
			const retry = await this.deps.promptForYesNo("Retry the request? (y/n): ")
			return { response: retry ? "yesButtonClicked" : "noButtonClicked" }
		} catch {
			return { response: "noButtonClicked" }
		}
	}
}
