import { Box, Text } from "ink"
import { Select } from "@inkjs/ui"

import { OnboardingProviderChoice, ASCII_ROO } from "@/types/index.js"

export interface OnboardingScreenProps {
	onSelect: (choice: OnboardingProviderChoice) => void
}

export function OnboardingScreen({ onSelect }: OnboardingScreenProps) {
	return (
		<Box flexDirection="column" gap={1}>
			<Text bold color="cyan">
				{ASCII_ROO}
			</Text>
			<Text dimColor>Welcome. How would you like to use a model from the CLI?</Text>
			<Select
				options={[
					{ label: "Use a local or self-hosted endpoint", value: OnboardingProviderChoice.Byok },
					{ label: "Use Roo Cloud compatibility mode", value: OnboardingProviderChoice.Roo },
				]}
				onChange={(value: string) => {
					onSelect(value as OnboardingProviderChoice)
				}}
			/>
		</Box>
	)
}
