import type { CliSettings, SupportedApiStandard, SupportedLocalRuntime, SupportedProvider } from "@/types/index.js"

const OPS_REQUEST_TIMEOUT_MS = 1_500

export const DEFAULT_OPS_BASE_URL = process.env.ROO_OPS_BASE_URL || "http://127.0.0.1:8001"

export type OpsModelPreset = {
	id: string
	display_name?: string
	model_id?: string | null
}

export type OpsPresetsResponse = {
	model_presets: OpsModelPreset[]
}

export type OpsModeContract = {
	mode?: string
	model?: string | null
	active_preset?: string | null
	active_preset_display_name?: string | null
	active_model_id?: string | null
	active_model_display_name?: string | null
}

export type OpsActivatePresetResponse = {
	activated: string
	model_id?: string | null
	state?: Record<string, unknown>
	swap?: Record<string, unknown>
}

type OpsControlPlaneDeps = {
	fetch?: typeof fetch
}

async function fetchOpsJson<T>(
	baseUrl: string,
	pathname: string,
	init: RequestInit | undefined,
	deps: OpsControlPlaneDeps,
): Promise<T> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), OPS_REQUEST_TIMEOUT_MS)

	try {
		const response = await (deps.fetch ?? fetch)(new URL(pathname, normalizeOpsBaseUrl(baseUrl)), {
			...init,
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				...(init?.headers ?? {}),
			},
			signal: controller.signal,
		})

		if (!response.ok) {
			throw new Error(`Ops control plane request failed: ${response.status} ${response.statusText}`)
		}

		return (await response.json()) as T
	} finally {
		clearTimeout(timeout)
	}
}

function normalizeOpsBaseUrl(baseUrl: string): string {
	return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
}

export function resolveOpsBaseUrl(explicitBaseUrl: string | undefined, savedBaseUrl: string | undefined): string {
	return explicitBaseUrl ?? savedBaseUrl ?? DEFAULT_OPS_BASE_URL
}

export async function isOpsControlPlaneAvailable(
	baseUrl = DEFAULT_OPS_BASE_URL,
	deps: OpsControlPlaneDeps = {},
): Promise<boolean> {
	try {
		await fetchOpsJson<OpsModeContract>(baseUrl, "/mode", undefined, deps)
		return true
	} catch {
		return false
	}
}

export async function getOpsModeContract(
	baseUrl = DEFAULT_OPS_BASE_URL,
	deps: OpsControlPlaneDeps = {},
): Promise<OpsModeContract> {
	return fetchOpsJson<OpsModeContract>(baseUrl, "/mode", undefined, deps)
}

export async function listOpsModelPresets(
	baseUrl = DEFAULT_OPS_BASE_URL,
	deps: OpsControlPlaneDeps = {},
): Promise<OpsModelPreset[]> {
	const payload = await fetchOpsJson<OpsPresetsResponse>(baseUrl, "/presets", undefined, deps)
	return Array.isArray(payload.model_presets) ? payload.model_presets : []
}

export async function activateOpsPreset(
	baseUrl: string,
	presetId: string,
	force = false,
	deps: OpsControlPlaneDeps = {},
): Promise<OpsActivatePresetResponse> {
	const path = force
		? `/presets/activate/${encodeURIComponent(presetId)}?force=true`
		: `/presets/activate/${encodeURIComponent(presetId)}`
	return fetchOpsJson<OpsActivatePresetResponse>(
		baseUrl,
		path,
		{
			method: "POST",
			body: JSON.stringify({}),
		},
		deps,
	)
}

export function buildOpsControlPlaneSettingsPatch(options: {
	opsBaseUrl: string
	presetId: string
	provider: SupportedProvider
	protocol: SupportedApiStandard
	runtime: SupportedLocalRuntime
	baseUrl: string
	model: string
	apiKey?: string
}): Partial<CliSettings> {
	const persistedApiKey = options.apiKey && options.apiKey !== "not-needed" ? options.apiKey : undefined
	const patch: Partial<CliSettings> = {
		controlPlane: "ops",
		opsBaseUrl: options.opsBaseUrl,
		activePresetId: options.presetId,
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
		patch.anthropicBaseUrl = undefined
	}

	if (options.protocol === "anthropic") {
		patch.anthropicBaseUrl = options.baseUrl
	}

	return patch
}
