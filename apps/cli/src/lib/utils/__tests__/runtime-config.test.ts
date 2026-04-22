import {
	buildLocalRuntimeSettingsPatch,
	isLocalBaseUrl,
	isLocalOpenAiBaseUrl,
	resolveConfiguredApiKey,
	resolveConfiguredBaseUrl,
	resolveEffectiveModel,
	resolveEffectiveProtocol,
	resolveEffectiveProvider,
	resolveEffectiveRuntime,
} from "../runtime-config.js"

describe("runtime-config", () => {
	describe("isLocalBaseUrl", () => {
		it("detects local loopback endpoints", () => {
			expect(isLocalBaseUrl("http://127.0.0.1:8080/v1")).toBe(true)
			expect(isLocalOpenAiBaseUrl("http://127.0.0.1:8080/v1")).toBe(true)
			expect(isLocalOpenAiBaseUrl("http://localhost:1234/v1")).toBe(true)
			expect(isLocalOpenAiBaseUrl("http://0.0.0.0:8000/v1")).toBe(true)
		})

		it("does not treat remote endpoints as local", () => {
			expect(isLocalOpenAiBaseUrl("https://api.openai.com/v1")).toBe(false)
			expect(isLocalOpenAiBaseUrl("https://example.com/v1")).toBe(false)
		})
	})

	describe("resolveEffectiveProtocol", () => {
		it("prefers explicit provider over protocol settings", () => {
			expect(resolveEffectiveProtocol("openai", "anthropic", { protocol: "openai" })).toBe("anthropic")
		})

		it("falls back to saved protocol when no provider is set", () => {
			expect(resolveEffectiveProtocol(undefined, undefined, { protocol: "anthropic" })).toBe("anthropic")
		})
	})

	describe("resolveEffectiveRuntime", () => {
		it("prefers explicit runtime over saved runtime", () => {
			expect(resolveEffectiveRuntime("vllm-mlx", { runtime: "llama.cpp" })).toBe("vllm-mlx")
		})

		it("uses saved runtime when no runtime flag is set", () => {
			expect(resolveEffectiveRuntime(undefined, { runtime: "llama.cpp" })).toBe("llama.cpp")
		})
	})

	describe("resolveEffectiveProvider", () => {
		it("prefers an explicit provider flag", () => {
			expect(
				resolveEffectiveProvider(
					"anthropic",
					{ provider: "openai", openAiBaseUrl: "http://localhost:8080/v1" },
					"openai",
					undefined,
				),
			).toBe("anthropic")
		})

		it("prefers configured local openai-compatible settings when no provider is set", () => {
			expect(
				resolveEffectiveProvider(undefined, { openAiBaseUrl: "http://localhost:8080/v1" }, "openai", undefined),
			).toBe("openai")
		})

		it("uses the selected anthropic-compatible protocol for local runtimes", () => {
			expect(resolveEffectiveProvider(undefined, { runtime: "vllm-mlx" }, "anthropic", "vllm-mlx")).toBe(
				"anthropic",
			)
		})

		it("ignores legacy roo provider settings and defaults to the local openai contract", () => {
			expect(resolveEffectiveProvider(undefined, { provider: "roo" }, "openai", undefined)).toBe("openai")
		})

		it("defaults to the local protocol when no explicit provider is set", () => {
			expect(resolveEffectiveProvider(undefined, {}, "openai", undefined)).toBe("openai")
			expect(resolveEffectiveProvider(undefined, {}, "anthropic", undefined)).toBe("anthropic")
		})
	})

	describe("resolveConfiguredBaseUrl", () => {
		it("prefers an explicit base URL over settings", () => {
			expect(
				resolveConfiguredBaseUrl(
					"http://127.0.0.1:8080/v1",
					{ openAiBaseUrl: "http://localhost:1234/v1" },
					"openai",
				),
			).toBe("http://127.0.0.1:8080/v1")
		})

		it("reads legacy imported openai-compatible settings", () => {
			expect(resolveConfiguredBaseUrl(undefined, { openAiBaseUrl: "http://localhost:1234/v1" }, "openai")).toBe(
				"http://localhost:1234/v1",
			)
		})

		it("reads explicit anthropic-compatible settings", () => {
			expect(
				resolveConfiguredBaseUrl(undefined, { anthropicBaseUrl: "http://localhost:8081" }, "anthropic"),
			).toBe("http://localhost:8081")
		})

		it("defaults runtime profiles to local loopback endpoints", () => {
			expect(resolveConfiguredBaseUrl(undefined, {}, "openai", "vllm-mlx")).toBe("http://127.0.0.1:8080/v1")
			expect(resolveConfiguredBaseUrl(undefined, {}, "anthropic", "llama.cpp")).toBe("http://127.0.0.1:8081")
		})
	})

	describe("resolveEffectiveModel", () => {
		it("uses legacy openai-compatible model settings for the openai provider", () => {
			expect(
				resolveEffectiveModel(
					undefined,
					{ openAiModelId: "qwen3.6-27b", model: "ignored-model" },
					"openai",
					"http://127.0.0.1:8080/v1",
					"vllm-mlx",
				),
			).toBe("qwen3.6-27b")
		})

		it("falls back to the generic configured model for non-openai providers", () => {
			expect(
				resolveEffectiveModel(
					undefined,
					{ model: "claude-sonnet" },
					"anthropic",
					"http://localhost:8081",
					"llama.cpp",
				),
			).toBe("claude-sonnet")
		})

		it("does not reuse the hosted default model for local runtime profiles", () => {
			expect(
				resolveEffectiveModel(
					"anthropic/claude-opus-4.6",
					{},
					"openai",
					"http://127.0.0.1:8080/v1",
					"vllm-mlx",
				),
			).toBe("")
		})
	})

	describe("resolveConfiguredApiKey", () => {
		it("uses a local placeholder for loopback OpenAI-compatible endpoints when no key is configured", () => {
			expect(resolveConfiguredApiKey("openai", undefined, {}, undefined, "http://127.0.0.1:8080/v1")).toBe(
				"not-needed",
			)
		})

		it("prefers imported openai-compatible API key settings", () => {
			expect(
				resolveConfiguredApiKey(
					"openai",
					undefined,
					{ openAiApiKey: "sk-local" },
					undefined,
					"http://127.0.0.1:8080/v1",
				),
			).toBe("sk-local")
		})

		it("uses a local placeholder for loopback Anthropic-compatible endpoints when no key is configured", () => {
			expect(resolveConfiguredApiKey("anthropic", undefined, {}, undefined, "http://127.0.0.1:8081")).toBe(
				"not-needed",
			)
		})

		it("uses provider env keys for non-openai providers", () => {
			expect(resolveConfiguredApiKey("anthropic", undefined, {}, "test-key", undefined)).toBe("test-key")
		})
	})

	describe("buildLocalRuntimeSettingsPatch", () => {
		it("persists openai-compatible local runtime settings without placeholder keys", () => {
			expect(
				buildLocalRuntimeSettingsPatch({
					provider: "openai",
					protocol: "openai",
					runtime: "vllm-mlx",
					baseUrl: "http://127.0.0.1:8080/v1",
					model: "mlx-community/Qwen3-4B-4bit",
					apiKey: "not-needed",
				}),
			).toEqual({
				controlPlane: "direct-runtime",
				opsBaseUrl: undefined,
				activePresetId: undefined,
				provider: "openai",
				protocol: "openai",
				runtime: "vllm-mlx",
				baseUrl: "http://127.0.0.1:8080/v1",
				model: "mlx-community/Qwen3-4B-4bit",
				apiKey: undefined,
				openAiBaseUrl: "http://127.0.0.1:8080/v1",
				openAiModelId: "mlx-community/Qwen3-4B-4bit",
				openAiApiKey: undefined,
			})
		})

		it("persists anthropic-compatible runtime settings", () => {
			expect(
				buildLocalRuntimeSettingsPatch({
					provider: "anthropic",
					protocol: "anthropic",
					runtime: "llama.cpp",
					baseUrl: "http://127.0.0.1:8081",
					model: "/models/coder.gguf",
					apiKey: "test-key",
				}),
			).toEqual({
				controlPlane: "direct-runtime",
				opsBaseUrl: undefined,
				activePresetId: undefined,
				provider: "anthropic",
				protocol: "anthropic",
				runtime: "llama.cpp",
				baseUrl: "http://127.0.0.1:8081",
				model: "/models/coder.gguf",
				apiKey: "test-key",
				anthropicBaseUrl: "http://127.0.0.1:8081",
			})
		})
	})
})
