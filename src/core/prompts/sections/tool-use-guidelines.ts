import type { SystemPromptSettings } from "../types"
import { isTerminalPromptProfile } from "../types"

export function getToolUseGuidelinesSection(settings?: SystemPromptSettings): string {
	if (isTerminalPromptProfile(settings)) {
		return `# Tool Use Guidelines

1. Assess what information you already have and what information you still need to make real progress.
2. Choose the tool that best matches the current step instead of defaulting to generic command execution.
3. Chain related tool calls when the next step is clear from the current result. Do not stop after each successful tool call; keep going until you hit a real blocker, need approval or input, or are ready to complete the task.`
	}

	return `# Tool Use Guidelines

1. Assess what information you already have and what information you need to proceed with the task.
2. Choose the most appropriate tool based on the task and the tool descriptions provided. Assess if you need additional information to proceed, and which of the available tools would be most effective for gathering this information. For example using the list_files tool is more effective than running a command like \`ls\` in the terminal. It's critical that you think about each available tool and use the one that best fits the current step in the task.
3. If multiple actions are needed, you may use multiple tools in a single message when appropriate, or use tools iteratively across messages. Each tool use should be informed by the results of previous tool uses. Do not assume the outcome of any tool use. Each step must be informed by the previous step's result.

By carefully considering the user's response after tool executions, you can react accordingly and make informed decisions about how to proceed with the task. This iterative process helps ensure the overall success and accuracy of your work.`
}
