import type { ProviderName, ReasoningEffortExtended } from "@roo-code/types"
import type { OutputFormat } from "./json-events.js"

export const supportedProviders = [
	"anthropic",
	"openai",
	"openai-native",
	"gemini",
	"openrouter",
	"vercel-ai-gateway",
] as const satisfies ProviderName[]

export type SupportedProvider = (typeof supportedProviders)[number]

export function isSupportedProvider(provider: string): provider is SupportedProvider {
	return supportedProviders.includes(provider as SupportedProvider)
}

export const supportedApiStandards = ["openai", "anthropic"] as const

export type SupportedApiStandard = (typeof supportedApiStandards)[number]

export function isSupportedApiStandard(protocol: string): protocol is SupportedApiStandard {
	return supportedApiStandards.includes(protocol as SupportedApiStandard)
}

export const supportedLocalRuntimes = ["llama.cpp", "vllm-mlx"] as const

export type SupportedLocalRuntime = (typeof supportedLocalRuntimes)[number]

export function isSupportedLocalRuntime(runtime: string): runtime is SupportedLocalRuntime {
	return supportedLocalRuntimes.includes(runtime as SupportedLocalRuntime)
}

export type ReasoningEffortFlagOptions = ReasoningEffortExtended | "unspecified" | "disabled"

export type FlagOptions = {
	promptFile?: string
	createWithSessionId?: string
	sessionId?: string
	continue: boolean
	workspace?: string
	print: boolean
	stdinPromptStream: boolean
	signalOnlyExit: boolean
	extension?: string
	debug: boolean
	requireApproval: boolean
	exitOnError: boolean
	apiKey?: string
	provider?: SupportedProvider
	protocol?: SupportedApiStandard
	runtime?: SupportedLocalRuntime
	baseUrl?: string
	model?: string
	mode?: string
	terminalShell?: string
	reasoningEffort?: ReasoningEffortFlagOptions
	consecutiveMistakeLimit?: number
	ephemeral: boolean
	oneshot: boolean
	outputFormat?: OutputFormat
}

export type LegacyOnboardingProviderChoice = "roo" | "byok"

export interface CliSettings {
	/** @deprecated Legacy onboarding choice preserved only for migration bookkeeping. */
	onboardingProviderChoice?: LegacyOnboardingProviderChoice
	/** True once the local/private-first onboarding guidance has been shown. */
	hasCompletedOnboarding?: boolean
	/** Default mode to use (e.g., "code", "architect", "ask", "debug") */
	mode?: string
	/** Default provider to use. Legacy Roo cloud provider values are ignored during resolution. */
	provider?: SupportedProvider | "roo"
	/** Default model to use */
	model?: string
	/** Default reasoning effort level */
	reasoningEffort?: ReasoningEffortFlagOptions
	/** Default consecutive error/repetition limit before guidance prompts */
	consecutiveMistakeLimit?: number
	/** Require manual approval for tools/commands/browser/MCP actions */
	requireApproval?: boolean
	/** @deprecated Legacy inverse setting kept for backward compatibility */
	dangerouslySkipPermissions?: boolean
	/** Exit upon task completion */
	oneshot?: boolean
	/** Protocol-aware base URL for local/private setups */
	baseUrl?: string
	/** Protocol-aware API key override for local/private setups */
	apiKey?: string
	/** Selected API standard for generic local/private runtimes */
	protocol?: SupportedApiStandard
	/** Selected local runtime profile */
	runtime?: SupportedLocalRuntime
	/** Legacy imported OpenAI-compatible settings retained for migration */
	openAiBaseUrl?: string
	openAiApiKey?: string
	openAiModelId?: string
	/** Explicit Anthropic-compatible endpoint for local/private setups */
	anthropicBaseUrl?: string
}
