import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import readline from "readline"

import Fuzzysort from "fuzzysort"
import ignore, { type Ignore } from "ignore"
import { rgPath } from "@vscode/ripgrep"

export type FileSearchResult = {
	path: string
	type: "file" | "folder"
	label?: string
}

export type SearchWorkspaceFilesOptions = {
	workspacePath: string
	query: string
	limit?: number
	maxIndexedFiles?: number
	showIgnoredFiles?: boolean
}

type FileSearchCacheEntry = {
	loadedAt: number
	results: FileSearchResult[]
	pending?: Promise<FileSearchResult[]>
}

export type FileSearchDeps = {
	loadWorkspaceIndex: (workspacePath: string, maxIndexedFiles: number) => Promise<FileSearchResult[]>
	loadIgnorePatterns: (workspacePath: string) => Promise<string | null>
	realpathSync: (filePath: string) => string
	now: () => number
}

const DEFAULT_FILE_SEARCH_LIMIT = 20
const DEFAULT_MAX_INDEXED_FILES = 10_000
const FILE_SEARCH_CACHE_TTL_MS = 5_000
const WORKSPACE_INDEX_CACHE = new Map<string, FileSearchCacheEntry>()

const defaultDeps: FileSearchDeps = {
	loadWorkspaceIndex: loadWorkspaceIndex,
	loadIgnorePatterns: loadIgnorePatterns,
	realpathSync: (filePath) => fs.realpathSync.native(filePath),
	now: () => Date.now(),
}

function toPosixPath(filePath: string): string {
	return filePath.split(path.sep).join(path.posix.sep)
}

function getCacheKey(workspacePath: string, maxIndexedFiles: number): string {
	return `${workspacePath}::${maxIndexedFiles}`
}

async function getCachedWorkspaceIndex(
	workspacePath: string,
	maxIndexedFiles: number,
	deps: FileSearchDeps,
): Promise<FileSearchResult[]> {
	const cacheKey = getCacheKey(workspacePath, maxIndexedFiles)
	const cached = WORKSPACE_INDEX_CACHE.get(cacheKey)
	const now = deps.now()

	if (cached?.pending) {
		return cached.pending
	}

	if (cached && now - cached.loadedAt < FILE_SEARCH_CACHE_TTL_MS) {
		return cached.results
	}

	const pending = deps
		.loadWorkspaceIndex(workspacePath, maxIndexedFiles)
		.then((results) => {
			WORKSPACE_INDEX_CACHE.set(cacheKey, {
				loadedAt: deps.now(),
				results,
			})
			return results
		})
		.catch((error) => {
			WORKSPACE_INDEX_CACHE.delete(cacheKey)
			throw error
		})

	WORKSPACE_INDEX_CACHE.set(cacheKey, {
		loadedAt: cached?.loadedAt ?? 0,
		results: cached?.results ?? [],
		pending,
	})

	return pending
}

async function loadIgnorePatterns(workspacePath: string): Promise<string | null> {
	// Prefer .mesaignore; fall back to .rooignore for migration
	for (const filename of [".mesaignore", ".rooignore"]) {
		try {
			return await fs.promises.readFile(path.join(workspacePath, filename), "utf8")
		} catch (error) {
			const normalized = error as NodeJS.ErrnoException
			if (normalized.code === "ENOENT") {
				continue
			}

			throw error
		}
	}

	return null
}

async function loadWorkspaceIndex(workspacePath: string, maxIndexedFiles: number): Promise<FileSearchResult[]> {
	if (!rgPath) {
		throw new Error("ripgrep binary is not available")
	}

	const args = [
		"--files",
		"--follow",
		"--hidden",
		"-g",
		"!**/node_modules/**",
		"-g",
		"!**/.git/**",
		"-g",
		"!**/out/**",
		"-g",
		"!**/dist/**",
	]

	return new Promise((resolve, reject) => {
		const rgProcess = spawn(rgPath, args, {
			cwd: workspacePath,
			stdio: ["ignore", "pipe", "pipe"],
		})
		const rl = readline.createInterface({ input: rgProcess.stdout, crlfDelay: Infinity })
		const fileResults: FileSearchResult[] = []
		const dirSet = new Set<string>()

		let errorOutput = ""
		let truncated = false

		rl.on("line", (line) => {
			const relativePath = toPosixPath(line.trim())
			if (!relativePath) {
				return
			}

			if (fileResults.length >= maxIndexedFiles) {
				if (!truncated) {
					truncated = true
					rl.close()
					rgProcess.kill()
				}
				return
			}

			fileResults.push({
				path: relativePath,
				type: "file",
				label: path.basename(relativePath),
			})

			let dirPath = path.posix.dirname(relativePath)
			while (dirPath && dirPath !== "." && dirPath !== "/") {
				dirSet.add(dirPath)
				dirPath = path.posix.dirname(dirPath)
			}
		})

		rgProcess.stderr.on("data", (chunk) => {
			errorOutput += chunk.toString()
		})

		rgProcess.on("error", (error) => {
			reject(new Error(`ripgrep process error: ${error.message}`))
		})

		rl.on("close", () => {
			if (errorOutput && fileResults.length === 0) {
				reject(new Error(`ripgrep process error: ${errorOutput.trim()}`))
				return
			}

			const directoryResults = Array.from(dirSet).map((dirPath) => ({
				path: dirPath,
				type: "folder" as const,
				label: path.posix.basename(dirPath),
			}))

			resolve([...fileResults, ...directoryResults])
		})
	})
}

function createIgnoreMatcher(patterns: string | null): Ignore | null {
	if (!patterns?.trim()) {
		return null
	}

	const matcher = ignore()
	matcher.add(patterns)
	matcher.add(".mesaignore")
	matcher.add(".rooignore")
	return matcher
}

function isAllowedByIgnoreRules(
	resultPath: string,
	workspacePath: string,
	matcher: Ignore | null,
	deps: Pick<FileSearchDeps, "realpathSync">,
): boolean {
	if (!matcher) {
		return true
	}

	const absolutePath = path.resolve(workspacePath, resultPath)

	let resolvedPath = absolutePath
	try {
		resolvedPath = deps.realpathSync(absolutePath)
	} catch {
		// Broken symlink or missing path: fall back to the discovered relative path.
	}

	const relativePath = toPosixPath(path.relative(workspacePath, resolvedPath))
	if (!relativePath || relativePath.startsWith("..")) {
		return true
	}

	return (
		!matcher.ignores(relativePath) &&
		!matcher.ignores(relativePath.endsWith("/") ? relativePath : `${relativePath}/`)
	)
}

export async function searchWorkspaceFiles(
	{
		workspacePath,
		query,
		limit = DEFAULT_FILE_SEARCH_LIMIT,
		maxIndexedFiles = DEFAULT_MAX_INDEXED_FILES,
		showIgnoredFiles = false,
	}: SearchWorkspaceFilesOptions,
	deps: Partial<FileSearchDeps> = {},
): Promise<FileSearchResult[]> {
	const resolvedDeps = { ...defaultDeps, ...deps }
	const indexedEntries = await getCachedWorkspaceIndex(workspacePath, maxIndexedFiles, resolvedDeps)

	const ignorePatterns = showIgnoredFiles ? null : await resolvedDeps.loadIgnorePatterns(workspacePath)
	const ignoreMatcher = createIgnoreMatcher(ignorePatterns)

	const visibleEntries = indexedEntries.filter((entry) =>
		isAllowedByIgnoreRules(entry.path, workspacePath, ignoreMatcher, resolvedDeps),
	)

	if (!query.trim()) {
		return visibleEntries.slice(0, limit)
	}

	const searchableEntries = visibleEntries.map((entry) => ({
		entry,
		searchText: `${entry.path} ${entry.label ?? ""}`,
	}))

	return Fuzzysort.go(query, searchableEntries, {
		key: "searchText",
		limit,
		threshold: -10_000,
	}).map((match) => match.obj.entry)
}

export function clearWorkspaceFileSearchCache(): void {
	WORKSPACE_INDEX_CACHE.clear()
}
