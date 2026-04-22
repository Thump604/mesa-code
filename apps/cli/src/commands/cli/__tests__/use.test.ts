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
			executable: "/usr/local/bin/vllm-mlx",
			actions: [{ kind: "managed-process-started", description: "Started managed vllm-mlx process 4242." }],
			hints: [],
		})

		const output = await captureStdout(() =>
			useRuntime(
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
			apiKey: "not-needed",
			installRuntime: true,
			startRuntime: true,
			waitSeconds: 20,
		})
		expect(saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({
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
		expect(output).toContain("Runtime: vllm-mlx")
		expect(output).toContain("State: ready")
	})

	it("supports configuration-only llama.cpp profiles", async () => {
		const activateManagedRuntime = vi.fn().mockResolvedValue({
			runtime: "llama.cpp",
			protocol: "anthropic",
			provider: "anthropic",
			baseUrl: "http://127.0.0.1:8081",
			model: "/models/coder.gguf",
			state: "configured",
			actions: [{ kind: "settings-selected", description: "Selected llama.cpp as the local runtime lane." }],
			hints: ["Automatic llama.cpp bootstrap is not implemented yet."],
		})

		const output = await captureStdout(() =>
			useRuntime(
				{
					runtime: "llama.cpp",
					protocol: "anthropic",
					baseUrl: "http://127.0.0.1:8081",
					model: "/models/coder.gguf",
					start: false,
				},
				{
					activateManagedRuntime,
					saveSettings,
				},
			),
		)

		expect(saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({
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
})
