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

export type OpsReadinessPreset = {
	active: string | null
	display_name: string | null
	model_id: string | null
	service_presets: string[]
	resident_models: string[]
}

export type OpsReadinessResponse = {
	ready: boolean
	reason: string | null
	preset: OpsReadinessPreset
	backend: string | null
	process: {
		online: boolean
		status: string | null
		model_name: string | null
		uptime_s: number | null
	}
	resources: {
		metal_active_gb: number | null
		metal_peak_gb: number | null
	}
	queue: {
		running: number
		waiting: number
	}
	hold: Record<string, unknown> | null
	health_llm: Record<string, unknown> | null
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

export async function getOpsReadiness(
	baseUrl = DEFAULT_OPS_BASE_URL,
	deps: OpsControlPlaneDeps = {},
): Promise<OpsReadinessResponse> {
	return fetchOpsJson<OpsReadinessResponse>(baseUrl, "/runtime/readiness", undefined, deps)
}

export async function pollOpsReadiness(
	baseUrl: string,
	options: {
		presetId: string
		expectedModelId?: string | null
		waitSeconds: number
		intervalMs?: number
	},
	deps: OpsControlPlaneDeps = {},
): Promise<OpsReadinessResponse> {
	const { presetId, expectedModelId, waitSeconds, intervalMs = 2_000 } = options
	const deadline = Date.now() + waitSeconds * 1_000
	let last: OpsReadinessResponse | undefined

	while (Date.now() < deadline) {
		try {
			last = await getOpsReadiness(baseUrl, deps)
			if (
				last.ready &&
				last.preset.active === presetId &&
				(!expectedModelId || last.preset.model_id === expectedModelId)
			) {
				return last
			}
		} catch {
			// Ops may be briefly unavailable during model swap
		}

		const remaining = deadline - Date.now()
		if (remaining <= 0) break
		await new Promise<void>((r) => setTimeout(r, Math.min(intervalMs, remaining)))
	}

	if (!last) {
		try {
			last = await getOpsReadiness(baseUrl, deps)
		} catch {
			return {
				ready: false,
				reason: "Ops control plane unreachable after polling timeout.",
				preset: {
					active: null,
					display_name: null,
					model_id: null,
					service_presets: [],
					resident_models: [],
				},
				backend: null,
				process: { online: false, status: null, model_name: null, uptime_s: null },
				resources: { metal_active_gb: null, metal_peak_gb: null },
				queue: { running: 0, waiting: 0 },
				hold: null,
				health_llm: null,
			}
		}
	}

	return last
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
