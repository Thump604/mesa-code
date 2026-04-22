import fs from "fs/promises"
import path from "path"

import type { SupportedApiStandard, SupportedLocalRuntime } from "@/types/index.js"

import { ensureConfigDir, getConfigDir } from "./config-dir.js"

export interface ManagedRuntimeProcessState {
	pid: number
	command: string
	executablePath: string
	baseUrl: string
	model: string
	protocol: SupportedApiStandard
	logPath: string
	startedAt: string
}

export interface CliRuntimeState {
	managedProcesses?: Partial<Record<SupportedLocalRuntime, ManagedRuntimeProcessState>>
}

export function getRuntimeStatePath(): string {
	return path.join(getConfigDir(), "runtime-state.json")
}

export function getRuntimeLogsDir(): string {
	return path.join(getConfigDir(), "runtime-logs")
}

export async function loadRuntimeState(): Promise<CliRuntimeState> {
	try {
		const statePath = getRuntimeStatePath()
		const data = await fs.readFile(statePath, "utf-8")
		return JSON.parse(data) as CliRuntimeState
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {}
		}

		throw error
	}
}

export async function saveRuntimeState(state: CliRuntimeState): Promise<void> {
	await ensureConfigDir()
	await fs.writeFile(getRuntimeStatePath(), JSON.stringify(state, null, 2), {
		mode: 0o600,
	})
}

export async function setManagedRuntimeProcess(
	runtime: SupportedLocalRuntime,
	processState: ManagedRuntimeProcessState | undefined,
): Promise<CliRuntimeState> {
	const existing = await loadRuntimeState()
	const managedProcesses = { ...(existing.managedProcesses ?? {}) }

	if (processState) {
		managedProcesses[runtime] = processState
	} else {
		delete managedProcesses[runtime]
	}

	const nextState: CliRuntimeState =
		Object.keys(managedProcesses).length > 0
			? {
					managedProcesses,
				}
			: {}

	await saveRuntimeState(nextState)
	return nextState
}

export async function ensureRuntimeLogsDir(): Promise<string> {
	const logsDir = getRuntimeLogsDir()
	await fs.mkdir(logsDir, { recursive: true })
	return logsDir
}
