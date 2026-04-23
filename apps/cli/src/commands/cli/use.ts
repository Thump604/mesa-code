import {
	activateOpsPreset,
	buildOpsControlPlaneSettingsPatch,
	isOpsControlPlaneAvailable,
	listOpsModelPresets,
	pollOpsReadiness,
	resolveOpsBaseUrl,
	type OpsModelPreset,
} from "@/lib/ops-control-plane.js"
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
import { buildModelUsePlan, type ModelUsePlan } from "@/runtime/model-plan.js"

type UseFormat = "json" | "text"

export type UseOptions = {
	apiKey?: string
	provider?: SupportedProvider
	protocol?: SupportedApiStandard
	runtime?: SupportedLocalRuntime
	baseUrl?: string
	model?: string
	preset?: string
	opsBaseUrl?: string
	format?: string
	plan?: boolean
	installRuntime?: boolean
	start?: boolean
	storageRoot?: string
	allowExternalStorage?: boolean
	waitSeconds?: string | number
}

type UseRuntimeDeps = {
	activateManagedRuntime?: typeof activateManagedRuntime
	activateOpsPreset?: typeof activateOpsPreset
	buildModelUsePlan?: typeof buildModelUsePlan
	isOpsControlPlaneAvailable?: typeof isOpsControlPlaneAvailable
	listOpsModelPresets?: typeof listOpsModelPresets
	pollOpsReadiness?: typeof pollOpsReadiness
	saveSettings?: typeof saveSettings
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
	if (result.controlPlane) {
		process.stdout.write(`Control Plane: ${result.controlPlane.kind} (${result.controlPlane.baseUrl})\n`)
	}
	if (result.activePreset) {
		process.stdout.write(`Active preset: ${result.activePreset.displayName ?? result.activePreset.id}\n`)
	}
	process.stdout.write(`Model: ${result.model}\n`)
	process.stdout.write(`State: ${result.state}\n`)

	if (result.executable) {
		process.stdout.write(`Executable: ${result.executable}\n`)
	}

	if (result.managedProcess) {
		process.stdout.write(`Managed PID: ${result.managedProcess.pid}\n`)
	}

	if (result.plan) {
		outputTextPlan(result.plan)
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

function outputTextPlan(plan: ModelUsePlan): void {
	process.stdout.write(`Source: ${plan.source.kind}\n`)
	if (plan.source.resolvedPath) {
		process.stdout.write(`Source Path: ${plan.source.resolvedPath}\n`)
	}
	process.stdout.write(`Download Required: ${plan.download.required ? "yes" : "no"}\n`)
	process.stdout.write(`Placement: ${plan.placement.status}\n`)
	process.stdout.write(`Placement Enforcement: ${plan.placement.enforcement}\n`)
	if (plan.placement.effectiveStorageRoot) {
		process.stdout.write(`Storage Root: ${plan.placement.effectiveStorageRoot}\n`)
	}
	if (plan.placement.targetPathHint) {
		process.stdout.write(`Target Path Hint: ${plan.placement.targetPathHint}\n`)
	}
	if (plan.placement.freeBytes !== undefined) {
		process.stdout.write(`Free Space (bytes): ${plan.placement.freeBytes}\n`)
	}
	process.stdout.write(`Likely External Storage: ${plan.placement.likelyExternal ? "yes" : "no"}\n`)
}

function validateUseOptions(targetArg: string | undefined, options: UseOptions): void {
	if (options.protocol && !isSupportedApiStandard(options.protocol)) {
		throw new Error(`Invalid protocol: ${options.protocol}; must be one of: ${supportedApiStandards.join(", ")}`)
	}

	if (options.runtime && !isSupportedLocalRuntime(options.runtime)) {
		throw new Error(`Invalid runtime: ${options.runtime}; must be one of: ${supportedLocalRuntimes.join(", ")}`)
	}

	if (options.preset && options.model) {
		throw new Error("Use either --preset or --model, not both.")
	}

	if (targetArg && (options.preset || options.model)) {
		throw new Error("Use either [target] or --preset/--model, not both.")
	}
}

function resolvePresetTarget(
	targetArg: string | undefined,
	options: UseOptions,
	presets: OpsModelPreset[],
): OpsModelPreset | undefined {
	const requestedPreset = options.preset ?? targetArg
	if (!requestedPreset) {
		return undefined
	}

	return presets.find((preset) => preset.id === requestedPreset)
}

function resolveModelTarget(targetArg: string | undefined, options: UseOptions): string | undefined {
	if (options.preset) {
		return undefined
	}

	return options.model ?? targetArg
}

function looksLikePresetAlias(target: string): boolean {
	if (target.includes("/")) return false
	if (/^[A-Za-z]:/.test(target)) return false
	if (target.endsWith(".gguf")) return false
	return true
}

export async function useRuntime(
	targetArg: string | undefined,
	options: UseOptions,
	deps: UseRuntimeDeps = {},
): Promise<void> {
	validateUseOptions(targetArg, options)

	const settings = await loadSettings()
	const runtime = resolveEffectiveRuntime(options.runtime ?? "vllm-mlx", settings)
	if (!runtime) {
		throw new Error("Use requires a local runtime selection.")
	}

	const protocol = resolveEffectiveProtocol(options.protocol, options.provider, settings)
	const provider = resolveEffectiveProvider(options.provider, settings, protocol, runtime)
	const baseUrl = resolveConfiguredBaseUrl(options.baseUrl, settings, protocol, runtime)

	if (!baseUrl) {
		throw new Error("Could not resolve a base URL for the selected local runtime.")
	}

	const opsBaseUrl = resolveOpsBaseUrl(options.opsBaseUrl, settings.opsBaseUrl)
	const opsAvailable = await (deps.isOpsControlPlaneAvailable ?? isOpsControlPlaneAvailable)(opsBaseUrl)
	const presets = opsAvailable ? await (deps.listOpsModelPresets ?? listOpsModelPresets)(opsBaseUrl) : []
	const requestedPreset = resolvePresetTarget(targetArg, options, presets)
	const requestedModel = requestedPreset
		? undefined
		: (resolveModelTarget(targetArg, options) ??
			resolveEffectiveModel(undefined, settings, provider, baseUrl, runtime))

	if (!requestedModel && !requestedPreset) {
		throw new Error("Use requires a preset alias, --model, or a saved model for the selected local runtime.")
	}

	if (targetArg && !options.model && !options.preset && !requestedPreset && looksLikePresetAlias(targetArg)) {
		if (!opsAvailable) {
			throw new Error(
				"Ops control plane is required to resolve preset aliases. " +
					"Use --model <HF repo or local path> for direct runtime bootstrap.",
			)
		}
		throw new Error(
			`"${targetArg}" is not a known preset. ` + "Use --model <HF repo or local path> for direct model targets.",
		)
	}

	if (requestedPreset && !opsAvailable) {
		throw new Error(
			`The ops control plane is required to activate preset ${requestedPreset.id}. Start ops at ${opsBaseUrl} or use --model for direct runtime bootstrap.`,
		)
	}

	if (requestedPreset) {
		const activatedPreset = await (deps.activateOpsPreset ?? activateOpsPreset)(opsBaseUrl, requestedPreset.id)

		const waitSeconds = parseWaitSeconds(options.waitSeconds)
		const readiness = await (deps.pollOpsReadiness ?? pollOpsReadiness)(opsBaseUrl, {
			presetId: requestedPreset.id,
			expectedModelId: requestedPreset.model_id ?? undefined,
			waitSeconds,
		})

		const isReady =
			readiness.ready &&
			readiness.preset.active === requestedPreset.id &&
			(!requestedPreset.model_id || readiness.preset.model_id === requestedPreset.model_id)

		const activeModel = readiness.preset.model_id ?? activatedPreset.model_id ?? requestedPreset.model_id ?? ""

		const hints: string[] = []
		if (!isReady && readiness.reason) {
			hints.push(`Runtime is not ready: ${readiness.reason}`)
		}

		const result: RuntimeUseResult = {
			runtime,
			protocol,
			provider,
			baseUrl,
			model: activeModel,
			state: isReady ? "ready" : "starting",
			controlPlane: {
				kind: "ops",
				baseUrl: opsBaseUrl,
			},
			activePreset: {
				id: readiness.preset.active ?? requestedPreset.id,
				displayName: readiness.preset.display_name ?? requestedPreset.display_name ?? requestedPreset.id,
			},
			actions: [
				{
					kind: isReady ? "verification-ready" : "verification-pending",
					description: isReady
						? `Preset ${requestedPreset.id} is active and the runtime is ready.`
						: `Activated preset ${requestedPreset.id}; runtime is not yet ready.`,
				},
			],
			hints,
		}

		await (deps.saveSettings ?? saveSettings)(
			buildOpsControlPlaneSettingsPatch({
				opsBaseUrl,
				presetId: requestedPreset.id,
				provider,
				protocol,
				runtime,
				baseUrl,
				model: activeModel,
				apiKey: resolveConfiguredApiKey(
					provider,
					options.apiKey,
					settings,
					getApiKeyFromEnv(provider),
					baseUrl,
				),
			}),
		)

		if (parseUseFormat(options.format) === "json") {
			outputJson(result)
			return
		}

		outputText(result)
		return
	}

	const model = requestedModel
	if (!model) {
		throw new Error("Use requires --model or a saved model for the selected local runtime.")
	}

	if (options.storageRoot && !options.plan) {
		throw new Error(
			"--storage-root is currently planning-only. Use `roo use --plan ... --storage-root <path>` until runtime-native placement support lands.",
		)
	}

	const apiKey = resolveConfiguredApiKey(provider, options.apiKey, settings, getApiKeyFromEnv(provider), baseUrl)
	const plan = await (deps.buildModelUsePlan ?? buildModelUsePlan)({
		runtime,
		model,
		storageRoot: options.storageRoot,
		allowExternalStorage: options.allowExternalStorage,
	})

	if (plan.source.kind === "local-path-missing") {
		throw new Error(`The requested local model path does not exist: ${plan.source.resolvedPath ?? model}`)
	}

	if (plan.placement.status === "blocked") {
		throw new Error(
			"The selected model source or storage root appears to be on external storage. Re-run with --allow-external-storage if that is intentional.",
		)
	}

	if (options.plan) {
		const result: RuntimeUseResult = {
			runtime,
			protocol,
			provider,
			baseUrl,
			model,
			state: "configured",
			plan,
			actions: [
				{
					kind: "settings-selected",
					description: `Planned ${runtime} lane for ${model}.`,
				},
			],
			hints: plan.warnings,
		}

		if (parseUseFormat(options.format) === "json") {
			outputJson(result)
			return
		}

		outputText(result)
		return
	}

	const result = await (deps.activateManagedRuntime ?? activateManagedRuntime)({
		runtime,
		protocol,
		provider,
		baseUrl,
		model,
		plan,
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
