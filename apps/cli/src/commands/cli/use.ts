import { loadSettings, saveSettings } from "@/lib/storage/index.js"
import { getApiKeyFromEnv } from "@/lib/utils/provider.js"
import {
	buildLocalRuntimeSettingsPatch,
	resolveConfiguredApiKey,
	resolveConfiguredBaseUrl,
	resolveEffectiveModel,
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
import { activateManagedRuntime, type RuntimeUseResult } from "@/runtime/runtime-manager.js"

type UseFormat = "json" | "text"

export type UseOptions = {
	apiKey?: string
	provider?: SupportedProvider
	protocol?: SupportedApiStandard
	runtime?: SupportedLocalRuntime
	baseUrl?: string
	model?: string
	format?: string
	installRuntime?: boolean
	start?: boolean
	waitSeconds?: string | number
}

function parseUseFormat(rawFormat: string | undefined): UseFormat {
	const format = (rawFormat ?? "text").toLowerCase()
	if (format === "json" || format === "text") {
		return format
	}

	throw new Error(`Invalid format: ${rawFormat}. Must be "json" or "text".`)
}

function parseWaitSeconds(rawWaitSeconds: string | number | undefined): number {
	if (rawWaitSeconds === undefined) {
		return 20
	}

	const parsed =
		typeof rawWaitSeconds === "number" ? rawWaitSeconds : Number.parseInt(String(rawWaitSeconds).trim(), 10)
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`Invalid wait time: ${rawWaitSeconds}. Must be a non-negative integer.`)
	}

	return parsed
}

function outputJson(data: unknown): void {
	process.stdout.write(JSON.stringify(data, null, 2) + "\n")
}

function outputText(result: RuntimeUseResult): void {
	process.stdout.write(`Runtime: ${result.runtime}\n`)
	process.stdout.write(`Protocol: ${result.protocol}\n`)
	process.stdout.write(`Base URL: ${result.baseUrl}\n`)
	process.stdout.write(`Model: ${result.model}\n`)
	process.stdout.write(`State: ${result.state}\n`)

	if (result.executable) {
		process.stdout.write(`Executable: ${result.executable}\n`)
	}

	if (result.managedProcess) {
		process.stdout.write(`Managed PID: ${result.managedProcess.pid}\n`)
	}

	if (result.actions.length) {
		process.stdout.write("Actions:\n")
		for (const action of result.actions) {
			process.stdout.write(`  - ${action.description}\n`)
		}
	}

	if (result.doctor) {
		process.stdout.write(
			`Health: ${result.doctor.health.ok ? "ok" : "pending"}${result.doctor.health.url ? ` (${result.doctor.health.url})` : ""}\n`,
		)
		if (result.doctor.models.data?.modelIds.length) {
			process.stdout.write(`Models: ${result.doctor.models.data.modelIds.join(", ")}\n`)
		}
	}

	if (result.hints.length) {
		process.stdout.write("Hints:\n")
		for (const hint of result.hints) {
			process.stdout.write(`  - ${hint}\n`)
		}
	}
}

function validateUseOptions(options: UseOptions): void {
	if (options.protocol && !isSupportedApiStandard(options.protocol)) {
		throw new Error(`Invalid protocol: ${options.protocol}; must be one of: ${supportedApiStandards.join(", ")}`)
	}

	if (options.runtime && !isSupportedLocalRuntime(options.runtime)) {
		throw new Error(`Invalid runtime: ${options.runtime}; must be one of: ${supportedLocalRuntimes.join(", ")}`)
	}
}

export async function useRuntime(
	options: UseOptions,
	deps: {
		activateManagedRuntime?: typeof activateManagedRuntime
		saveSettings?: typeof saveSettings
	} = {},
): Promise<void> {
	validateUseOptions(options)

	const settings = await loadSettings()
	const runtime = resolveEffectiveRuntime(options.runtime ?? "vllm-mlx", settings)
	if (!runtime) {
		throw new Error("Use requires a local runtime selection.")
	}

	const protocol = resolveEffectiveProtocol(options.protocol, options.provider, settings)
	const provider = resolveEffectiveProvider(options.provider, settings, protocol, runtime)
	const baseUrl = resolveConfiguredBaseUrl(options.baseUrl, settings, protocol, runtime)
	const model = resolveEffectiveModel(options.model, settings, provider, baseUrl, runtime)

	if (!baseUrl) {
		throw new Error("Could not resolve a base URL for the selected local runtime.")
	}

	if (!model) {
		throw new Error("Use requires --model or a saved model for the selected local runtime.")
	}

	const apiKey = resolveConfiguredApiKey(provider, options.apiKey, settings, getApiKeyFromEnv(provider), baseUrl)
	const result = await (deps.activateManagedRuntime ?? activateManagedRuntime)({
		runtime,
		protocol,
		provider,
		baseUrl,
		model,
		apiKey,
		installRuntime: options.installRuntime ?? true,
		startRuntime: options.start ?? true,
		waitSeconds: parseWaitSeconds(options.waitSeconds),
	})

	await (deps.saveSettings ?? saveSettings)(
		buildLocalRuntimeSettingsPatch({
			provider,
			protocol,
			runtime,
			baseUrl,
			model,
			apiKey,
		}),
	)

	if (parseUseFormat(options.format) === "json") {
		outputJson(result)
		return
	}

	outputText(result)
}
