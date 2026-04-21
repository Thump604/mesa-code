import {
	isLocalOpenAiBaseUrl,
	resolveConfiguredApiKey,
	resolveConfiguredBaseUrl,
	resolveEffectiveModel,
	resolveEffectiveProvider,
} from "../runtime-config.js"

describe("runtime-config", () => {
	describe("isLocalOpenAiBaseUrl", () => {
		it("detects local loopback endpoints", () => {
			expect(isLocalOpenAiBaseUrl("http://127.0.0.1:8080/v1")).toBe(true)
			expect(isLocalOpenAiBaseUrl("http://localhost:1234/v1")).toBe(true)
			expect(isLocalOpenAiBaseUrl("http://0.0.0.0:8000/v1")).toBe(true)
		})

		it("does not treat remote endpoints as local", () => {
			expect(isLocalOpenAiBaseUrl("https://api.openai.com/v1")).toBe(false)
			expect(isLocalOpenAiBaseUrl("https://example.com/v1")).toBe(false)
		})
	})

	describe("resolveEffectiveProvider", () => {
		it("prefers an explicit provider flag", () => {
			expect(
				resolveEffectiveProvider(
					"anthropic",
					{ provider: "openai", openAiBaseUrl: "http://localhost:8080/v1" },
					true,
				),
			).toBe("anthropic")
		})

		it("prefers configured local openai-compatible settings when no provider is set", () => {
			expect(resolveEffectiveProvider(undefined, { openAiBaseUrl: "http://localhost:8080/v1" }, true)).toBe(
				"openai",
			)
		})

		it("falls back to roo only when no local/private config is present", () => {
			expect(resolveEffectiveProvider(undefined, {}, true)).toBe("roo")
			expect(resolveEffectiveProvider(undefined, {}, false)).toBe("openrouter")
		})
	})

	describe("resolveConfiguredBaseUrl", () => {
		it("prefers an explicit base URL over settings", () => {
			expect(
				resolveConfiguredBaseUrl("http://127.0.0.1:8080/v1", { openAiBaseUrl: "http://localhost:1234/v1" }),
			).toBe("http://127.0.0.1:8080/v1")
		})

		it("reads legacy imported openai-compatible settings", () => {
			expect(resolveConfiguredBaseUrl(undefined, { openAiBaseUrl: "http://localhost:1234/v1" })).toBe(
				"http://localhost:1234/v1",
			)
		})
	})

	describe("resolveEffectiveModel", () => {
		it("uses legacy openai-compatible model settings for the openai provider", () => {
			expect(
				resolveEffectiveModel(undefined, { openAiModelId: "qwen3.5-27b", model: "ignored-model" }, "openai"),
			).toBe("qwen3.5-27b")
		})

		it("falls back to the generic configured model for non-openai providers", () => {
			expect(resolveEffectiveModel(undefined, { model: "claude-sonnet" }, "anthropic")).toBe("claude-sonnet")
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

		it("uses provider env keys for non-openai providers", () => {
			expect(resolveConfiguredApiKey("anthropic", undefined, {}, "test-key", undefined)).toBe("test-key")
		})
	})
})
