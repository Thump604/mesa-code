import { loadSettings, saveSettings } from "@/lib/storage/index.js"

import { useRuntime } from "../use.js"

vi.mock("@/lib/storage/index.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/storage/index.js")>()
	return {
		...actual,
		loadSettings: vi.fn().mockResolvedValue({}),
		saveSettings: vi.fn().mockResolvedValue(undefined),
	}
})

vi.mock("@/lib/utils/provider.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/utils/provider.js")>()
	return {
		...actual,
		getApiKeyFromEnv: vi.fn(() => undefined),
	}
})

describe("useRuntime", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(loadSettings).mockResolvedValue({})
	})

	const captureStdout = async (fn: () => Promise<void>): Promise<string> => {
		const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)

		try {
			await fn()
			return stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("")
		} finally {
			stdoutSpy.mockRestore()
		}
	}

	it("boots the default vllm-mlx lane and persists local runtime settings", async () => {
		const activateManagedRuntime = vi.fn().mockResolvedValue({
			runtime: "vllm-mlx",
			protocol: "openai",
			provider: "openai",
			baseUrl: "http://127.0.0.1:8080/v1",
			model: "mlx-community/Qwen3-4B-4bit",
			state: "ready",
			controlPlane: {
				kind: "direct-runtime-bootstrap",
				baseUrl: "http://127.0.0.1:8080/v1",
			},
			plan: {
				source: { kind: "huggingface-hub", input: "mlx-community/Qwen3-4B-4bit" },
				download: { required: true, controllableByCli: false },
				placement: {
					status: "accepted",
					enforcement: "runtime-default-cache",
					allowExternalStorage: false,
					likelyExternal: false,
				},
				warnings: [],
			},
			executable: "/usr/local/bin/vllm-mlx",
			actions: [{ kind: "managed-process-started", description: "Started managed vllm-mlx process 4242." }],
			hints: [],
		})

		const output = await captureStdout(() =>
			useRuntime(
				undefined,
				{
					model: "mlx-community/Qwen3-4B-4bit",
				},
				{
					activateManagedRuntime,
					saveSettings,
				},
			),
		)

		expect(activateManagedRuntime).toHaveBeenCalledWith({
			runtime: "vllm-mlx",
			protocol: "openai",
			provider: "openai",
			baseUrl: "http://127.0.0.1:8080/v1",
			model: "mlx-community/Qwen3-4B-4bit",
			plan: expect.objectContaining({
				source: expect.objectContaining({
					kind: "huggingface-hub",
				}),
				placement: expect.objectContaining({
					enforcement: "runtime-default-cache",
				}),
			}),
			apiKey: "not-needed",
			installRuntime: true,
			startRuntime: true,
			waitSeconds: 20,
		})
		expect(saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				controlPlane: "direct-runtime",
				runtime: "vllm-mlx",
				protocol: "openai",
				provider: "openai",
				baseUrl: "http://127.0.0.1:8080/v1",
				model: "mlx-community/Qwen3-4B-4bit",
				openAiBaseUrl: "http://127.0.0.1:8080/v1",
				openAiModelId: "mlx-community/Qwen3-4B-4bit",
				apiKey: undefined,
			}),
		)
		expect(output).toContain("Control Plane: direct-runtime-bootstrap (http://127.0.0.1:8080/v1)")
		expect(output).toContain("Runtime: vllm-mlx")
		expect(output).toContain("State: ready")
		expect(output).toContain("Source: huggingface-hub")
	})

	it("prefers preset activation through the ops control plane when available", async () => {
		const activateManagedRuntime = vi.fn()
		const activateOpsPreset = vi.fn().mockResolvedValue({
			activated: "fast-qwen",
			model_id: "qwen3.5-35b-a3b",
		})
		const getOpsModeContract = vi.fn().mockResolvedValue({
			active_preset: "fast-qwen",
			active_preset_display_name: "Fast Qwen (MoE)",
			active_model_id: "qwen3.5-35b-a3b",
		})
		const isOpsControlPlaneAvailable = vi.fn().mockResolvedValue(true)
		const listOpsModelPresets = vi.fn().mockResolvedValue([
			{
				id: "fast-qwen",
				display_name: "Fast Qwen (MoE)",
				model_id: "qwen3.5-35b-a3b",
			},
		])

		const output = await captureStdout(() =>
			useRuntime(
				"fast-qwen",
				{},
				{
					activateManagedRuntime,
					activateOpsPreset,
					getOpsModeContract,
					isOpsControlPlaneAvailable,
					listOpsModelPresets,
					saveSettings,
				},
			),
		)

		expect(activateManagedRuntime).not.toHaveBeenCalled()
		expect(activateOpsPreset).toHaveBeenCalledWith("http://127.0.0.1:8001", "fast-qwen")
		expect(saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				controlPlane: "ops",
				opsBaseUrl: "http://127.0.0.1:8001",
				activePresetId: "fast-qwen",
				runtime: "vllm-mlx",
				protocol: "openai",
				provider: "openai",
				baseUrl: "http://127.0.0.1:8080/v1",
				model: "qwen3.5-35b-a3b",
				openAiModelId: "qwen3.5-35b-a3b",
			}),
		)
		expect(output).toContain("Control Plane: ops (http://127.0.0.1:8001)")
		expect(output).toContain("Active preset: Fast Qwen (MoE)")
		expect(output).toContain("State: starting")
	})

	it("supports configuration-only llama.cpp profiles", async () => {
		const activateManagedRuntime = vi.fn().mockResolvedValue({
			runtime: "llama.cpp",
			protocol: "anthropic",
			provider: "anthropic",
			baseUrl: "http://127.0.0.1:8081",
			model: "/models/coder.gguf",
			state: "configured",
			controlPlane: {
				kind: "direct-runtime-bootstrap",
				baseUrl: "http://127.0.0.1:8081",
			},
			actions: [{ kind: "settings-selected", description: "Selected llama.cpp as the local runtime lane." }],
			hints: ["Automatic llama.cpp bootstrap is not implemented yet."],
		})
		const buildModelUsePlan = vi.fn().mockResolvedValue({
			source: {
				kind: "local-path",
				input: "/models/coder.gguf",
				resolvedPath: "/models/coder.gguf",
				exists: true,
			},
			download: { required: false, controllableByCli: false },
			placement: {
				status: "accepted",
				enforcement: "not-applicable",
				allowExternalStorage: false,
				likelyExternal: false,
				effectiveStorageRoot: "/models",
				targetPathHint: "/models/coder.gguf",
			},
			warnings: [],
		})

		const output = await captureStdout(() =>
			useRuntime(
				undefined,
				{
					runtime: "llama.cpp",
					protocol: "anthropic",
					baseUrl: "http://127.0.0.1:8081",
					model: "/models/coder.gguf",
					start: false,
				},
				{
					activateManagedRuntime,
					buildModelUsePlan,
					saveSettings,
				},
			),
		)

		expect(saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				controlPlane: "direct-runtime",
				runtime: "llama.cpp",
				protocol: "anthropic",
				provider: "anthropic",
				baseUrl: "http://127.0.0.1:8081",
				model: "/models/coder.gguf",
				anthropicBaseUrl: "http://127.0.0.1:8081",
			}),
		)
		expect(output).toContain("Runtime: llama.cpp")
		expect(output).toContain("State: configured")
	})

	it("supports planning without mutating settings or launching runtime", async () => {
		const activateManagedRuntime = vi.fn()
		const buildModelUsePlan = vi.fn().mockResolvedValue({
			source: { kind: "huggingface-hub", input: "Qwen/Qwen3.6-35B-A3B" },
			download: { required: true, controllableByCli: false },
			placement: {
				status: "accepted",
				enforcement: "planned-only",
				allowExternalStorage: false,
				likelyExternal: false,
				effectiveStorageRoot: "/Users/david/ai-models",
				targetPathHint: "/Users/david/ai-models/vllm-mlx/Qwen--Qwen3.6-35B-A3B",
			},
			warnings: [
				"Explicit storage-root planning exists, but live execution still depends on runtime-native placement support.",
			],
		})

		const output = await captureStdout(() =>
			useRuntime(
				undefined,
				{
					runtime: "vllm-mlx",
					model: "Qwen/Qwen3.6-35B-A3B",
					plan: true,
					storageRoot: "/Users/david/ai-models",
				},
				{
					activateManagedRuntime,
					buildModelUsePlan,
					saveSettings,
				},
			),
		)

		expect(activateManagedRuntime).not.toHaveBeenCalled()
		expect(saveSettings).not.toHaveBeenCalled()
		expect(output).toContain("Placement Enforcement: planned-only")
		expect(output).toContain("Storage Root: /Users/david/ai-models")
	})

	it("rejects storage-root in live execution until runtime placement support exists", async () => {
		await expect(
			useRuntime(
				undefined,
				{
					runtime: "vllm-mlx",
					model: "Qwen/Qwen3.6-35B-A3B",
					storageRoot: "/Users/david/ai-models",
				},
				{
					activateManagedRuntime: vi.fn(),
					saveSettings,
				},
			),
		).rejects.toThrow("--storage-root is currently planning-only")
	})
})
