import os from "os"
import path from "path"

import { buildModelUsePlan } from "../model-plan.js"

describe("buildModelUsePlan", () => {
	it("treats Hugging Face model ids as remote sources with runtime-default cache placement", async () => {
		const plan = await buildModelUsePlan({
			runtime: "vllm-mlx",
			model: "Qwen/Qwen3.6-35B-A3B",
		})

		expect(plan.source.kind).toBe("huggingface-hub")
		expect(plan.download.required).toBe(true)
		expect(plan.placement.enforcement).toBe("runtime-default-cache")
		expect(plan.warnings).toContain(
			"No explicit storage root was provided. Current live execution still relies on the runtime's default cache path.",
		)
	})

	it("marks missing local paths explicitly", async () => {
		const missingPath = path.join(os.tmpdir(), `roo-missing-${Date.now()}.gguf`)
		const plan = await buildModelUsePlan({
			runtime: "llama.cpp",
			model: missingPath,
		})

		expect(plan.source.kind).toBe("local-path-missing")
		expect(plan.source.resolvedPath).toBe(path.resolve(missingPath))
		expect(plan.warnings).toContain(`The local model path does not exist: ${path.resolve(missingPath)}`)
	})

	it("plans explicit storage roots without pretending they are live-enforced", async () => {
		const plan = await buildModelUsePlan({
			runtime: "vllm-mlx",
			model: "Qwen/Qwen3.6-35B-A3B",
			storageRoot: "~/ai-models",
		})

		expect(plan.placement.effectiveStorageRoot).toBe(path.join(os.homedir(), "ai-models"))
		expect(plan.placement.enforcement).toBe("planned-only")
		expect(plan.placement.targetPathHint).toContain(path.join("ai-models", "vllm-mlx"))
	})
})
