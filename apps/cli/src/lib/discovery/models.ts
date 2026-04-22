import type { ModelInfo, ModelRecord } from "@roo-code/types"
import { anthropicModels, openAiModelInfoSaneDefaults } from "@roo-code/types"

type DiscoveryProvider = "openai" | "anthropic" | "openrouter" | "vercel-ai-gateway" | "roo"

type RemoteModelDescriptor = Partial<ModelInfo> & {
	id: string
}

type JsonRecord = Record<string, unknown>

const REQUEST_TIMEOUT_MS = 10_000

const discoveredModelInfoDefaults: ModelInfo = {
	maxTokens: 4096,
	contextWindow: 128_000,
	supportsPromptCache: false,
}

function parseApiPrice(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value
	}
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value)
		return Number.isFinite(parsed) ? parsed : undefined
	}
	return undefined
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, "")
}

async function requestJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
	const response = await fetch(url, {
		headers,
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	})

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} from ${url}`)
	}

	return response.json()
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null
}

function readString(record: JsonRecord, key: string): string | undefined {
	return typeof record[key] === "string" ? record[key] : undefined
}

function readNumber(record: JsonRecord, key: string): number | undefined {
	return typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] : undefined
}

function readRecord(record: JsonRecord, key: string): JsonRecord | undefined {
	return isRecord(record[key]) ? record[key] : undefined
}

function readArray(record: JsonRecord, key: string): unknown[] | undefined {
	return Array.isArray(record[key]) ? record[key] : undefined
}

function includesString(value: unknown, expected: string): boolean {
	return Array.isArray(value) && value.some((entry) => entry === expected)
}

function getResponseEntries(payload: unknown): JsonRecord[] {
	if (!isRecord(payload)) {
		return []
	}

	const data = payload.data
	return Array.isArray(data) ? data.filter(isRecord) : []
}

function parseOpenRouterModel(model: JsonRecord): RemoteModelDescriptor | undefined {
	const id = readString(model, "id")
	if (!id) {
		return undefined
	}

	const architecture = readRecord(model, "architecture")
	if (includesString(architecture?.output_modalities, "image")) {
		return undefined
	}

	const pricing = readRecord(model, "pricing")
	const topProvider = readRecord(model, "top_provider")

	return {
		id,
		maxTokens:
			readNumber(topProvider ?? {}, "max_completion_tokens") ??
			readNumber(model, "max_completion_tokens") ??
			4096,
		contextWindow: readNumber(model, "context_length") ?? 128_000,
		supportsImages: includesString(architecture?.input_modalities, "image"),
		supportsPromptCache:
			typeof pricing?.input_cache_read !== "undefined" || typeof pricing?.input_cache_write !== "undefined",
		inputPrice: parseApiPrice(pricing?.prompt),
		outputPrice: parseApiPrice(pricing?.completion),
		cacheWritesPrice: parseApiPrice(pricing?.input_cache_write),
		cacheReadsPrice: parseApiPrice(pricing?.input_cache_read),
		description: readString(model, "description"),
	}
}

function parseVercelModel(model: JsonRecord): RemoteModelDescriptor | undefined {
	if (readString(model, "type") !== "language") {
		return undefined
	}

	const id = readString(model, "id")
	if (!id) {
		return undefined
	}

	const pricing = readRecord(model, "pricing")

	return {
		id,
		maxTokens: readNumber(model, "max_tokens") ?? 4096,
		contextWindow: readNumber(model, "context_window") ?? 128_000,
		supportsPromptCache:
			typeof pricing?.input_cache_read !== "undefined" && typeof pricing?.input_cache_write !== "undefined",
		inputPrice: parseApiPrice(pricing?.input),
		outputPrice: parseApiPrice(pricing?.output),
		cacheWritesPrice: parseApiPrice(pricing?.input_cache_write),
		cacheReadsPrice: parseApiPrice(pricing?.input_cache_read),
		description: readString(model, "description"),
	}
}

function parseRooModel(model: JsonRecord): RemoteModelDescriptor | undefined {
	const id = readString(model, "id")
	if (!id) {
		return undefined
	}

	const pricing = readRecord(model, "pricing")
	const tags = readArray(model, "tags")

	return {
		id,
		maxTokens: readNumber(model, "max_tokens") ?? 4096,
		contextWindow: readNumber(model, "context_window") ?? 128_000,
		supportsImages: includesString(tags, "vision"),
		supportsPromptCache:
			typeof pricing?.input_cache_read !== "undefined" || typeof pricing?.input_cache_write !== "undefined",
		supportsReasoningEffort: includesString(tags, "reasoning"),
		requiredReasoningEffort: includesString(tags, "reasoning-required"),
		inputPrice: parseApiPrice(pricing?.input),
		outputPrice: parseApiPrice(pricing?.output),
		cacheWritesPrice: parseApiPrice(pricing?.input_cache_write),
		cacheReadsPrice: parseApiPrice(pricing?.input_cache_read),
		description: readString(model, "description") ?? readString(model, "name"),
	}
}

function toDiscoveredModelRecord(modelIds: string[], provider: "openai" | "anthropic"): ModelRecord {
	const uniqueModelIds = [...new Set(modelIds)].sort()

	return Object.fromEntries(
		uniqueModelIds.map((modelId) => {
			if (provider === "openai") {
				return [modelId, { ...openAiModelInfoSaneDefaults }]
			}

			const knownAnthropicModel = anthropicModels[modelId as keyof typeof anthropicModels]
			return [modelId, knownAnthropicModel ? { ...knownAnthropicModel } : { ...discoveredModelInfoDefaults }]
		}),
	)
}

function toModelRecord(models: RemoteModelDescriptor[], provider?: DiscoveryProvider): ModelRecord {
	const uniqueModels = new Map<string, ModelInfo>()

	for (const model of models) {
		if (!model.id) {
			continue
		}

		const knownAnthropicModel =
			provider === "anthropic" ? anthropicModels[model.id as keyof typeof anthropicModels] : undefined

		uniqueModels.set(model.id, {
			...(knownAnthropicModel ? { ...knownAnthropicModel } : { ...discoveredModelInfoDefaults }),
			...model,
		})
	}

	return Object.fromEntries([...uniqueModels.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

export async function getOpenAiCompatibleModels(baseUrl: string, apiKey?: string): Promise<ModelRecord> {
	const trimmedBaseUrl = baseUrl.trim()
	if (!URL.canParse(trimmedBaseUrl)) {
		return {}
	}

	const data = await requestJson(`${trimmedBaseUrl}/models`, apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
	const modelIds = getResponseEntries(data)
		.map((model) => readString(model, "id"))
		.filter((modelId): modelId is string => Boolean(modelId))
	return toDiscoveredModelRecord(modelIds, "openai")
}

export async function getAnthropicCompatibleModels(baseUrl: string, apiKey?: string): Promise<ModelRecord> {
	const trimmedBaseUrl = baseUrl.trim()
	if (!URL.canParse(trimmedBaseUrl)) {
		return {}
	}

	const normalizedBaseUrl = normalizeBaseUrl(trimmedBaseUrl)
	const candidateUrls = /\/v1$/i.test(normalizedBaseUrl)
		? [`${normalizedBaseUrl}/models`]
		: [`${normalizedBaseUrl}/v1/models`, `${normalizedBaseUrl}/models`]

	for (const candidateUrl of candidateUrls) {
		try {
			const data = await requestJson(candidateUrl, {
				"anthropic-version": "2023-06-01",
				...(apiKey ? { "x-api-key": apiKey } : {}),
			})
			const modelIds = getResponseEntries(data)
				.map((model) => readString(model, "id"))
				.filter((modelId): modelId is string => Boolean(modelId))
			return toDiscoveredModelRecord(modelIds, "anthropic")
		} catch {
			// Try alternate Anthropic-compatible URL shapes.
		}
	}

	return {}
}

export async function getRouterModels(
	provider: Exclude<DiscoveryProvider, "openai" | "anthropic">,
	options: { apiKey?: string; baseUrl?: string } = {},
): Promise<ModelRecord> {
	if (provider === "openrouter") {
		const baseUrl = normalizeBaseUrl(options.baseUrl || "https://openrouter.ai/api/v1")
		const data = await requestJson(
			`${baseUrl}/models`,
			options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {},
		)
		const models = getResponseEntries(data)
			.map(parseOpenRouterModel)
			.filter((model): model is RemoteModelDescriptor => Boolean(model))
		return toModelRecord(models, provider)
	}

	if (provider === "vercel-ai-gateway") {
		const baseUrl = "https://ai-gateway.vercel.sh/v1"
		const data = await requestJson(`${baseUrl}/models`)
		const models = getResponseEntries(data)
			.map(parseVercelModel)
			.filter((model): model is RemoteModelDescriptor => Boolean(model))
		return toModelRecord(models, provider)
	}

	const normalizedBaseUrl = normalizeBaseUrl(options.baseUrl || "https://api.roocode.com/proxy")
	const rooBaseUrl = normalizedBaseUrl.replace(/\/?v1\/?$/i, "")
	const data = await requestJson(
		`${rooBaseUrl}/v1/models`,
		options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {},
	)
	const models = getResponseEntries(data)
		.map(parseRooModel)
		.filter((model): model is RemoteModelDescriptor => Boolean(model))
	return toModelRecord(models, provider)
}
