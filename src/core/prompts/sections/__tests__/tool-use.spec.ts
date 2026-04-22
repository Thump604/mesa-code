import { getSharedToolUseSection } from "../tool-use"

describe("getSharedToolUseSection", () => {
	it("should include native tool-calling instructions", () => {
		const section = getSharedToolUseSection()

		expect(section).toContain("provider-native tool-calling mechanism")
		expect(section).toContain("Do not include XML markup or examples")
	})

	it("should include multiple tools per message guidance", () => {
		const section = getSharedToolUseSection()

		expect(section).toContain("You must call at least one tool per assistant response")
		expect(section).toContain("Prefer calling as many tools as are reasonably needed")
	})

	it("should NOT include single tool per message restriction", () => {
		const section = getSharedToolUseSection()

		expect(section).not.toContain("You must use exactly one tool call per assistant response")
		expect(section).not.toContain("Do not call zero tools or more than one tool")
	})

	it("should NOT include XML formatting instructions", () => {
		const section = getSharedToolUseSection()

		expect(section).not.toContain("<actual_tool_name>")
		expect(section).not.toContain("</actual_tool_name>")
	})

	it("should use a lighter tool contract for the terminal prompt profile", () => {
		const section = getSharedToolUseSection({
			todoListEnabled: true,
			useAgentRules: true,
			newTaskRequireTodos: false,
			promptProfile: "terminal",
		})

		expect(section).toContain("Use tools when they materially advance the task")
		expect(section).toContain("Do not call tools just to satisfy a quota")
		expect(section).not.toContain("You must call at least one tool per assistant response")
	})
})
