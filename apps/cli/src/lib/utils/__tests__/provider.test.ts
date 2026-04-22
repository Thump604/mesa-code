import { getApiKeyFromEnv, getProviderSettings } from "../provider.js"

describe("getApiKeyFromEnv", () => {
	const originalEnv = process.env

	beforeEach(() => {
		// Reset process.env before each test.
		process.env = { ...originalEnv }
	})

	afterEach(() => {
		process.env = originalEnv
	})

	it("should return API key from environment variable for anthropic", () => {
		process.env.ANTHROPIC_API_KEY = "test-anthropic-key"
		expect(getApiKeyFromEnv("anthropic")).toBe("test-anthropic-key")
	})

	it("should return API key from environment variable for openrouter", () => {
		process.env.OPENROUTER_API_KEY = "test-openrouter-key"
		expect(getApiKeyFromEnv("openrouter")).toBe("test-openrouter-key")
	})

	it("should return API key from environment variable for openai", () => {
		process.env.OPENAI_API_KEY = "test-openai-key"
		expect(getApiKeyFromEnv("openai")).toBe("test-openai-key")
		expect(getApiKeyFromEnv("openai-native")).toBe("test-openai-key")
	})

	it("should return undefined when API key is not set", () => {
		delete process.env.ANTHROPIC_API_KEY
		expect(getApiKeyFromEnv("anthropic")).toBeUndefined()
	})
})

describe("getProviderSettings", () => {
	it("maps openai-compatible settings correctly", () => {
		expect(
			getProviderSettings("openai", "sk-local", "qwen3.6-27b", { baseUrl: "http://127.0.0.1:8080/v1" }),
		).toMatchObject({
			apiProvider: "openai",
			openAiApiKey: "sk-local",
			openAiModelId: "qwen3.6-27b",
			openAiBaseUrl: "http://127.0.0.1:8080/v1",
		})
	})

	it("maps anthropic-compatible settings correctly", () => {
		expect(
			getProviderSettings("anthropic", "sk-local", "claude-local", { baseUrl: "http://127.0.0.1:8081" }),
		).toMatchObject({
			apiProvider: "anthropic",
			apiKey: "sk-local",
			apiModelId: "claude-local",
			anthropicBaseUrl: "http://127.0.0.1:8081",
		})
	})
})
