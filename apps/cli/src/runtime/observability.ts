import type { SupportedApiStandard, SupportedLocalRuntime } from "@/types/index.js"

export type MetricCategory = "request" | "latency" | "token" | "queue" | "cache" | "resource" | "general"

export type UnifiedRuntimeMetric = {
	rawName: string
	semanticName: string
	type: "counter" | "gauge" | "histogram" | "summary" | "unknown"
	category: MetricCategory
	value: number
	unit?: string
	description?: string
	attributes: Record<string, string>
}

export type RuntimeProbeAttempt = {
	url: string
	ok: boolean
	status?: number
	error?: string
}

export type RuntimeProbeResult<T> = {
	ok: boolean
	attempts: RuntimeProbeAttempt[]
	url?: string
	status?: number
	error?: string
	data?: T
}

export type RuntimeDoctorReport = {
	runtime: SupportedLocalRuntime
	runtimeClass: "local-inference-engine"
	protocol: SupportedApiStandard
	baseUrl: string
	modelClass: "openai-compatible" | "anthropic-compatible"
	health: RuntimeProbeResult<{ bodyText?: string }>
	models: RuntimeProbeResult<{ modelIds: string[] }>
	metrics: RuntimeProbeResult<{
		rawMetricCount: number
		openTelemetryMetrics: UnifiedRuntimeMetric[]
		resourceAttributes: Record<string, string>
	}>
	hints: string[]
}

type RuntimeAdapter = {
	runtime: SupportedLocalRuntime
	displayName: string
	healthUrls(baseUrl: string): string[]
	modelUrls(baseUrl: string, protocol: SupportedApiStandard): string[]
	metricUrls(baseUrl: string): string[]
}

type RuntimeDoctorDeps = {
	fetchImpl: typeof fetch
}

const defaultDeps: RuntimeDoctorDeps = {
	fetchImpl: fetch,
}

function sanitizeMetricName(name: string): string {
	return name
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toLowerCase()
}

function runtimeMetricNamespace(runtime: SupportedLocalRuntime): string {
	return runtime.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()
}

function getBaseCandidates(baseUrl: string): string[] {
	const url = new URL(baseUrl)
	const trimmedPath = url.pathname.replace(/\/+$/, "")
	const withoutV1 = trimmedPath.replace(/\/v1$/, "")
	const origin = url.origin
	const rootBase = withoutV1 ? `${origin}${withoutV1}` : origin
	return Array.from(new Set([rootBase, origin, baseUrl.replace(/\/+$/, "")]))
}

function buildAdapter(runtime: SupportedLocalRuntime): RuntimeAdapter {
	return {
		runtime,
		displayName: runtime,
		healthUrls(baseUrl) {
			const bases = getBaseCandidates(baseUrl)
			return Array.from(
				new Set(bases.flatMap((base) => [`${base}/health`, `${base}/ready`, `${base}/v1/models`])),
			)
		},
		modelUrls(baseUrl, protocol) {
			const bases = getBaseCandidates(baseUrl)
			const directBase = baseUrl.replace(/\/+$/, "")
			const protocolFirst =
				protocol === "openai"
					? [
							`${directBase}/models`,
							...bases.map((base) => `${base}/v1/models`),
							...bases.map((base) => `${base}/models`),
						]
					: [
							...bases.map((base) => `${base}/v1/models`),
							`${directBase}/models`,
							...bases.map((base) => `${base}/models`),
						]
			return Array.from(new Set(protocolFirst))
		},
		metricUrls(baseUrl) {
			const bases = getBaseCandidates(baseUrl)
			return Array.from(new Set(bases.flatMap((base) => [`${base}/metrics`, `${base}/v1/metrics`])))
		},
	}
}

function buildAuthHeaders(
	protocol: SupportedApiStandard,
	apiKey: string | undefined,
): Record<string, string> | undefined {
	if (!apiKey || apiKey === "not-needed") {
		return undefined
	}

	if (protocol === "anthropic") {
		return {
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
		}
	}

	return {
		Authorization: `Bearer ${apiKey}`,
	}
}

async function probeUrls<T>(
	urls: string[],
	request: (url: string) => Promise<{ status: number; bodyText: string; ok: boolean; contentType: string | null }>,
	parser?: (
		response: { status: number; bodyText: string; ok: boolean; contentType: string | null },
		url: string,
	) => T,
): Promise<RuntimeProbeResult<T>> {
	const attempts: RuntimeProbeAttempt[] = []

	for (const url of urls) {
		try {
			const response = await request(url)
			if (!response.ok) {
				attempts.push({
					url,
					ok: false,
					status: response.status,
					error: `HTTP ${response.status}`,
				})
				continue
			}

			const data = parser ? parser(response, url) : ({ bodyText: response.bodyText } as T)
			attempts.push({
				url,
				ok: true,
				status: response.status,
			})
			return {
				ok: true,
				attempts,
				url,
				status: response.status,
				data,
			}
		} catch (error) {
			attempts.push({
				url,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	const lastAttempt = attempts.at(-1)
	return {
		ok: false,
		attempts,
		url: lastAttempt?.url,
		status: lastAttempt?.status,
		error: lastAttempt?.error || "No runtime endpoint responded",
	}
}

function parseModelResponse(bodyText: string): { modelIds: string[] } {
	const parsed = JSON.parse(bodyText) as unknown

	let rawModels: Array<{ id?: string } | string> = []
	if (Array.isArray(parsed)) {
		rawModels = parsed
	} else if (parsed && typeof parsed === "object" && "data" in parsed && Array.isArray(parsed.data)) {
		rawModels = parsed.data
	} else if (parsed && typeof parsed === "object" && "models" in parsed && Array.isArray(parsed.models)) {
		rawModels = parsed.models
	}

	const modelIds = rawModels
		.map((entry) => {
			if (typeof entry === "string") {
				return entry
			}
			return entry.id
		})
		.filter((value): value is string => Boolean(value))

	if (modelIds.length === 0) {
		throw new Error("No model IDs found")
	}

	return {
		modelIds: Array.from(new Set(modelIds)).sort(),
	}
}

type MetricFamilyMeta = {
	type?: UnifiedRuntimeMetric["type"]
	description?: string
	unit?: string
}

function parseLabels(input: string | undefined): Record<string, string> {
	if (!input) {
		return {}
	}

	const labels: Record<string, string> = {}
	const labelPattern = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g
	let match: RegExpExecArray | null

	while ((match = labelPattern.exec(input)) !== null) {
		const key = match[1]
		const value = match[2]
		if (!key || value === undefined) {
			continue
		}
		labels[key] = value.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
	}

	return labels
}

function metricCategoryForName(metricName: string): MetricCategory {
	const lowered = metricName.toLowerCase()
	if (lowered.includes("token")) {
		return "token"
	}
	if (
		lowered.includes("latency") ||
		lowered.includes("duration") ||
		lowered.includes("seconds") ||
		lowered.includes("ttft")
	) {
		return "latency"
	}
	if (lowered.includes("request") || lowered.includes("completion")) {
		return "request"
	}
	if (lowered.includes("queue") || lowered.includes("running") || lowered.includes("waiting")) {
		return "queue"
	}
	if (lowered.includes("cache") || lowered.includes("kv")) {
		return "cache"
	}
	if (lowered.includes("memory") || lowered.includes("gpu") || lowered.includes("cpu")) {
		return "resource"
	}
	return "general"
}

function parsePrometheusMetrics(runtime: SupportedLocalRuntime, input: string): UnifiedRuntimeMetric[] {
	const families = new Map<string, MetricFamilyMeta>()
	const metrics: UnifiedRuntimeMetric[] = []
	const runtimeNamespace = runtimeMetricNamespace(runtime)

	for (const rawLine of input.split("\n")) {
		const line = rawLine.trim()
		if (!line) {
			continue
		}

		if (line.startsWith("# HELP ")) {
			const [, name, ...rest] = line.split(" ")
			if (!name) {
				continue
			}
			families.set(name, { ...(families.get(name) || {}), description: rest.join(" ") })
			continue
		}

		if (line.startsWith("# TYPE ")) {
			const [, name, type] = line.split(" ")
			if (!name || !type) {
				continue
			}
			const normalizedType =
				type === "counter" || type === "gauge" || type === "histogram" || type === "summary" ? type : "unknown"
			families.set(name, { ...(families.get(name) || {}), type: normalizedType })
			continue
		}

		if (line.startsWith("# UNIT ")) {
			const [, name, unit] = line.split(" ")
			if (!name || !unit) {
				continue
			}
			families.set(name, { ...(families.get(name) || {}), unit })
			continue
		}

		const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([^\s]+)(?:\s+\d+)?$/)
		if (!match) {
			continue
		}

		const rawName = match[1]
		const rawLabelText = match[3]
		const rawValue = match[4]
		if (!rawName || rawValue === undefined) {
			continue
		}
		const labels = parseLabels(rawLabelText)
		const numericValue = Number.parseFloat(rawValue)
		if (!Number.isFinite(numericValue)) {
			continue
		}

		const familyName = families.has(rawName) ? rawName : rawName.replace(/_(bucket|sum|count)$/u, "")
		const family = families.get(familyName)

		metrics.push({
			rawName,
			semanticName: `gen_ai.local.${runtimeNamespace}.${sanitizeMetricName(rawName)}`,
			type: family?.type ?? "unknown",
			category: metricCategoryForName(rawName),
			value: numericValue,
			unit: family?.unit,
			description: family?.description,
			attributes: {
				runtime,
				...labels,
			},
		})
	}

	return metrics
}

function buildResourceAttributes(
	runtime: SupportedLocalRuntime,
	protocol: SupportedApiStandard,
	baseUrl: string,
): Record<string, string> {
	const endpoint = new URL(baseUrl)
	return {
		"service.name": `roo-cli-${runtimeMetricNamespace(runtime)}`,
		"gen_ai.runtime.name": runtime,
		"gen_ai.endpoint.protocol": protocol,
		"server.address": endpoint.hostname,
		"server.port": endpoint.port || (endpoint.protocol === "https:" ? "443" : "80"),
		"url.full": baseUrl,
	}
}

function buildHints(report: Omit<RuntimeDoctorReport, "hints">): string[] {
	const hints: string[] = []

	if (!report.health.ok) {
		hints.push(`No ${report.runtime} health endpoint responded. Start the local server and re-run roo doctor.`)
	}

	if (report.health.ok && !report.models.ok) {
		hints.push(`The runtime is up, but model discovery did not succeed. You may need to supply model IDs manually.`)
	}

	if (report.health.ok && !report.metrics.ok) {
		hints.push(`Expose a Prometheus-compatible /metrics endpoint to unify observability across local runtimes.`)
	}

	if (report.metrics.ok) {
		hints.push(`The metrics payload is normalized into an OpenTelemetry-aligned namespace under gen_ai.local.*.`)
	}

	return hints
}

export async function collectRuntimeDoctorReport(
	{
		runtime,
		protocol,
		baseUrl,
		apiKey,
	}: {
		runtime: SupportedLocalRuntime
		protocol: SupportedApiStandard
		baseUrl: string
		apiKey?: string
	},
	deps: Partial<RuntimeDoctorDeps> = {},
): Promise<RuntimeDoctorReport> {
	const adapter = buildAdapter(runtime)
	const resolvedDeps = { ...defaultDeps, ...deps }
	const authHeaders = buildAuthHeaders(protocol, apiKey)

	const request = async (url: string, headers?: Record<string, string>) => {
		const response = await resolvedDeps.fetchImpl(url, {
			headers,
		})
		return {
			ok: response.ok,
			status: response.status,
			bodyText: await response.text(),
			contentType: response.headers.get("content-type"),
		}
	}

	const health = await probeUrls<{ bodyText?: string }>(
		adapter.healthUrls(baseUrl),
		(url) => request(url),
		(response) => ({ bodyText: response.bodyText }),
	)
	const models = await probeUrls(
		adapter.modelUrls(baseUrl, protocol),
		(url) => request(url, authHeaders),
		(response) => parseModelResponse(response.bodyText),
	)
	const metrics = await probeUrls(
		adapter.metricUrls(baseUrl),
		(url) => request(url),
		(response) => {
			const openTelemetryMetrics = parsePrometheusMetrics(runtime, response.bodyText)
			if (openTelemetryMetrics.length === 0) {
				throw new Error("No Prometheus metrics found")
			}

			return {
				rawMetricCount: openTelemetryMetrics.length,
				openTelemetryMetrics,
				resourceAttributes: buildResourceAttributes(runtime, protocol, baseUrl),
			}
		},
	)

	const reportWithoutHints = {
		runtime,
		runtimeClass: "local-inference-engine" as const,
		protocol,
		baseUrl,
		modelClass: protocol === "anthropic" ? ("anthropic-compatible" as const) : ("openai-compatible" as const),
		health,
		models,
		metrics,
	}

	return {
		...reportWithoutHints,
		hints: buildHints(reportWithoutHints),
	}
}
