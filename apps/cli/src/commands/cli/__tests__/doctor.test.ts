import { loadSettings } from "@/lib/storage/index.js"

import { doctor } from "../doctor.js"

vi.mock("@/lib/storage/index.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/storage/index.js")>()
	return {
		...actual,
		loadSettings: vi.fn().mockResolvedValue({}),
	}
})

vi.mock("@/lib/utils/provider.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/utils/provider.js")>()
	return {
		...actual,
		getApiKeyFromEnv: vi.fn(() => undefined),
	}
})

describe("doctor", () => {
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

	it("prints a text doctor report for local runtime profiles", async () => {
		const collectRuntimeDoctorReport = vi.fn().mockResolvedValue({
			runtime: "vllm-mlx",
			runtimeClass: "local-inference-engine",
			protocol: "openai",
			baseUrl: "http://127.0.0.1:8080/v1",
			modelClass: "openai-compatible",
			health: { ok: true, attempts: [], url: "http://127.0.0.1:8080/health" },
			models: {
				ok: true,
				attempts: [],
				url: "http://127.0.0.1:8080/v1/models",
				data: { modelIds: ["qwen3-coder"] },
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
			hints: ["The metrics payload is normalized into an OpenTelemetry-aligned namespace under gen_ai.local.*."],
		})

		const output = await captureStdout(() =>
			doctor(
				{
					runtime: "vllm-mlx",
				},
				{ collectRuntimeDoctorReport },
			),
		)

		expect(collectRuntimeDoctorReport).toHaveBeenCalledWith({
			runtime: "vllm-mlx",
			protocol: "openai",
			baseUrl: "http://127.0.0.1:8080/v1",
			apiKey: "not-needed",
		})
		expect(output).toContain("Runtime: vllm-mlx")
		expect(output).toContain("OpenTelemetry namespace: gen_ai.local.*")
		expect(output).toContain("qwen3-coder")
	})

	it("prints a JSON doctor report when requested", async () => {
		const collectRuntimeDoctorReport = vi.fn().mockResolvedValue({
			runtime: "llama.cpp",
			runtimeClass: "local-inference-engine",
			protocol: "anthropic",
			baseUrl: "http://127.0.0.1:8081",
			modelClass: "anthropic-compatible",
			health: { ok: false, attempts: [], error: "connection refused" },
			models: { ok: false, attempts: [], error: "connection refused" },
			metrics: { ok: false, attempts: [], error: "connection refused" },
			hints: ["No llama.cpp health endpoint responded. Start the local server and re-run roo doctor."],
		})

		const output = await captureStdout(() =>
			doctor(
				{
					runtime: "llama.cpp",
					protocol: "anthropic",
					format: "json",
				},
				{ collectRuntimeDoctorReport },
			),
		)

		expect(JSON.parse(output)).toMatchObject({
			runtime: "llama.cpp",
			protocol: "anthropic",
			baseUrl: "http://127.0.0.1:8081",
		})
	})
})
