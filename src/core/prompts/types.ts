export type PromptProfile = "default" | "terminal"

/**
 * Settings passed to system prompt generation functions
 */
export interface SystemPromptSettings {
	todoListEnabled: boolean
	useAgentRules: boolean
	/** When true, recursively discover and load .roo/rules from subdirectories */
	enableSubfolderRules?: boolean
	newTaskRequireTodos: boolean
	/** When true, model should hide vendor/company identity in responses */
	isStealthModel?: boolean
	/** Controls how much prompt scaffolding to include for the current surface */
	promptProfile?: PromptProfile
}

export function isTerminalPromptProfile(settings?: Pick<SystemPromptSettings, "promptProfile">): boolean {
	return settings?.promptProfile === "terminal"
}
