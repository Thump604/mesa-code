import fs from "fs/promises"
import os from "os"
import path from "path"

import yaml from "yaml"

import { DEFAULT_MODES, type ModeConfig, customModesSettingsSchema } from "@roo-code/types"

async function readModeFile(filePath: string, source: "global" | "project"): Promise<ModeConfig[]> {
	try {
		const raw = (await fs.readFile(filePath, "utf-8")).replace(/^\uFEFF/, "")
		const parsed = customModesSettingsSchema.safeParse(yaml.parse(raw))

		if (!parsed.success) {
			return []
		}

		return parsed.data.customModes.map((mode) => ({ ...mode, source }))
	} catch {
		return []
	}
}

export async function loadCliModes(workspacePath: string): Promise<ModeConfig[]> {
	const globalModesPath = path.join(os.homedir(), ".mesa", "custom_modes.yaml")
	const legacyGlobalModesPath = path.join(os.homedir(), ".roo", "custom_modes.yaml")
	const projectModesPath = path.join(workspacePath, ".roomodes")

	const [globalModes, legacyGlobalModes, projectModes] = await Promise.all([
		readModeFile(globalModesPath, "global"),
		readModeFile(legacyGlobalModesPath, "global"),
		readModeFile(projectModesPath, "project"),
	])

	// Merge global modes: ~/.mesa wins over ~/.roo for same slug
	const mesaSlugs = new Set(globalModes.map((m) => m.slug))
	const mergedGlobalModes = [...globalModes, ...legacyGlobalModes.filter((m) => !mesaSlugs.has(m.slug))]

	const projectModeSlugs = new Set(projectModes.map((mode) => mode.slug))
	const mergedCustomModes = [...projectModes, ...mergedGlobalModes.filter((mode) => !projectModeSlugs.has(mode.slug))]
	const allModes = [...DEFAULT_MODES]

	for (const customMode of mergedCustomModes) {
		const existingIndex = allModes.findIndex((mode) => mode.slug === customMode.slug)
		if (existingIndex >= 0) {
			allModes[existingIndex] = customMode
		} else {
			allModes.push(customMode)
		}
	}

	return allModes
}
