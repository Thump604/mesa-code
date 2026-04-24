import fs from "fs/promises"
import os from "os"
import path from "path"

import yaml from "yaml"

export type CliCommand = {
	name: string
	source: "built-in" | "global" | "project"
	filePath: string
	description?: string
	argumentHint?: string
}

const BUILT_IN_COMMANDS: CliCommand[] = [
	{
		name: "init",
		source: "built-in",
		filePath: "<built-in:init>",
		description: "Analyze codebase and create concise AGENTS.md files for AI assistants",
	},
]

async function directoryExists(dirPath: string): Promise<boolean> {
	try {
		return (await fs.stat(dirPath)).isDirectory()
	} catch {
		return false
	}
}

function isMarkdownFile(filePath: string): boolean {
	return filePath.toLowerCase().endsWith(".md")
}

function parseCommandFrontmatter(content: string): Pick<CliCommand, "description" | "argumentHint"> {
	const normalized = content.replace(/^\uFEFF/, "")
	const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
	if (!match) {
		return {}
	}

	try {
		const frontmatter = yaml.parse(match[1] ?? "") as Record<string, unknown> | null
		if (!frontmatter || typeof frontmatter !== "object") {
			return {}
		}

		return {
			description:
				typeof frontmatter.description === "string" && frontmatter.description.trim()
					? frontmatter.description.trim()
					: undefined,
			argumentHint:
				typeof frontmatter["argument-hint"] === "string" && frontmatter["argument-hint"].trim()
					? frontmatter["argument-hint"].trim()
					: undefined,
		}
	} catch {
		return {}
	}
}

async function readCommandFile(filePath: string, source: CliCommand["source"]): Promise<CliCommand | undefined> {
	try {
		const content = await fs.readFile(filePath, "utf-8")
		const name = path.basename(filePath, path.extname(filePath))
		const frontmatter = parseCommandFrontmatter(content)

		return {
			name,
			source,
			filePath,
			...frontmatter,
		}
	} catch {
		return undefined
	}
}

async function scanCommandDirectory(dirPath: string, source: CliCommand["source"]): Promise<CliCommand[]> {
	if (!(await directoryExists(dirPath))) {
		return []
	}

	const entries = await fs.readdir(dirPath, { withFileTypes: true })
	const commands: CliCommand[] = []

	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name)

		if (entry.isFile() && isMarkdownFile(entry.name)) {
			const command = await readCommandFile(fullPath, source)
			if (command) {
				commands.push(command)
			}
			continue
		}

		if (!entry.isSymbolicLink()) {
			continue
		}

		try {
			const resolvedPath = await fs.realpath(fullPath)
			const stats = await fs.stat(resolvedPath)

			if (stats.isFile() && isMarkdownFile(resolvedPath)) {
				const command = await readCommandFile(resolvedPath, source)
				if (command) {
					commands.push({ ...command, filePath: resolvedPath })
				}
				continue
			}

			if (stats.isDirectory()) {
				commands.push(...(await scanCommandDirectory(resolvedPath, source)))
			}
		} catch {
			// Ignore broken symlinks or unreadable targets.
		}
	}

	return commands
}

export async function getCliCommands(workspacePath: string): Promise<CliCommand[]> {
	const commands = new Map<string, CliCommand>()

	for (const command of BUILT_IN_COMMANDS) {
		commands.set(command.name, command)
	}

	// Legacy ~/.roo/commands first, then ~/.mesa/commands (mesa wins on conflict)
	const legacyGlobalCommands = await scanCommandDirectory(path.join(os.homedir(), ".roo", "commands"), "global")
	for (const command of legacyGlobalCommands) {
		commands.set(command.name, command)
	}

	const globalCommands = await scanCommandDirectory(path.join(os.homedir(), ".mesa", "commands"), "global")
	for (const command of globalCommands) {
		commands.set(command.name, command)
	}

	// Legacy .roo/commands first, then .mesa/commands (mesa wins on conflict)
	const legacyProjectCommands = await scanCommandDirectory(path.join(workspacePath, ".roo", "commands"), "project")
	for (const command of legacyProjectCommands) {
		commands.set(command.name, command)
	}

	const projectCommands = await scanCommandDirectory(path.join(workspacePath, ".mesa", "commands"), "project")
	for (const command of projectCommands) {
		commands.set(command.name, command)
	}

	return Array.from(commands.values())
}
