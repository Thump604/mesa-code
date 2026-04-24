import fs from "fs/promises"
import os from "os"
import path from "path"

const MESA_CONFIG_DIR = path.join(os.homedir(), ".mesa")
const LEGACY_CONFIG_DIR = path.join(os.homedir(), ".roo")

let resolvedConfigDir: string | undefined

/**
 * Returns the active config directory.
 *
 * Primary: ~/.mesa
 * Legacy fallback: ~/.roo (if it exists and ~/.mesa does not yet)
 *
 * Once resolved, the result is cached for the process lifetime.
 */
export function getConfigDir(): string {
	return resolvedConfigDir ?? MESA_CONFIG_DIR
}

/**
 * Ensure the config directory exists.
 *
 * On first run, if ~/.mesa does not exist but ~/.roo does, the legacy
 * directory is used in place until the caller explicitly migrates.
 * This prevents data loss — existing settings, history, and commands
 * continue to work without a copy step.
 */
export async function ensureConfigDir(): Promise<void> {
	if (resolvedConfigDir) {
		return
	}

	try {
		await fs.access(MESA_CONFIG_DIR)
		resolvedConfigDir = MESA_CONFIG_DIR
		return
	} catch {
		// ~/.mesa does not exist yet
	}

	try {
		await fs.access(LEGACY_CONFIG_DIR)
		// Legacy directory exists — use it until migration
		resolvedConfigDir = LEGACY_CONFIG_DIR
		return
	} catch {
		// Neither exists — create the new one
	}

	await fs.mkdir(MESA_CONFIG_DIR, { recursive: true })
	resolvedConfigDir = MESA_CONFIG_DIR
}

/** @internal Reset cached config dir for tests. */
export function _resetConfigDirForTesting(): void {
	resolvedConfigDir = undefined
}
