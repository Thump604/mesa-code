import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import { access } from "fs/promises"

import { execa } from "execa"
import pWaitFor from "p-wait-for"

import {
	ensureRuntimeLogsDir,
	loadRuntimeState,
	setManagedRuntimeProcess,
	type ManagedRuntimeProcessState,
} from "@/lib/storage/index.js"
import type { SupportedApiStandard, SupportedLocalRuntime, SupportedProvider } from "@/types/index.js"

import { collectRuntimeDoctorReport, type RuntimeDoctorReport } from "./observability.js"

export type RuntimeUseAction = {
	kind:
		| "runtime-installed"
		| "runtime-detected"
		| "settings-selected"
		| "managed-process-cleared"
		| "managed-process-stopped"
		| "managed-process-reused"
		| "managed-process-started"
		| "verification-ready"
		| "verification-pending"
	description: string
}

export type RuntimeUseResult = {
	runtime: SupportedLocalRuntime
	protocol: SupportedApiStandard
	provider: SupportedProvider
	baseUrl: string
	model: string
	state: "configured" | "starting" | "ready"
	executable?: string
	managedProcess?: Pick<ManagedRuntimeProcessState, "pid" | "logPath">
	doctor?: RuntimeDoctorReport
	actions: RuntimeUseAction[]
	hints: string[]
}

export type RuntimeUseRequest = {
	runtime: SupportedLocalRuntime
	protocol: SupportedApiStandard
	provider: SupportedProvider
	baseUrl: string
	model: string
	apiKey?: string
	installRuntime?: boolean
	startRuntime?: boolean
	waitSeconds?: number
}

type RuntimeManagerDeps = {
	resolveExecutable: (candidates: string[]) => Promise<{ command: string; path: string } | undefined>
	exec: (
		command: string,
		args: string[],
		options?: {
			env?: Record<string, string | undefined>
		},
	) => Promise<{ exitCode: number; stdout: string; stderr: string }>
	spawnDetached: (
		command: string,
		args: string[],
		options: { env?: Record<string, string | undefined>; logPath: string },
	) => Promise<{ pid: number }>
	isPidRunning: (pid: number) => boolean
	stopPid: (pid: number) => Promise<void>
	loadRuntimeState: typeof loadRuntimeState
	setManagedRuntimeProcess: typeof setManagedRuntimeProcess
	ensureRuntimeLogsDir: typeof ensureRuntimeLogsDir
	collectRuntimeDoctorReport: typeof collectRuntimeDoctorReport
}

type RuntimeAdapter = {
	runtime: SupportedLocalRuntime
	displayName: string
	executableCandidates: string[]
	installSpec?: string
	supportsManagedStart: boolean
	startCommand(
		executable: string,
		request: RuntimeUseRequest,
	): {
		command: string
		args: string[]
		env?: Record<string, string | undefined>
	}
}

const defaultDeps: RuntimeManagerDeps = {
	async resolveExecutable(candidates) {
		for (const candidate of candidates) {
			const resolved = await resolveExecutableOnPath(candidate)
			if (resolved) {
				return {
					command: candidate,
					path: resolved,
				}
			}
		}

		return undefined
	},
	async exec(command, args, options = {}) {
		const result = await execa(command, args, {
			env: options.env,
			reject: false,
		})

		return {
			exitCode: result.exitCode ?? 0,
			stdout: result.stdout,
			stderr: result.stderr,
		}
	},
	async spawnDetached(command, args, options) {
		const logFd = fs.openSync(options.logPath, "a")
		const child = spawn(command, args, {
			detached: true,
			stdio: ["ignore", logFd, logFd],
			env: {
				...process.env,
				...options.env,
			},
		})

		child.unref()
		fs.closeSync(logFd)

		const pid = child.pid
		if (!pid) {
			throw new Error(`Failed to launch detached process for ${command}`)
		}

		return { pid }
	},
	isPidRunning(pid) {
		try {
			process.kill(pid, 0)
			return true
		} catch {
			return false
		}
	},
	async stopPid(pid) {
		try {
			process.kill(pid, "SIGTERM")
		} catch {
			return
		}

		await pWaitFor(
			() => {
				try {
					process.kill(pid, 0)
					return false
				} catch {
					return true
				}
			},
			{ interval: 200, timeout: 5_000 },
		).catch(() => undefined)

		try {
			process.kill(pid, "SIGKILL")
		} catch {
			// Ignore: the process may have already exited.
		}
	},
	loadRuntimeState,
	setManagedRuntimeProcess,
	ensureRuntimeLogsDir,
	collectRuntimeDoctorReport,
}

function buildRuntimeAdapter(runtime: SupportedLocalRuntime): RuntimeAdapter {
	if (runtime === "vllm-mlx") {
		return {
			runtime,
			displayName: "vllm-mlx",
			executableCandidates: ["vllm-mlx", "vllmlx"],
			installSpec: process.env.ROO_VLLM_MLX_INSTALL_SPEC || "git+https://github.com/waybarrios/vllm-mlx.git",
			supportsManagedStart: true,
			startCommand(executable, request) {
				const { host, port } = parseHostAndPort(request.baseUrl)
				const args = ["serve", request.model, "--host", host, "--port", String(port)]

				if (request.apiKey && request.apiKey !== "not-needed") {
					args.push("--api-key", request.apiKey)
				}

				return {
					command: executable,
					args,
					env: {
						HF_TOKEN: process.env.HF_TOKEN,
					},
				}
			},
		}
	}

	return {
		runtime,
		displayName: "llama.cpp",
		executableCandidates: ["llama-server"],
		supportsManagedStart: false,
		startCommand() {
			throw new Error("Automatic llama.cpp startup is not implemented yet.")
		},
	}
}

function parseHostAndPort(baseUrl: string): { host: string; port: number } {
	const url = new URL(baseUrl)
	const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80
	return {
		host: url.hostname,
		port,
	}
}

async function resolveExecutableOnPath(binary: string): Promise<string | undefined> {
	const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean)
	const isWindows = process.platform === "win32"
	const suffixes = isWindows
		? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
				.split(";")
				.filter(Boolean)
				.map((value) => value.toLowerCase())
		: [""]

	for (const entry of pathEntries) {
		const candidates = isWindows
			? suffixes.map((suffix) =>
					binary.toLowerCase().endsWith(suffix)
						? path.join(entry, binary)
						: path.join(entry, `${binary}${suffix}`),
				)
			: [path.join(entry, binary)]

		for (const candidate of candidates) {
			try {
				await access(candidate, isWindows ? fs.constants.F_OK : fs.constants.X_OK)
				return candidate
			} catch {
				// Continue scanning PATH.
			}
		}
	}

	return undefined
}

function modelLooksRemote(model: string): boolean {
	if (path.isAbsolute(model)) {
		return false
	}

	return model.includes("/") || !model.endsWith(".gguf")
}

function modelMayBeReady(report: RuntimeDoctorReport | undefined, model: string): boolean {
	if (!report?.health.ok) {
		return false
	}

	const ids = report.models.data?.modelIds ?? []
	if (ids.length === 0) {
		return true
	}

	return ids.includes(model) || ids.includes("default")
}

export async function activateManagedRuntime(
	request: RuntimeUseRequest,
	deps: Partial<RuntimeManagerDeps> = {},
): Promise<RuntimeUseResult> {
	const resolvedDeps = { ...defaultDeps, ...deps }
	const adapter = buildRuntimeAdapter(request.runtime)
	const actions: RuntimeUseAction[] = [
		{
			kind: "settings-selected",
			description: `Selected ${request.runtime} as the local runtime lane for ${request.model}.`,
		},
	]
	const hints: string[] = []

	let executable = await resolvedDeps.resolveExecutable(adapter.executableCandidates)

	if (!executable && request.installRuntime !== false && adapter.installSpec) {
		const uv = await resolvedDeps.resolveExecutable(["uv"])
		if (!uv) {
			throw new Error(
				`${adapter.displayName} is not installed and uv was not found on PATH. Install uv or rerun with an installed runtime binary.`,
			)
		}

		const installResult = await resolvedDeps.exec(uv.path, ["tool", "install", adapter.installSpec])
		if (installResult.exitCode !== 0) {
			const installError = installResult.stderr || installResult.stdout || "uv tool install failed"
			throw new Error(`Failed to install ${adapter.displayName}: ${installError}`)
		}

		actions.push({
			kind: "runtime-installed",
			description: `Installed ${adapter.displayName} via uv tool install.`,
		})
		executable = await resolvedDeps.resolveExecutable(adapter.executableCandidates)
	}

	if (!executable) {
		throw new Error(
			`${adapter.displayName} was not found on PATH. Install it first or rerun with --no-install-runtime to skip managed bootstrap.`,
		)
	}

	actions.push({
		kind: "runtime-detected",
		description: `Using runtime executable ${executable.command}.`,
	})

	if (!request.startRuntime) {
		if (request.runtime === "llama.cpp") {
			hints.push(
				"Automatic llama.cpp bootstrap is not implemented yet. Use `roo doctor` against an existing server.",
			)
		}

		return {
			runtime: request.runtime,
			protocol: request.protocol,
			provider: request.provider,
			baseUrl: request.baseUrl,
			model: request.model,
			state: "configured",
			executable: executable.path,
			actions,
			hints,
		}
	}

	if (!adapter.supportsManagedStart) {
		throw new Error(
			`Automatic ${adapter.displayName} startup is not implemented yet. Use --no-start to just save the profile and point the CLI at an existing server.`,
		)
	}

	const runtimeState = await resolvedDeps.loadRuntimeState()
	const existingManagedProcess = runtimeState.managedProcesses?.[request.runtime]

	if (existingManagedProcess && resolvedDeps.isPidRunning(existingManagedProcess.pid)) {
		if (existingManagedProcess.baseUrl === request.baseUrl && existingManagedProcess.model === request.model) {
			actions.push({
				kind: "managed-process-reused",
				description: `Reusing managed ${request.runtime} process ${existingManagedProcess.pid}.`,
			})

			const doctor = await waitForReadiness(request, resolvedDeps, request.waitSeconds)
			const state = modelMayBeReady(doctor, request.model) ? "ready" : "starting"

			if (state === "ready") {
				actions.push({
					kind: "verification-ready",
					description: "The local runtime responded on its configured endpoint.",
				})
			} else {
				actions.push({
					kind: "verification-pending",
					description: "The runtime process is still warming up or downloading model weights.",
				})
			}

			if (modelLooksRemote(request.model)) {
				hints.push(
					"If the model is not cached locally yet, the runtime may still be downloading it from Hugging Face.",
				)
			}

			return {
				runtime: request.runtime,
				protocol: request.protocol,
				provider: request.provider,
				baseUrl: request.baseUrl,
				model: request.model,
				state,
				executable: executable.path,
				managedProcess: {
					pid: existingManagedProcess.pid,
					logPath: existingManagedProcess.logPath,
				},
				doctor,
				actions,
				hints,
			}
		}

		await resolvedDeps.stopPid(existingManagedProcess.pid)
		await resolvedDeps.setManagedRuntimeProcess(request.runtime, undefined)
		actions.push({
			kind: "managed-process-stopped",
			description: `Stopped managed ${request.runtime} process ${existingManagedProcess.pid} to swap models.`,
		})
	} else if (existingManagedProcess) {
		await resolvedDeps.setManagedRuntimeProcess(request.runtime, undefined)
		actions.push({
			kind: "managed-process-cleared",
			description: `Cleared stale managed ${request.runtime} state for dead process ${existingManagedProcess.pid}.`,
		})
	}

	const logsDir = await resolvedDeps.ensureRuntimeLogsDir()
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
	const logPath = path.join(logsDir, `${request.runtime}-${timestamp}.log`)
	const startCommand = adapter.startCommand(executable.path, request)
	const spawned = await resolvedDeps.spawnDetached(startCommand.command, startCommand.args, {
		env: startCommand.env,
		logPath,
	})

	await resolvedDeps.setManagedRuntimeProcess(request.runtime, {
		pid: spawned.pid,
		command: [startCommand.command, ...startCommand.args].join(" "),
		executablePath: executable.path,
		baseUrl: request.baseUrl,
		model: request.model,
		protocol: request.protocol,
		logPath,
		startedAt: new Date().toISOString(),
	})

	actions.push({
		kind: "managed-process-started",
		description: `Started managed ${request.runtime} process ${spawned.pid}.`,
	})

	const doctor = await waitForReadiness(request, resolvedDeps, request.waitSeconds)
	const state = modelMayBeReady(doctor, request.model) ? "ready" : "starting"

	if (state === "ready") {
		actions.push({
			kind: "verification-ready",
			description: "The local runtime responded on its configured endpoint.",
		})
	} else {
		actions.push({
			kind: "verification-pending",
			description: "The runtime process is still warming up or downloading model weights.",
		})
	}

	if (modelLooksRemote(request.model)) {
		hints.push("If the model is not cached locally yet, the runtime may still be downloading it from Hugging Face.")
	}
	hints.push(`Runtime logs: ${logPath}`)

	return {
		runtime: request.runtime,
		protocol: request.protocol,
		provider: request.provider,
		baseUrl: request.baseUrl,
		model: request.model,
		state,
		executable: executable.path,
		managedProcess: {
			pid: spawned.pid,
			logPath,
		},
		doctor,
		actions,
		hints,
	}
}

async function waitForReadiness(
	request: RuntimeUseRequest,
	deps: RuntimeManagerDeps,
	waitSeconds = 20,
): Promise<RuntimeDoctorReport | undefined> {
	if (waitSeconds <= 0) {
		return undefined
	}

	let report: RuntimeDoctorReport | undefined
	await pWaitFor(
		async () => {
			report = await deps.collectRuntimeDoctorReport({
				runtime: request.runtime,
				protocol: request.protocol,
				baseUrl: request.baseUrl,
				apiKey: request.apiKey,
			})
			return report.health.ok
		},
		{
			interval: 2_000,
			timeout: waitSeconds * 1_000,
		},
	).catch(() => undefined)

	return report
}
