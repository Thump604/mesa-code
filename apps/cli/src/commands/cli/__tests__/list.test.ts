import { readWorkspaceTaskSessions } from "@/lib/task-history/index.js"
import { loadSettings } from "@/lib/storage/index.js"

import { listCommands, listModels, listModes, listSessions, parseFormat } from "../list.js"

vi.mock("@/lib/task-history/index.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/task-history/index.js")>()
	return {
		...actual,
		readWorkspaceTaskSessions: vi.fn(),
	}
})

vi.mock("@/lib/storage/index.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/storage/index.js")>()
	return {
		...actual,
		loadSettings: vi.fn().mockResolvedValue({}),
	}
})

vi.mock("@/lib/discovery/modes.js", () => ({
	loadCliModes: vi.fn(),
}))

vi.mock("@/lib/discovery/commands.js", () => ({
	getCliCommands: vi.fn(),
}))

vi.mock("@/lib/discovery/models.js", () => ({
	getOpenAiCompatibleModels: vi.fn(),
	getAnthropicCompatibleModels: vi.fn(),
	getRouterModels: vi.fn(),
}))

const { loadCliModes } = await import("@/lib/discovery/modes.js")
const { getCliCommands } = await import("@/lib/discovery/commands.js")
const { getOpenAiCompatibleModels, getAnthropicCompatibleModels, getRouterModels } = await import(
	"@/lib/discovery/models.js"
)

describe("parseFormat", () => {
	it("defaults to json when undefined", () => {
		expect(parseFormat(undefined)).toBe("json")
	})

	it("returns json for 'json'", () => {
		expect(parseFormat("json")).toBe("json")
	})

	it("returns text for 'text'", () => {
		expect(parseFormat("text")).toBe("text")
	})

	it("is case-insensitive", () => {
		expect(parseFormat("JSON")).toBe("json")
		expect(parseFormat("Text")).toBe("text")
		expect(parseFormat("TEXT")).toBe("text")
	})

	it("throws on invalid format", () => {
		expect(() => parseFormat("xml")).toThrow('Invalid format: xml. Must be "json" or "text".')
	})

	it("throws on empty string", () => {
		expect(() => parseFormat("")).toThrow("Invalid format")
	})
})

describe("list commands, modes, models, sessions", () => {
	const workspacePath = process.cwd()

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

	it("lists commands without using the extension host", async () => {
		vi.mocked(getCliCommands).mockResolvedValue([
			{
				name: "init",
				source: "built-in",
				filePath: "/tmp/init.md",
				description: "Initialize AGENTS.md",
			},
		])

		const output = await captureStdout(() => listCommands({ format: "text", workspace: workspacePath }))

		expect(getCliCommands).toHaveBeenCalledWith(workspacePath)
		expect(output.trim()).toBe("/init (built-in) - Initialize AGENTS.md")
	})

	it("lists modes from the CLI mode loader", async () => {
		vi.mocked(loadCliModes).mockResolvedValue([
			{
				slug: "code",
				name: "Code",
				roleDefinition: "Write code",
				groups: ["read"],
			},
			{
				slug: "local-review",
				name: "Local Review",
				roleDefinition: "Review locally",
				groups: ["read"],
			},
		])

		const output = await captureStdout(() => listModes({ format: "text", workspace: workspacePath }))

		expect(output.trim().split("\n")).toEqual(["code\tCode", "local-review\tLocal Review"])
	})

	it("lists openai-compatible models directly", async () => {
		vi.mocked(getOpenAiCompatibleModels).mockResolvedValue({
			"qwen3-coder": { maxTokens: 4096, contextWindow: 131072, supportsPromptCache: false },
			"llama-3.3": { maxTokens: 4096, contextWindow: 131072, supportsPromptCache: false },
		})

		const output = await captureStdout(() =>
			listModels({
				format: "text",
				workspace: workspacePath,
				provider: "openai",
				baseUrl: "http://127.0.0.1:8080/v1",
				apiKey: "not-needed",
			}),
		)

		expect(getOpenAiCompatibleModels).toHaveBeenCalledWith("http://127.0.0.1:8080/v1", "not-needed")
		expect(output.trim().split("\n")).toEqual(["llama-3.3", "qwen3-coder"])
	})

	it("lists anthropic-compatible models directly", async () => {
		vi.mocked(getAnthropicCompatibleModels).mockResolvedValue({
			"claude-local": { maxTokens: 4096, contextWindow: 200000, supportsPromptCache: false },
			"claude-alt": { maxTokens: 4096, contextWindow: 200000, supportsPromptCache: false },
		})

		const output = await captureStdout(() =>
			listModels({
				format: "text",
				workspace: workspacePath,
				provider: "anthropic",
				baseUrl: "http://127.0.0.1:8081",
				apiKey: "not-needed",
			}),
		)

		expect(getAnthropicCompatibleModels).toHaveBeenCalledWith("http://127.0.0.1:8081", "not-needed")
		expect(output.trim().split("\n")).toEqual(["claude-alt", "claude-local"])
	})

	it("lists router-backed models directly", async () => {
		vi.mocked(getRouterModels).mockResolvedValue({
			"anthropic/claude-sonnet": {
				maxTokens: 4096,
				contextWindow: 200000,
				supportsPromptCache: false,
			},
		})

		const output = await captureStdout(() =>
			listModels({
				format: "json",
				workspace: workspacePath,
				provider: "openrouter",
			}),
		)

		expect(getRouterModels).toHaveBeenCalledWith("openrouter", {})
		expect(JSON.parse(output)).toEqual({
			models: {
				"anthropic/claude-sonnet": {
					maxTokens: 4096,
					contextWindow: 200000,
					supportsPromptCache: false,
				},
			},
		})
	})

	it("uses the CLI runtime storage path and prints JSON output for sessions", async () => {
		vi.mocked(readWorkspaceTaskSessions).mockResolvedValue([
			{ id: "s1", task: "Task 1", ts: 1_700_000_000_000, mode: "code" },
		])

		const output = await captureStdout(() => listSessions({ format: "json", workspace: workspacePath }))

		expect(readWorkspaceTaskSessions).toHaveBeenCalledWith(workspacePath)
		expect(JSON.parse(output)).toEqual({
			workspace: workspacePath,
			sessions: [{ id: "s1", task: "Task 1", ts: 1_700_000_000_000, mode: "code" }],
		})
	})

	it("prints tab-delimited text output with ISO timestamps and formatted titles", async () => {
		vi.mocked(readWorkspaceTaskSessions).mockResolvedValue([
			{ id: "s1", task: "Task 1", ts: Date.UTC(2024, 0, 1, 0, 0, 0) },
			{ id: "s2", task: "   ", ts: Date.UTC(2024, 0, 1, 1, 0, 0) },
		])

		const output = await captureStdout(() => listSessions({ format: "text", workspace: workspacePath }))
		const lines = output.trim().split("\n")

		expect(lines).toEqual(["s1\t2024-01-01T00:00:00.000Z\tTask 1", "s2\t2024-01-01T01:00:00.000Z\t(untitled)"])
	})
})
