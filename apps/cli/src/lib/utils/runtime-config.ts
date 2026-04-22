import { DEFAULT_FLAGS, DEFAULT_LOCAL_BASE_URLS } from "@/types/constants.js"
import type { CliSettings, SupportedApiStandard, SupportedLocalRuntime, SupportedProvider } from "@/types/index.js"

function getProtocolBaseUrlEnvVar(protocol: SupportedApiStandard): string | undefined {
	return protocol === "anthropic" ? process.env.ANTHROPIC_BASE_URL : process.env.OPENAI_BASE_URL
}

function getSettingsBaseUrl(settings: CliSettings, protocol: SupportedApiStandard): string | undefined {
	if (settings.baseUrl) {
		return settings.baseUrl
	}

	return protocol === "anthropic" ? settings.anthropicBaseUrl : settings.openAiBaseUrl
}

function getSettingsApiKey(settings: CliSettings, protocol: SupportedApiStandard): string | undefined {
	if (settings.apiKey) {
		return settings.apiKey
	}

	return protocol === "openai" ? settings.openAiApiKey : undefined
}

function hasConfiguredProtocolSettings(
	settings: CliSettings,
	protocol: SupportedApiStandard,
	runtime: SupportedLocalRuntime | undefined,
): boolean {
	const configuredModel = protocol === "openai" ? (settings.openAiModelId ?? settings.model) : settings.model
	return Boolean(
		runtime || getSettingsBaseUrl(settings, protocol) || getSettingsApiKey(settings, protocol) || configuredModel,
	)
}

export function isLocalBaseUrl(baseUrl: string | undefined): boolean {
	if (!baseUrl) {
		return false
	}

	try {
		const url = new URL(baseUrl)
		return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(url.hostname)
	} catch {
		return false
	}
}

export const isLocalOpenAiBaseUrl = isLocalBaseUrl

export function resolveEffectiveProtocol(
	flagProtocol: SupportedApiStandard | undefined,
	flagProvider: SupportedProvider | undefined,
	settings: CliSettings,
): SupportedApiStandard {
	if (flagProvider === "anthropic") {
		return "anthropic"
	}

	if (flagProvider === "openai") {
		return "openai"
	}

	if (flagProtocol) {
		return flagProtocol
	}

	if (settings.provider === "anthropic") {
		return "anthropic"
	}

	if (settings.provider === "openai") {
		return "openai"
	}

	return settings.protocol ?? "openai"
}

export function resolveEffectiveRuntime(
	flagRuntime: SupportedLocalRuntime | undefined,
	settings: CliSettings,
): SupportedLocalRuntime | undefined {
	return flagRuntime ?? settings.runtime
}

export function resolveConfiguredBaseUrl(
	flagBaseUrl: string | undefined,
	settings: CliSettings,
	protocol: SupportedApiStandard,
	runtime?: SupportedLocalRuntime,
): string | undefined {
	return (
		flagBaseUrl ??
		getSettingsBaseUrl(settings, protocol) ??
		getProtocolBaseUrlEnvVar(protocol) ??
		(runtime ? DEFAULT_LOCAL_BASE_URLS[protocol] : undefined)
	)
}

export function resolveEffectiveProvider(
	flagProvider: SupportedProvider | undefined,
	settings: CliSettings,
	protocol: SupportedApiStandard,
	runtime: SupportedLocalRuntime | undefined,
): SupportedProvider {
	if (flagProvider) {
		return flagProvider
	}

	if (settings.provider && settings.provider !== "roo") {
		return settings.provider
	}

	if (hasConfiguredProtocolSettings(settings, protocol, runtime) || getProtocolBaseUrlEnvVar(protocol)) {
		return protocol === "anthropic" ? "anthropic" : "openai"
	}

	return protocol === "anthropic" ? "anthropic" : "openai"
}

export function resolveEffectiveModel(
	flagModel: string | undefined,
	settings: CliSettings,
	provider: SupportedProvider,
	baseUrl: string | undefined,
	runtime: SupportedLocalRuntime | undefined,
): string {
	const isImplicitDefaultModel = flagModel === DEFAULT_FLAGS.model
	const shouldForceExplicitLocalModel = isImplicitDefaultModel && Boolean(baseUrl || runtime)

	if (flagModel) {
		if ((provider === "openai" || provider === "anthropic") && shouldForceExplicitLocalModel) {
			// The commander default is a hosted Anthropic model ID, which is the wrong
			// contract for local/private runtime profiles.
			return ""
		}

		return flagModel
	}

	if (provider === "openai") {
		return settings.openAiModelId ?? settings.model ?? ""
	}

	if (provider === "anthropic") {
		return settings.model ?? ""
	}

	return settings.model ?? DEFAULT_FLAGS.model
}

export function resolveConfiguredApiKey(
	provider: SupportedProvider,
	flagApiKey: string | undefined,
	settings: CliSettings,
	envApiKey: string | undefined,
	baseUrl: string | undefined,
): string | undefined {
	if (provider === "openai" || provider === "anthropic") {
		const protocol = provider === "anthropic" ? "anthropic" : "openai"
		const resolved = flagApiKey ?? getSettingsApiKey(settings, protocol) ?? envApiKey
		if (resolved) {
			return resolved
		}

		if (isLocalBaseUrl(baseUrl)) {
			return "not-needed"
		}

		return undefined
	}

	return flagApiKey ?? settings.apiKey ?? envApiKey
}

export function buildLocalRuntimeSettingsPatch(options: {
	provider: SupportedProvider
	protocol: SupportedApiStandard
	runtime: SupportedLocalRuntime
	baseUrl: string
	model: string
	apiKey?: string
}): Partial<CliSettings> {
	const persistedApiKey = options.apiKey && options.apiKey !== "not-needed" ? options.apiKey : undefined
	const patch: Partial<CliSettings> = {
		controlPlane: "direct-runtime",
		opsBaseUrl: undefined,
		activePresetId: undefined,
		provider: options.provider,
		protocol: options.protocol,
		runtime: options.runtime,
		baseUrl: options.baseUrl,
		model: options.model,
		apiKey: persistedApiKey,
	}

	if (options.protocol === "openai") {
		patch.openAiBaseUrl = options.baseUrl
		patch.openAiModelId = options.model
		patch.openAiApiKey = persistedApiKey
	}

	if (options.protocol === "anthropic") {
		patch.anthropicBaseUrl = options.baseUrl
	}

	return patch
}
