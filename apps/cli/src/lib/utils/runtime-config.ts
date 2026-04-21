import { DEFAULT_FLAGS } from "@/types/constants.js"
import type { CliSettings, SupportedProvider } from "@/types/index.js"

function getSettingsBaseUrl(settings: CliSettings): string | undefined {
	return settings.baseUrl ?? settings.openAiBaseUrl
}

function getSettingsApiKey(settings: CliSettings): string | undefined {
	return settings.apiKey ?? settings.openAiApiKey
}

function hasConfiguredOpenAiCompatSettings(settings: CliSettings): boolean {
	return Boolean(getSettingsBaseUrl(settings) || getSettingsApiKey(settings) || settings.openAiModelId)
}

export function isLocalOpenAiBaseUrl(baseUrl: string | undefined): boolean {
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

export function resolveConfiguredBaseUrl(flagBaseUrl: string | undefined, settings: CliSettings): string | undefined {
	return flagBaseUrl ?? getSettingsBaseUrl(settings) ?? process.env.OPENAI_BASE_URL
}

export function resolveEffectiveProvider(
	flagProvider: SupportedProvider | undefined,
	settings: CliSettings,
	rooTokenAvailable: boolean,
): SupportedProvider {
	if (flagProvider) {
		return flagProvider
	}

	if (settings.provider) {
		return settings.provider
	}

	if (hasConfiguredOpenAiCompatSettings(settings) || process.env.OPENAI_BASE_URL) {
		return "openai"
	}

	return rooTokenAvailable ? "roo" : "openrouter"
}

export function resolveEffectiveModel(
	flagModel: string | undefined,
	settings: CliSettings,
	provider: SupportedProvider,
): string {
	if (flagModel) {
		return flagModel
	}

	if (provider === "openai") {
		return settings.openAiModelId ?? settings.model ?? ""
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
	if (provider === "openai") {
		const resolved = flagApiKey ?? getSettingsApiKey(settings) ?? envApiKey
		if (resolved) {
			return resolved
		}

		if (isLocalOpenAiBaseUrl(baseUrl)) {
			return "not-needed"
		}

		return undefined
	}

	return flagApiKey ?? settings.apiKey ?? envApiKey
}
