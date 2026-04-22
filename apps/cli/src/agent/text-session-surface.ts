import type { ClineMessage, ClineAskResponse } from "@roo-code/types"

import type { CliRuntime } from "@/runtime/runtime.js"

import { ExtensionClient } from "./extension-client.js"
import { OutputManager, type OutputManagerOptions } from "./output-manager.js"
import { PromptManager, type PromptManagerOptions } from "./prompt-manager.js"
import { AskDispatcher } from "./ask-dispatcher.js"

export interface TextSessionSurfaceOptions {
	nonInteractive?: boolean
	exitOnError?: boolean
	outputManager?: OutputManagerOptions
	promptManager?: PromptManagerOptions
}

export class TextSessionSurface {
	private readonly client: ExtensionClient
	private readonly outputManager: OutputManager
	private readonly promptManager: PromptManager
	private readonly askDispatcher: AskDispatcher
	private readonly unsubscribers: Array<() => void> = []

	constructor(
		private readonly runtime: CliRuntime,
		options: TextSessionSurfaceOptions = {},
	) {
		this.client = new ExtensionClient({
			sendMessage: () => {},
		})
		this.outputManager = new OutputManager(options.outputManager)
		this.promptManager = new PromptManager(options.promptManager)
		this.askDispatcher = new AskDispatcher({
			outputManager: this.outputManager,
			promptManager: this.promptManager,
			sendAskResponse: (response, text) => this.dispatchAskResponse(response, text),
			nonInteractive: options.nonInteractive,
			exitOnError: options.exitOnError,
		})
	}

	attach(): void {
		this.unsubscribers.push(
			this.runtime.onMessage((message) => {
				this.client.handleMessage(message)
			}),
		)

		this.unsubscribers.push(
			this.client.on("message", (message: ClineMessage) => {
				this.outputManager.outputMessage(message)
			}),
		)

		this.unsubscribers.push(
			this.client.on("messageUpdated", (message: ClineMessage) => {
				this.outputManager.outputMessage(message)
			}),
		)

		this.unsubscribers.push(
			this.client.on("waitingForInput", (event) => {
				void this.askDispatcher.handleAsk(event.message)
			}),
		)

		this.unsubscribers.push(
			this.client.on("taskCompleted", (event) => {
				if (event.message && event.message.type === "ask" && event.message.ask === "completion_result") {
					this.outputManager.outputCompletionResult(event.message.ts, event.message.text || "")
				}
			}),
		)
	}

	async dispose(): Promise<void> {
		while (this.unsubscribers.length > 0) {
			this.unsubscribers.pop()?.()
		}

		this.askDispatcher.clear()
		this.outputManager.clear()
		this.client.reset()
	}

	private dispatchAskResponse(response: ClineAskResponse, text?: string): void {
		switch (response) {
			case "yesButtonClicked":
				this.runtime.approve()
				return
			case "noButtonClicked":
				this.runtime.reject()
				return
			case "messageResponse":
				this.runtime.sendTaskMessage(text || "")
				return
		}
	}
}
