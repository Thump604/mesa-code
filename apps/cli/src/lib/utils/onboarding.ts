import { saveSettings } from "@/lib/storage/index.js"

export async function runOnboarding(): Promise<void> {
	await saveSettings({ hasCompletedOnboarding: true })

	console.log("")
	console.log("[CLI] Local/private mode is the default contract for this fork.")
	console.log("[CLI] Set OPENAI_BASE_URL or use --base-url, then provide --model.")
	console.log("[CLI] Optional local profiles: --runtime llama.cpp|vllm-mlx --protocol openai|anthropic")
	console.log("[CLI] Remote providers remain explicit opt-in via --provider.")
	console.log("")
}
