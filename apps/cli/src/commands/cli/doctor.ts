import { loadSettings } from "@/lib/storage/index.js"
import { getApiKeyFromEnv } from "@/lib/utils/provider.js"
import {
	resolveConfiguredApiKey,
	resolveConfiguredBaseUrl,
	resolveEffectiveProtocol,
	resolveEffectiveProvider,
	resolveEffectiveRuntime,
} from "@/lib/utils/runtime-config.js"
import {
	isSupportedApiStandard,
	isSupportedLocalRuntime,
	supportedApiStandards,
	supportedLocalRuntimes,
	type SupportedApiStandard,
	type SupportedLocalRuntime,
	type SupportedProvider,
} from "@/types/index.js"
import { collectRuntimeDoctorReport, type RuntimeDoctorReport } from "@/runtime/observability.js"

type DoctorFormat = "json" | "text"

export type DoctorOptions = {
	apiKey?: string
	provider?: SupportedProvider
	protocol?: SupportedApiStandard
	runtime?: SupportedLocalRuntime
	baseUrl?: string
	format?: string
}

function parseDoctorFormat(rawFormat: string | undefined): DoctorFormat {
	const format = (rawFormat ?? "text").toLowerCase()
	if (format === "json" || format === "text") {
		return format
	}

	throw new Error(`Invalid format: ${rawFormat}. Must be "json" or "text".`)
}

function outputJson(data: unknown): void {
	process.stdout.write(JSON.stringify(data, null, 2) + "\n")
}

function outputText(report: RuntimeDoctorReport): void {
	process.stdout.write(`Runtime: ${report.runtime}\n`)
	process.stdout.write(`Protocol: ${report.protocol}\n`)
	process.stdout.write(`Base URL: ${report.baseUrl}\n`)
	process.stdout.write(`Model Class: ${report.modelClass}\n`)
	process.stdout.write(
		`Health: ${report.health.ok ? "ok" : "down"}${report.health.url ? ` (${report.health.url})` : ""}${
			report.health.error ? ` - ${report.health.error}` : ""
		}\n`,
	)
	process.stdout.write(
		`Models: ${report.models.ok ? "ok" : "unavailable"}${report.models.url ? ` (${report.models.url})` : ""}${
			report.models.error ? ` - ${report.models.error}` : ""
		}\n`,
	)

	if (report.models.data?.modelIds.length) {
		for (const modelId of report.models.data.modelIds) {
			process.stdout.write(`  - ${modelId}\n`)
		}
	}

	process.stdout.write(
		`Metrics: ${report.metrics.ok ? "ok" : "unavailable"}${report.metrics.url ? ` (${report.metrics.url})` : ""}${
			report.metrics.error ? ` - ${report.metrics.error}` : ""
		}\n`,
	)

	if (report.metrics.data) {
		process.stdout.write(`  Raw metrics: ${report.metrics.data.rawMetricCount}\n`)
		process.stdout.write(`  OpenTelemetry namespace: gen_ai.local.*\n`)
	}

	if (report.hints.length) {
		process.stdout.write("Hints:\n")
		for (const hint of report.hints) {
			process.stdout.write(`  - ${hint}\n`)
		}
	}
}

function validateDoctorOptions(options: DoctorOptions): void {
	if (options.protocol && !isSupportedApiStandard(options.protocol)) {
		throw new Error(`Invalid protocol: ${options.protocol}; must be one of: ${supportedApiStandards.join(", ")}`)
	}

	if (options.runtime && !isSupportedLocalRuntime(options.runtime)) {
		throw new Error(`Invalid runtime: ${options.runtime}; must be one of: ${supportedLocalRuntimes.join(", ")}`)
	}
}

function resolveDoctorFormat(format: string | undefined): DoctorFormat {
	return parseDoctorFormat(format)
}

export async function doctor(
	options: DoctorOptions,
	deps: {
		collectRuntimeDoctorReport?: typeof collectRuntimeDoctorReport
	} = {},
): Promise<void> {
	validateDoctorOptions(options)

	const settings = await loadSettings()
	const runtime = resolveEffectiveRuntime(options.runtime, settings)
	if (!runtime) {
		throw new Error("Doctor requires --runtime or a saved local runtime profile.")
	}

	const protocol = resolveEffectiveProtocol(options.protocol, options.provider, settings)
	const provider = resolveEffectiveProvider(options.provider, settings, protocol, runtime)
	const baseUrl = resolveConfiguredBaseUrl(options.baseUrl, settings, protocol, runtime)

	if (!baseUrl) {
		throw new Error("Could not resolve a base URL for the selected local runtime.")
	}

	const apiKey = resolveConfiguredApiKey(provider, options.apiKey, settings, getApiKeyFromEnv(provider), baseUrl)
	const report = await (deps.collectRuntimeDoctorReport ?? collectRuntimeDoctorReport)({
		runtime,
		protocol,
		baseUrl,
		apiKey,
	})

	if (resolveDoctorFormat(options.format) === "json") {
		outputJson(report)
		return
	}

	outputText(report)
}
