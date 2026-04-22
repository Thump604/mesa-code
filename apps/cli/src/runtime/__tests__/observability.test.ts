import { collectRuntimeDoctorReport } from "../observability.js"

function createTextResponse(
	bodyText: string,
	init: { ok?: boolean; status?: number; contentType?: string } = {},
): Response {
	const { ok = true, status = 200, contentType = "text/plain; version=0.0.4" } = init
	return {
		ok,
		status,
		text: async () => bodyText,
		headers: {
			get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null),
		},
	} as Response
}

describe("collectRuntimeDoctorReport", () => {
	it("normalizes health, model discovery, and Prometheus metrics for vllm-mlx", async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			if (url.endsWith("/health")) {
				return createTextResponse("ok")
			}
			if (url.endsWith("/models")) {
				return createTextResponse(JSON.stringify({ data: [{ id: "qwen3-coder" }] }), {
					contentType: "application/json",
				})
			}
			if (url.endsWith("/metrics")) {
				return createTextResponse(
					[
						"# HELP vllm:num_requests_running Number of running requests",
						"# TYPE vllm:num_requests_running gauge",
						"vllm:num_requests_running 2",
						"# HELP vllm:e2e_request_latency_seconds End to end latency",
						"# TYPE vllm:e2e_request_latency_seconds histogram",
						"vllm:e2e_request_latency_seconds_sum 1.5",
						"vllm:e2e_request_latency_seconds_count 3",
					].join("\n"),
				)
			}

			return createTextResponse("not found", { ok: false, status: 404 })
		}) as typeof fetch

		const report = await collectRuntimeDoctorReport(
			{
				runtime: "vllm-mlx",
				protocol: "openai",
				baseUrl: "http://127.0.0.1:8080/v1",
			},
			{ fetchImpl },
		)

		expect(report.health.ok).toBe(true)
		expect(report.models.data?.modelIds).toEqual(["qwen3-coder"])
		expect(report.metrics.ok).toBe(true)
		expect(report.metrics.data?.openTelemetryMetrics.map((metric) => metric.semanticName)).toEqual(
			expect.arrayContaining([
				"gen_ai.local.vllm_mlx.vllm_num_requests_running",
				"gen_ai.local.vllm_mlx.vllm_e2e_request_latency_seconds_sum",
			]),
		)
		expect(report.hints).toContain(
			"The metrics payload is normalized into an OpenTelemetry-aligned namespace under gen_ai.local.*.",
		)
	})

	it("surfaces missing metrics and model discovery as actionable hints", async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			if (url.endsWith("/health")) {
				return createTextResponse("ok")
			}
			return createTextResponse("not found", { ok: false, status: 404 })
		}) as typeof fetch

		const report = await collectRuntimeDoctorReport(
			{
				runtime: "llama.cpp",
				protocol: "anthropic",
				baseUrl: "http://127.0.0.1:8081",
			},
			{ fetchImpl },
		)

		expect(report.health.ok).toBe(true)
		expect(report.models.ok).toBe(false)
		expect(report.metrics.ok).toBe(false)
		expect(report.hints).toEqual(
			expect.arrayContaining([
				"The runtime is up, but model discovery did not succeed. You may need to supply model IDs manually.",
				"Expose a Prometheus-compatible /metrics endpoint to unify observability across local runtimes.",
			]),
		)
	})
})
