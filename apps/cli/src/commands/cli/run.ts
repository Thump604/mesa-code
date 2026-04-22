import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

import { createElement } from "react"
import pWaitFor from "p-wait-for"

import { setLogger } from "@roo-code/vscode-shim"

import {
	FlagOptions,
	isSupportedApiStandard,
	isSupportedLocalRuntime,
	isSupportedProvider,
	supportedProviders,
	supportedApiStandards,
	supportedLocalRuntimes,
	DEFAULT_FLAGS,
	REASONING_EFFORTS,
	OutputFormat,
} from "@/types/index.js"
import { isValidOutputFormat } from "@/types/json-events.js"
import { JsonEventEmitter } from "@/agent/json-event-emitter.js"
import { createCliRuntime, type CliRuntime, type CliRuntimeOptions } from "@/runtime/index.js"

import { getOpsModeContract, resolveOpsBaseUrl } from "@/lib/ops-control-plane.js"
import { loadSettings } from "@/lib/storage/index.js"
import { resolveWorkspaceResumeSessionId } from "@/lib/task-history/index.js"
import { getEnvVarName, getApiKeyFromEnv } from "@/lib/utils/provider.js"
import {
	resolveConfiguredApiKey,
	resolveConfiguredBaseUrl,
	resolveEffectiveModel,
	resolveEffectiveProtocol,
	resolveEffectiveProvider,
	resolveEffectiveRuntime,
} from "@/lib/utils/runtime-config.js"
import { runOnboarding } from "@/lib/utils/onboarding.js"
import { validateTerminalShellPath } from "@/lib/utils/shell.js"
import { getDefaultExtensionPath } from "@/lib/utils/extension.js"
import { isValidSessionId } from "@/lib/utils/session-id.js"
import { VERSION } from "@/lib/utils/version.js"

import { isExpectedControlFlowError } from "./cancellation.js"
import { runStdinStreamMode } from "./stdin-stream.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SIGNAL_ONLY_EXIT_KEEPALIVE_MS = 60_000
const STREAM_RESUME_WAIT_TIMEOUT_MS = 2_000

function validateProtocolAndRuntime(flagOptions: FlagOptions) {
	const protocol = flagOptions.protocol
	if (protocol && !isSupportedApiStandard(protocol)) {
		console.error(`[CLI] Error: Invalid protocol: ${protocol}; must be one of: ${supportedApiStandards.join(", ")}`)
		process.exit(1)
	}

	const runtime = flagOptions.runtime
	if (runtime && !isSupportedLocalRuntime(runtime)) {
		console.error(`[CLI] Error: Invalid runtime: ${runtime}; must be one of: ${supportedLocalRuntimes.join(", ")}`)
		process.exit(1)
	}

	if (
		protocol &&
		flagOptions.provider &&
		(flagOptions.provider === "openai" || flagOptions.provider === "anthropic") &&
		flagOptions.provider !== protocol
	) {
		console.error(
			`[CLI] Error: --provider ${flagOptions.provider} conflicts with --protocol ${protocol}; use matching values or omit --provider`,
		)
		process.exit(1)
	}

	if (runtime && flagOptions.provider && !["openai", "anthropic"].includes(flagOptions.provider)) {
		console.error("[CLI] Error: --runtime only applies to openai/anthropic-compatible endpoint modes")
		process.exit(1)
	}

	if (protocol && flagOptions.provider && !["openai", "anthropic"].includes(flagOptions.provider)) {
		console.error("[CLI] Error: --protocol only applies when using openai/anthropic-compatible endpoint modes")
		process.exit(1)
	}
}

async function bootstrapResumeForStdinStream(runtime: CliRuntime, sessionId: string): Promise<void> {
	runtime.selectTask(sessionId)

	// Best-effort wait so early stdin "message" commands can target the resumed task.
	await pWaitFor(() => runtime.hasActiveTask() || runtime.isWaitingForInput(), {
		interval: 25,
		timeout: STREAM_RESUME_WAIT_TIMEOUT_MS,
	}).catch(() => undefined)
}

function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error))
}

export async function run(promptArg: string | undefined, flagOptions: FlagOptions) {
	setLogger({
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
	})

	let prompt = promptArg

	validateProtocolAndRuntime(flagOptions)

	if (flagOptions.promptFile) {
		if (!fs.existsSync(flagOptions.promptFile)) {
			console.error(`[CLI] Error: Prompt file does not exist: ${flagOptions.promptFile}`)
			process.exit(1)
		}

		prompt = fs.readFileSync(flagOptions.promptFile, "utf-8")
	}

	const requestedSessionId = flagOptions.sessionId?.trim()
	const requestedCreateSessionId = flagOptions.createWithSessionId?.trim()
	const shouldContinueSession = flagOptions.continue
	const isResumeRequested = Boolean(requestedSessionId || shouldContinueSession)

	if (flagOptions.createWithSessionId !== undefined && !requestedCreateSessionId) {
		console.error("[CLI] Error: --create-with-session-id requires a non-empty session id")
		process.exit(1)
	}

	if (flagOptions.sessionId !== undefined && !requestedSessionId) {
		console.error("[CLI] Error: --session-id requires a non-empty session id")
		process.exit(1)
	}

	if (requestedCreateSessionId && !isValidSessionId(requestedCreateSessionId)) {
		console.error("[CLI] Error: --create-with-session-id must be a valid UUID session id")
		process.exit(1)
	}

	if (requestedSessionId && !isValidSessionId(requestedSessionId)) {
		console.error("[CLI] Error: --session-id must be a valid UUID session id")
		process.exit(1)
	}

	if (requestedCreateSessionId && isResumeRequested) {
		console.error("[CLI] Error: cannot use --create-with-session-id with --session-id/--continue")
		process.exit(1)
	}

	if (requestedSessionId && shouldContinueSession) {
		console.error("[CLI] Error: cannot use --session-id with --continue")
		process.exit(1)
	}

	if (isResumeRequested && prompt) {
		console.error("[CLI] Error: cannot use prompt or --prompt-file with --session-id/--continue")
		console.error("[CLI] Usage: roo [--session-id <session-id> | --continue] [options]")
		process.exit(1)
	}

	// Options

	const settings = await loadSettings()
	let runtimeAwareSettings = settings

	if (!flagOptions.model && settings.controlPlane === "ops") {
		try {
			const modeContract = await getOpsModeContract(resolveOpsBaseUrl(undefined, settings.opsBaseUrl))
			if (modeContract.active_model_id) {
				runtimeAwareSettings = {
					...settings,
					model: modeContract.active_model_id,
					...(settings.protocol === "openai" || settings.provider === "openai"
						? { openAiModelId: modeContract.active_model_id }
						: {}),
				}
			}
		} catch {
			// Fall back to persisted settings when ops is unavailable.
		}
	}

	const isTuiSupported = process.stdin.isTTY && process.stdout.isTTY
	const isTuiEnabled = !flagOptions.print && isTuiSupported

	// Determine effective values: CLI flags > settings file > DEFAULT_FLAGS.
	const effectiveMode = flagOptions.mode || runtimeAwareSettings.mode || DEFAULT_FLAGS.mode
	const effectiveProtocol = resolveEffectiveProtocol(flagOptions.protocol, flagOptions.provider, runtimeAwareSettings)
	const effectiveRuntime = resolveEffectiveRuntime(flagOptions.runtime, runtimeAwareSettings)
	const effectiveProvider = resolveEffectiveProvider(
		flagOptions.provider,
		runtimeAwareSettings,
		effectiveProtocol,
		effectiveRuntime,
	)
	const effectiveBaseUrl = resolveConfiguredBaseUrl(
		flagOptions.baseUrl,
		runtimeAwareSettings,
		effectiveProtocol,
		effectiveRuntime,
	)
	const effectiveModel = resolveEffectiveModel(
		flagOptions.model,
		runtimeAwareSettings,
		effectiveProvider,
		effectiveBaseUrl,
		effectiveRuntime,
	)
	const hasExplicitProvider =
		flagOptions.provider !== undefined ||
		(runtimeAwareSettings.provider !== undefined && runtimeAwareSettings.provider !== "roo")
	const isOnboardingEnabled =
		isTuiEnabled &&
		!runtimeAwareSettings.hasCompletedOnboarding &&
		!runtimeAwareSettings.onboardingProviderChoice &&
		!hasExplicitProvider &&
		!effectiveBaseUrl &&
		!effectiveRuntime &&
		effectiveProvider === "openai"
	const effectiveReasoningEffort =
		flagOptions.reasoningEffort || runtimeAwareSettings.reasoningEffort || DEFAULT_FLAGS.reasoningEffort
	const effectiveWorkspacePath = flagOptions.workspace ? path.resolve(flagOptions.workspace) : process.cwd()
	const legacyRequireApprovalFromSettings =
		runtimeAwareSettings.requireApproval ??
		(runtimeAwareSettings.dangerouslySkipPermissions === undefined
			? undefined
			: !runtimeAwareSettings.dangerouslySkipPermissions)
	const effectiveRequireApproval = flagOptions.requireApproval || legacyRequireApprovalFromSettings || false
	const effectiveExitOnComplete = flagOptions.print || flagOptions.oneshot || runtimeAwareSettings.oneshot || false
	const rawConsecutiveMistakeLimit =
		flagOptions.consecutiveMistakeLimit ??
		runtimeAwareSettings.consecutiveMistakeLimit ??
		DEFAULT_FLAGS.consecutiveMistakeLimit
	const effectiveConsecutiveMistakeLimit = Number(rawConsecutiveMistakeLimit)

	if (!Number.isInteger(effectiveConsecutiveMistakeLimit) || effectiveConsecutiveMistakeLimit < 0) {
		console.error(
			`[CLI] Error: Invalid consecutive mistake limit: ${rawConsecutiveMistakeLimit}; must be a non-negative integer`,
		)
		process.exit(1)
	}

	let terminalShell: string | undefined
	if (flagOptions.terminalShell !== undefined) {
		const validatedTerminalShell = await validateTerminalShellPath(flagOptions.terminalShell)

		if (!validatedTerminalShell.valid) {
			console.error(
				`[CLI] Warning: ignoring --terminal-shell "${flagOptions.terminalShell}" (${validatedTerminalShell.reason})`,
			)
		} else {
			terminalShell = validatedTerminalShell.shellPath
		}
	}

	const runtimeOptions: CliRuntimeOptions = {
		mode: effectiveMode,
		reasoningEffort: effectiveReasoningEffort === "unspecified" ? undefined : effectiveReasoningEffort,
		consecutiveMistakeLimit: effectiveConsecutiveMistakeLimit,
		user: null,
		provider: effectiveProvider,
		model: effectiveModel,
		baseUrl: effectiveBaseUrl,
		workspacePath: effectiveWorkspacePath,
		extensionPath: path.resolve(flagOptions.extension || getDefaultExtensionPath(__dirname)),
		nonInteractive: !effectiveRequireApproval,
		exitOnError: flagOptions.exitOnError,
		ephemeral: flagOptions.ephemeral,
		debug: flagOptions.debug,
		exitOnComplete: effectiveExitOnComplete,
		terminalShell,
	}

	if (isOnboardingEnabled) {
		await runOnboarding()
	}

	// Validations
	// TODO: Validate the API key for the chosen provider.
	// TODO: Validate the model for the chosen provider.

	if (!isSupportedProvider(runtimeOptions.provider)) {
		console.error(
			`[CLI] Error: Invalid provider: ${runtimeOptions.provider}; must be one of: ${supportedProviders.join(", ")}`,
		)
		process.exit(1)
	}

	runtimeOptions.apiKey =
		runtimeOptions.apiKey ||
		resolveConfiguredApiKey(
			runtimeOptions.provider,
			flagOptions.apiKey,
			settings,
			getApiKeyFromEnv(runtimeOptions.provider),
			runtimeOptions.baseUrl,
		)

	if ((runtimeOptions.provider === "openai" || runtimeOptions.provider === "anthropic") && !runtimeOptions.model) {
		const providerLabel = effectiveRuntime
			? `${effectiveRuntime} (${runtimeOptions.provider}-compatible)`
			: runtimeOptions.provider
		const defaultBaseUrlEnvName = runtimeOptions.provider === "anthropic" ? "ANTHROPIC_BASE_URL" : "OPENAI_BASE_URL"
		console.error(`[CLI] Error: No model provided for ${providerLabel}.`)
		if (!runtimeOptions.baseUrl && !hasExplicitProvider) {
			console.error("[CLI] The default CLI contract expects a local/self-hosted endpoint.")
			console.error(`[CLI] Set ${defaultBaseUrlEnvName} or use --base-url, then provide --model.`)
			console.error("[CLI] Use --provider openrouter or another remote provider only when you intend to opt in.")
		} else {
			console.error(
				"[CLI] Use --model or set model defaults in cli-settings.json for your local/private runtime.",
			)
		}
		process.exit(1)
	}

	if (!runtimeOptions.apiKey) {
		if (
			(runtimeOptions.provider === "openai" || runtimeOptions.provider === "anthropic") &&
			!runtimeOptions.baseUrl &&
			!hasExplicitProvider
		) {
			const defaultBaseUrlEnvName =
				runtimeOptions.provider === "anthropic" ? "ANTHROPIC_BASE_URL" : "OPENAI_BASE_URL"
			console.error("[CLI] Error: No local endpoint configured for the default CLI contract.")
			console.error(`[CLI] Set ${defaultBaseUrlEnvName} or use --base-url, then provide --model.`)
			console.error("[CLI] Use --provider openrouter or another remote provider only when you intend to opt in.")
		} else {
			console.error(
				`[CLI] Error: No API key provided. Use --api-key or set the appropriate environment variable.`,
			)
			console.error(`[CLI] For ${runtimeOptions.provider}, set ${getEnvVarName(runtimeOptions.provider)}`)
		}

		process.exit(1)
	}

	if (!fs.existsSync(runtimeOptions.workspacePath)) {
		console.error(`[CLI] Error: Workspace path does not exist: ${runtimeOptions.workspacePath}`)
		process.exit(1)
	}

	if (runtimeOptions.reasoningEffort && !REASONING_EFFORTS.includes(runtimeOptions.reasoningEffort)) {
		console.error(
			`[CLI] Error: Invalid reasoning effort: ${runtimeOptions.reasoningEffort}, must be one of: ${REASONING_EFFORTS.join(", ")}`,
		)
		process.exit(1)
	}

	// Validate output format
	const outputFormat: OutputFormat = (flagOptions.outputFormat as OutputFormat) || "text"

	if (!isValidOutputFormat(outputFormat)) {
		console.error(
			`[CLI] Error: Invalid output format: ${flagOptions.outputFormat}; must be one of: text, json, stream-json`,
		)
		process.exit(1)
	}

	// Output format only works with --print mode
	if (outputFormat !== "text" && !flagOptions.print && isTuiSupported) {
		console.error("[CLI] Error: --output-format requires --print mode")
		console.error("[CLI] Usage: roo --print --output-format json")
		process.exit(1)
	}

	if (flagOptions.stdinPromptStream && !flagOptions.print) {
		console.error("[CLI] Error: --stdin-prompt-stream requires --print mode")
		console.error("[CLI] Usage: roo --print --output-format stream-json --stdin-prompt-stream [options]")
		process.exit(1)
	}

	if (flagOptions.signalOnlyExit && !flagOptions.stdinPromptStream) {
		console.error("[CLI] Error: --signal-only-exit requires --stdin-prompt-stream")
		console.error("[CLI] Usage: roo --print --output-format stream-json --stdin-prompt-stream --signal-only-exit")
		process.exit(1)
	}

	if (flagOptions.stdinPromptStream && outputFormat !== "stream-json") {
		console.error("[CLI] Error: --stdin-prompt-stream requires --output-format=stream-json")
		console.error("[CLI] Usage: roo --print --output-format stream-json --stdin-prompt-stream [options]")
		process.exit(1)
	}

	if (flagOptions.stdinPromptStream && process.stdin.isTTY) {
		console.error("[CLI] Error: --stdin-prompt-stream requires piped stdin")
		console.error(
			'[CLI] Example: printf \'{"command":"start","requestId":"1","prompt":"1+1=?"}\\n\' | roo --print --output-format stream-json --stdin-prompt-stream [options]',
		)
		process.exit(1)
	}

	if (flagOptions.stdinPromptStream && prompt) {
		console.error("[CLI] Error: cannot use positional prompt or --prompt-file with --stdin-prompt-stream")
		console.error("[CLI] Usage: roo --print --output-format stream-json --stdin-prompt-stream [options]")
		process.exit(1)
	}

	if (flagOptions.stdinPromptStream && requestedCreateSessionId) {
		console.error("[CLI] Error: --create-with-session-id is not supported with --stdin-prompt-stream")
		console.error('[CLI] Use per-request "taskId" in stdin start commands instead.')
		process.exit(1)
	}

	const useStdinPromptStream = flagOptions.stdinPromptStream
	if (!isTuiEnabled) {
		if (!prompt && !useStdinPromptStream && !isResumeRequested) {
			if (flagOptions.print) {
				console.error("[CLI] Error: no prompt provided")
				console.error("[CLI] Usage: roo --print [options] <prompt>")
				console.error(
					"[CLI] For stdin control mode: roo --print --output-format stream-json --stdin-prompt-stream [options]",
				)
			} else {
				console.error("[CLI] Error: prompt is required in non-interactive mode")
				console.error("[CLI] Usage: roo <prompt> [options]")
				console.error("[CLI] Run without -p for interactive mode")
			}

			process.exit(1)
		}

		if (!flagOptions.print) {
			console.warn("[CLI] TUI disabled (no TTY support), falling back to print mode")
		}
	}

	// Run!

	if (isTuiEnabled) {
		try {
			const { render } = await import("ink")
			const { App } = await import("../../ui/App.js")

			render(
				createElement(App, {
					...runtimeOptions,
					initialPrompt: prompt,
					initialTaskId: requestedCreateSessionId,
					initialSessionId: requestedSessionId,
					continueSession: shouldContinueSession,
					version: VERSION,
					createCliRuntime,
				}),
				// Handle Ctrl+C in App component for double-press exit.
				{ exitOnCtrlC: false },
			)
		} catch (error) {
			console.error("[CLI] Failed to start TUI:", error instanceof Error ? error.message : String(error))

			if (error instanceof Error) {
				console.error(error.stack)
			}

			process.exit(1)
		}
	} else {
		const useJsonOutput = outputFormat === "json" || outputFormat === "stream-json"
		const signalOnlyExit = flagOptions.signalOnlyExit

		runtimeOptions.disableOutput = useJsonOutput

		const runtime = createCliRuntime(runtimeOptions)
		let streamRequestId: string | undefined
		let resolvedResumeSessionId: string | undefined
		let keepAliveInterval: NodeJS.Timeout | undefined
		let isShuttingDown = false
		let runtimeDisposed = false

		const jsonEmitter = useJsonOutput
			? new JsonEventEmitter({
					mode: outputFormat as "json" | "stream-json",
					requestIdProvider: () => streamRequestId,
				})
			: null

		const emitRuntimeError = (error: Error, source?: string) => {
			const errorMessage = source ? `${source}: ${error.message}` : error.message

			if (useJsonOutput) {
				const errorEvent = { type: "error", id: Date.now(), content: errorMessage }
				process.stdout.write(JSON.stringify(errorEvent) + "\n")
				return
			}

			console.error("[CLI] Error:", errorMessage)
			console.error(error.stack)
		}

		const clearKeepAliveInterval = () => {
			if (!keepAliveInterval) {
				return
			}

			clearInterval(keepAliveInterval)
			keepAliveInterval = undefined
		}

		const flushStdout = async () => {
			try {
				if (!process.stdout.writable || process.stdout.destroyed) {
					return
				}

				await new Promise<void>((resolve, reject) => {
					process.stdout.write("", (error?: Error | null) => {
						if (error) {
							reject(error)
							return
						}

						resolve()
					})
				})
			} catch {
				// Best effort: shutdown should proceed even if stdout flush fails.
			}
		}

		const ensureKeepAliveInterval = () => {
			if (!signalOnlyExit || keepAliveInterval) {
				return
			}

			keepAliveInterval = setInterval(() => {}, SIGNAL_ONLY_EXIT_KEEPALIVE_MS)
		}

		const disposeRuntime = async () => {
			if (runtimeDisposed) {
				return
			}

			runtimeDisposed = true
			jsonEmitter?.detach()
			await runtime.dispose()
		}

		const onSigint = () => {
			void shutdown("SIGINT", 130)
		}

		const onSigterm = () => {
			void shutdown("SIGTERM", 143)
		}

		const onUncaughtException = (error: Error) => {
			if (
				isExpectedControlFlowError(error, {
					stdinStreamMode: useStdinPromptStream,
					shuttingDown: isShuttingDown,
					operation: "runtime",
				})
			) {
				return
			}

			emitRuntimeError(error, "uncaughtException")

			if (signalOnlyExit) {
				return
			}

			void shutdown("uncaughtException", 1)
		}

		const onUnhandledRejection = (reason: unknown) => {
			if (
				isExpectedControlFlowError(reason, {
					stdinStreamMode: useStdinPromptStream,
					shuttingDown: isShuttingDown,
					operation: "runtime",
				})
			) {
				return
			}

			const error = normalizeError(reason)
			emitRuntimeError(error, "unhandledRejection")

			if (signalOnlyExit) {
				return
			}

			void shutdown("unhandledRejection", 1)
		}

		const parkUntilSignal = async (reason: string): Promise<never> => {
			ensureKeepAliveInterval()

			if (!useJsonOutput) {
				console.error(`[CLI] ${reason} (--signal-only-exit active; waiting for SIGINT/SIGTERM).`)
			}

			await new Promise<void>(() => {})
			throw new Error("unreachable")
		}

		async function shutdown(signal: string, exitCode: number): Promise<void> {
			if (isShuttingDown) {
				return
			}

			isShuttingDown = true
			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
			process.off("uncaughtException", onUncaughtException)
			process.off("unhandledRejection", onUnhandledRejection)
			clearKeepAliveInterval()

			if (!useJsonOutput) {
				console.log(`\n[CLI] Received ${signal}, shutting down...`)
			}

			await disposeRuntime()
			if (jsonEmitter) {
				await jsonEmitter.flush()
			}
			await flushStdout()
			process.exit(exitCode)
		}

		process.on("SIGINT", onSigint)
		process.on("SIGTERM", onSigterm)
		process.on("uncaughtException", onUncaughtException)
		process.on("unhandledRejection", onUnhandledRejection)

		try {
			await runtime.activate()

			if (jsonEmitter) {
				runtime.attachJsonEmitter(jsonEmitter)
			}

			if (isResumeRequested) {
				resolvedResumeSessionId = resolveWorkspaceResumeSessionId(
					await runtime.readTaskHistory(),
					requestedSessionId,
				)
			}

			if (useStdinPromptStream) {
				if (!jsonEmitter || outputFormat !== "stream-json") {
					throw new Error("--stdin-prompt-stream requires --output-format=stream-json to emit control events")
				}

				if (isResumeRequested) {
					await bootstrapResumeForStdinStream(runtime, resolvedResumeSessionId!)
				}

				await runStdinStreamMode({
					runtime,
					jsonEmitter,
					setStreamRequestId: (id) => {
						streamRequestId = id
					},
				})
			} else {
				if (isResumeRequested) {
					await runtime.resumeTask(resolvedResumeSessionId!)
				} else {
					await runtime.runTask(prompt!, requestedCreateSessionId)
				}
			}

			await disposeRuntime()
			if (jsonEmitter) {
				await jsonEmitter.flush()
			}
			await flushStdout()

			if (signalOnlyExit) {
				await parkUntilSignal("Task loop completed")
			}

			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
			process.off("uncaughtException", onUncaughtException)
			process.off("unhandledRejection", onUnhandledRejection)
			process.exit(0)
		} catch (error) {
			emitRuntimeError(normalizeError(error))
			await disposeRuntime()
			if (jsonEmitter) {
				await jsonEmitter.flush()
			}
			await flushStdout()

			if (signalOnlyExit) {
				await parkUntilSignal("Task loop failed")
			}

			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
			process.off("uncaughtException", onUncaughtException)
			process.off("unhandledRejection", onUnhandledRejection)
			process.exit(1)
		}
	}
}
