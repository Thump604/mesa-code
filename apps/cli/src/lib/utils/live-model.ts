import { getOpsModeContract, resolveOpsBaseUrl } from "@/lib/ops-control-plane.js"
import { isLocalBaseUrl } from "@/lib/utils/runtime-config.js"
import type { CliSettings, SupportedProvider } from "@/types/index.js"

const LOCAL_MODEL_DISCOVERY_TIMEOUT_MS = 1_500
const MAX_REPORTED_MODEL_IDS = 5

type LocalModelResolution = {
	model: string
	warning?: string
}

type LocalModelResolutionOptions = {
	provider: SupportedProvider
	baseUrl: string | undefined
	apiKey: string | undefined
	configuredModel: string
	settings: CliSettings
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, "")
}

function summarizeModelIds(modelIds: string[]): string {
	const visibleModelIds = modelIds.slice(0, MAX_REPORTED_MODEL_IDS)
	const suffix = modelIds.length > MAX_REPORTED_MODEL_IDS ? `, +${modelIds.length - MAX_REPORTED_MODEL_IDS} more` : ""
	return `${visibleModelIds.join(", ")}${suffix}`
}

function getModelIds(payload: unknown): string[] {
	if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) {
		return []
	}

	return payload.data
		.map((entry) =>
			entry && typeof entry === "object" && "id" in entry && typeof entry.id === "string" ? entry.id : undefined,
		)
		.filter((modelId): modelId is string => Boolean(modelId))
}

async function requestJson(candidateUrl: string, headers: Record<string, string>): Promise<unknown> {
	const response = await fetch(candidateUrl, {
		headers,
		signal: AbortSignal.timeout(LOCAL_MODEL_DISCOVERY_TIMEOUT_MS),
	})

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`)
	}

	return response.json()
}

async function listAvailableModelIds(
	provider: "openai" | "anthropic",
	baseUrl: string,
	apiKey: string | undefined,
): Promise<string[]> {
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
	if (!URL.canParse(normalizedBaseUrl)) {
		return []
	}

	const candidateUrls = /\/v1$/i.test(normalizedBaseUrl)
		? [`${normalizedBaseUrl}/models`]
		: [`${normalizedBaseUrl}/v1/models`, `${normalizedBaseUrl}/models`]
	const headers =
		provider === "anthropic"
			? {
					"anthropic-version": "2023-06-01",
					...(apiKey ? { "x-api-key": apiKey } : {}),
				}
			: {
					...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
				}

	for (const candidateUrl of candidateUrls) {
		try {
			const payload = await requestJson(candidateUrl, headers)
			const modelIds = getModelIds(payload)
			if (modelIds.length > 0) {
				return modelIds
			}
		} catch {
			// Try the next local models endpoint shape.
		}
	}

	return []
}

async function resolveOpsActiveModelId(settings: CliSettings): Promise<string | undefined> {
	try {
		const modeContract = await getOpsModeContract(resolveOpsBaseUrl(undefined, settings.opsBaseUrl))
		return modeContract.active_model_id?.trim() || undefined
	} catch {
		return undefined
	}
}

export async function resolveLiveLocalModel(options: LocalModelResolutionOptions): Promise<LocalModelResolution> {
	const configuredModel = options.configuredModel.trim()
	if (
		(options.provider !== "openai" && options.provider !== "anthropic") ||
		!options.baseUrl ||
		!isLocalBaseUrl(options.baseUrl)
	) {
		return { model: configuredModel }
	}

	const availableModelIds = await listAvailableModelIds(options.provider, options.baseUrl, options.apiKey)
	if (availableModelIds.length === 0) {
		return { model: configuredModel }
	}

	if (options.settings.controlPlane === "ops") {
		const activeModelId = await resolveOpsActiveModelId(options.settings)
		if (activeModelId && availableModelIds.includes(activeModelId)) {
			return {
				model: activeModelId,
				...(configuredModel && configuredModel !== activeModelId
					? {
							warning: `[CLI] Using ops-active model ${activeModelId} instead of configured model ${configuredModel}.`,
						}
					: {}),
			}
		}
	}

	if (configuredModel && availableModelIds.includes(configuredModel)) {
		return { model: configuredModel }
	}

	const resolvedModel = availableModelIds[0] ?? configuredModel
	if (!resolvedModel || resolvedModel === configuredModel) {
		return { model: resolvedModel }
	}

	const reason = configuredModel
		? `configured model ${configuredModel} is not available`
		: "no local model is configured"

	return {
		model: resolvedModel,
		warning: `[CLI] ${reason}; using ${resolvedModel} from local endpoint ${options.baseUrl} (${summarizeModelIds(
			availableModelIds,
		)}).`,
	}
}
