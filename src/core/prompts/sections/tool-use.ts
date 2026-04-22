import type { SystemPromptSettings } from "../types"
import { isTerminalPromptProfile } from "../types"

export function getSharedToolUseSection(settings?: SystemPromptSettings): string {
	if (isTerminalPromptProfile(settings)) {
		return `====

TOOL USE

You have access to a set of tools executed through the provider-native tool-calling mechanism. Use tools when they materially advance the task. Do not call tools just to satisfy a quota. If you already have enough information to answer or finish the turn safely, respond directly without an unnecessary tool call. Bundle related tool calls when it reduces back-and-forth and you can do so safely. Do not include XML markup or examples.`
	}

	return `====

TOOL USE

You have access to a set of tools that are executed upon the user's approval. Use the provider-native tool-calling mechanism. Do not include XML markup or examples. You must call at least one tool per assistant response. Prefer calling as many tools as are reasonably needed in a single response to reduce back-and-forth and complete tasks faster.`
}
