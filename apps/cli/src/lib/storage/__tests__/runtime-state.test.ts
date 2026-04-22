import fs from "fs/promises"
import path from "path"

const { getTestConfigDir } = vi.hoisted(() => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const os = require("os")
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const path = require("path")
	const testRunId = Date.now().toString()
	const testConfigDir = path.join(os.tmpdir(), `roo-cli-runtime-state-test-${testRunId}`)
	return { getTestConfigDir: () => testConfigDir }
})

vi.mock("../config-dir.js", () => ({
	getConfigDir: getTestConfigDir,
	ensureConfigDir: vi.fn(async () => {
		await fs.mkdir(getTestConfigDir(), { recursive: true })
	}),
}))

import {
	getRuntimeLogsDir,
	getRuntimeStatePath,
	loadRuntimeState,
	saveRuntimeState,
	setManagedRuntimeProcess,
} from "../runtime-state.js"

const actualTestConfigDir = getTestConfigDir()

describe("Runtime State Storage", () => {
	const expectedRuntimeStateFile = path.join(actualTestConfigDir, "runtime-state.json")

	beforeEach(async () => {
		await fs.rm(actualTestConfigDir, { recursive: true, force: true })
	})

	afterAll(async () => {
		await fs.rm(actualTestConfigDir, { recursive: true, force: true })
	})

	it("returns the runtime state path in the config dir", () => {
		expect(getRuntimeStatePath()).toBe(expectedRuntimeStateFile)
		expect(getRuntimeLogsDir()).toBe(path.join(actualTestConfigDir, "runtime-logs"))
	})

	it("loads an empty runtime state when no file exists", async () => {
		await expect(loadRuntimeState()).resolves.toEqual({})
	})

	it("saves and reloads managed process state", async () => {
		await saveRuntimeState({
			managedProcesses: {
				"vllm-mlx": {
					pid: 4242,
					command: "vllm-mlx serve model",
					executablePath: "/usr/local/bin/vllm-mlx",
					baseUrl: "http://127.0.0.1:8080/v1",
					model: "mlx-community/Qwen3-4B-4bit",
					protocol: "openai",
					logPath: "/tmp/vllm.log",
					startedAt: "2026-04-21T00:00:00.000Z",
				},
			},
		})

		await expect(loadRuntimeState()).resolves.toEqual({
			managedProcesses: {
				"vllm-mlx": expect.objectContaining({
					pid: 4242,
					model: "mlx-community/Qwen3-4B-4bit",
				}),
			},
		})
	})

	it("updates and clears a managed process entry", async () => {
		await setManagedRuntimeProcess("vllm-mlx", {
			pid: 4242,
			command: "vllm-mlx serve model",
			executablePath: "/usr/local/bin/vllm-mlx",
			baseUrl: "http://127.0.0.1:8080/v1",
			model: "mlx-community/Qwen3-4B-4bit",
			protocol: "openai",
			logPath: "/tmp/vllm.log",
			startedAt: "2026-04-21T00:00:00.000Z",
		})

		await expect(loadRuntimeState()).resolves.toEqual({
			managedProcesses: {
				"vllm-mlx": expect.objectContaining({
					pid: 4242,
				}),
			},
		})

		await setManagedRuntimeProcess("vllm-mlx", undefined)
		await expect(loadRuntimeState()).resolves.toEqual({})
	})
})
