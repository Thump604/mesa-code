import type { RuntimeDoctorReport } from "../observability.js"

import { activateManagedRuntime } from "../runtime-manager.js"

function createDoctorReport(overrides: Partial<RuntimeDoctorReport> = {}): RuntimeDoctorReport {
	return {
		runtime: "vllm-mlx",
		runtimeClass: "local-inference-engine",
		protocol: "openai",
		baseUrl: "http://127.0.0.1:8080/v1",
		modelClass: "openai-compatible",
		health: {
			ok: true,
			attempts: [],
			url: "http://127.0.0.1:8080/health",
		},
		models: {
			ok: true,
			attempts: [],
			url: "http://127.0.0.1:8080/v1/models",
			data: {
				modelIds: ["default"],
			},
		},
		metrics: {
			ok: true,
			attempts: [],
			url: "http://127.0.0.1:8080/metrics",
			data: {
				rawMetricCount: 2,
				openTelemetryMetrics: [],
				resourceAttributes: {},
			},
		},
		hints: [],
		...overrides,
	}
}

describe("activateManagedRuntime", () => {
	it("starts a managed vllm-mlx process and records runtime state", async () => {
		const setManagedRuntimeProcess = vi.fn()
		const spawnDetached = vi.fn().mockResolvedValue({ pid: 4242 })
		const collectRuntimeDoctorReport = vi.fn().mockResolvedValue(createDoctorReport())

		const result = await activateManagedRuntime(
			{
				runtime: "vllm-mlx",
				protocol: "openai",
				provider: "openai",
				baseUrl: "http://127.0.0.1:8080/v1",
				model: "mlx-community/Qwen3-4B-4bit",
				apiKey: "not-needed",
				startRuntime: true,
				waitSeconds: 1,
			},
			{
				resolveExecutable: vi.fn().mockResolvedValue({
					command: "vllm-mlx",
					path: "/usr/local/bin/vllm-mlx",
				}),
				loadRuntimeState: vi.fn().mockResolvedValue({}),
				setManagedRuntimeProcess,
				ensureRuntimeLogsDir: vi.fn().mockResolvedValue("/tmp/roo-runtime-logs"),
				spawnDetached,
				collectRuntimeDoctorReport,
				isPidRunning: vi.fn().mockReturnValue(true),
				stopPid: vi.fn(),
				exec: vi.fn(),
			},
		)

		expect(spawnDetached).toHaveBeenCalledWith(
			"/usr/local/bin/vllm-mlx",
			expect.arrayContaining(["serve", "mlx-community/Qwen3-4B-4bit", "--host", "127.0.0.1", "--port", "8080"]),
			expect.objectContaining({
				logPath: expect.stringContaining("/tmp/roo-runtime-logs/vllm-mlx-"),
			}),
		)
		expect(setManagedRuntimeProcess).toHaveBeenCalledWith(
			"vllm-mlx",
			expect.objectContaining({
				pid: 4242,
				model: "mlx-community/Qwen3-4B-4bit",
				baseUrl: "http://127.0.0.1:8080/v1",
			}),
		)
		expect(result.state).toBe("ready")
		expect(result.managedProcess?.pid).toBe(4242)
		expect(result.hints).toContain(
			"If the model is not cached locally yet, the runtime may still be downloading it from Hugging Face.",
		)
	})

	it("reuses the managed process when the same model is already active", async () => {
		const collectRuntimeDoctorReport = vi.fn().mockResolvedValue(createDoctorReport())
		const result = await activateManagedRuntime(
			{
				runtime: "vllm-mlx",
				protocol: "openai",
				provider: "openai",
				baseUrl: "http://127.0.0.1:8080/v1",
				model: "mlx-community/Qwen3-4B-4bit",
				apiKey: "not-needed",
				startRuntime: true,
				waitSeconds: 1,
			},
			{
				resolveExecutable: vi.fn().mockResolvedValue({
					command: "vllm-mlx",
					path: "/usr/local/bin/vllm-mlx",
				}),
				loadRuntimeState: vi.fn().mockResolvedValue({
					managedProcesses: {
						"vllm-mlx": {
							pid: 5150,
							command: "vllm-mlx serve mlx-community/Qwen3-4B-4bit",
							executablePath: "/usr/local/bin/vllm-mlx",
							baseUrl: "http://127.0.0.1:8080/v1",
							model: "mlx-community/Qwen3-4B-4bit",
							protocol: "openai",
							logPath: "/tmp/runtime.log",
							startedAt: new Date().toISOString(),
						},
					},
				}),
				setManagedRuntimeProcess: vi.fn(),
				ensureRuntimeLogsDir: vi.fn(),
				spawnDetached: vi.fn(),
				collectRuntimeDoctorReport,
				isPidRunning: vi.fn().mockReturnValue(true),
				stopPid: vi.fn(),
				exec: vi.fn(),
			},
		)

		expect(result.state).toBe("ready")
		expect(result.managedProcess?.pid).toBe(5150)
		expect(result.actions.map((action) => action.kind)).toContain("managed-process-reused")
	})

	it("installs vllm-mlx via uv when the runtime binary is missing", async () => {
		const resolveExecutable = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({ command: "uv", path: "/usr/local/bin/uv" })
			.mockResolvedValueOnce({ command: "vllm-mlx", path: "/usr/local/bin/vllm-mlx" })

		const result = await activateManagedRuntime(
			{
				runtime: "vllm-mlx",
				protocol: "openai",
				provider: "openai",
				baseUrl: "http://127.0.0.1:8080/v1",
				model: "mlx-community/Qwen3-4B-4bit",
				apiKey: "not-needed",
				startRuntime: false,
			},
			{
				resolveExecutable,
				exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
				loadRuntimeState: vi.fn().mockResolvedValue({}),
				setManagedRuntimeProcess: vi.fn(),
				ensureRuntimeLogsDir: vi.fn(),
				spawnDetached: vi.fn(),
				collectRuntimeDoctorReport: vi.fn(),
				isPidRunning: vi.fn().mockReturnValue(false),
				stopPid: vi.fn(),
			},
		)

		expect(result.actions.map((action) => action.kind)).toContain("runtime-installed")
		expect(result.state).toBe("configured")
	})
})
