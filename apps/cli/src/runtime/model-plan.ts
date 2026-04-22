import fs from "fs/promises"
import os from "os"
import path from "path"

import type { SupportedLocalRuntime } from "@/types/index.js"

export type ModelSourceKind = "local-path" | "local-path-missing" | "huggingface-hub" | "named-model"
export type PlacementStatus = "accepted" | "blocked" | "not-applicable"
export type PlacementEnforcement = "runtime-default-cache" | "planned-only" | "not-applicable"

export type ModelUsePlan = {
	source: {
		kind: ModelSourceKind
		input: string
		resolvedPath?: string
		exists?: boolean
	}
	download: {
		required: boolean
		controllableByCli: boolean
	}
	placement: {
		status: PlacementStatus
		enforcement: PlacementEnforcement
		allowExternalStorage: boolean
		likelyExternal: boolean
		effectiveStorageRoot?: string
		targetPathHint?: string
		freeBytes?: number
	}
	warnings: string[]
}

export type BuildModelUsePlanRequest = {
	runtime: SupportedLocalRuntime
	model: string
	storageRoot?: string
	allowExternalStorage?: boolean
	cwd?: string
}

function expandHomePath(input: string): string {
	if (input === "~") {
		return os.homedir()
	}

	if (input.startsWith("~/")) {
		return path.join(os.homedir(), input.slice(2))
	}

	return input
}

function looksLikeLocalPathInput(input: string): boolean {
	return (
		path.isAbsolute(input) ||
		input.startsWith("./") ||
		input.startsWith("../") ||
		input.startsWith("~/") ||
		input === "~" ||
		input.endsWith(".gguf") ||
		input.endsWith(".safetensors")
	)
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath)
		return true
	} catch {
		return false
	}
}

async function findExistingAncestor(targetPath: string): Promise<string | undefined> {
	let currentPath = targetPath
	while (true) {
		if (await pathExists(currentPath)) {
			return currentPath
		}

		const parentPath = path.dirname(currentPath)
		if (parentPath === currentPath) {
			return undefined
		}

		currentPath = parentPath
	}
}

async function getFreeBytes(targetPath: string): Promise<number | undefined> {
	const existingPath = await findExistingAncestor(targetPath)
	if (!existingPath) {
		return undefined
	}

	try {
		const stats = await fs.statfs(existingPath)
		return stats.bavail * stats.bsize
	} catch {
		return undefined
	}
}

function sanitizeModelIdentifier(model: string): string {
	return model.replace(/[^a-zA-Z0-9._-]+/g, "--").replace(/-+/g, "-")
}

function isLikelyExternalPath(targetPath: string): boolean {
	const normalized = path.resolve(targetPath)

	if (process.platform === "darwin") {
		return normalized.startsWith("/Volumes/")
	}

	if (process.platform === "linux") {
		return (
			normalized.startsWith("/media/") || normalized.startsWith("/mnt/") || normalized.startsWith("/run/media/")
		)
	}

	return false
}

async function resolveSource(
	model: string,
	cwd: string,
): Promise<{ kind: ModelSourceKind; resolvedPath?: string; exists?: boolean }> {
	if (looksLikeLocalPathInput(model)) {
		const resolvedPath = path.resolve(cwd, expandHomePath(model))
		const exists = await pathExists(resolvedPath)
		return {
			kind: exists ? "local-path" : "local-path-missing",
			resolvedPath,
			exists,
		}
	}

	const resolvedPath = path.resolve(cwd, model)
	if (await pathExists(resolvedPath)) {
		return {
			kind: "local-path",
			resolvedPath,
			exists: true,
		}
	}

	if (model.includes("/")) {
		return {
			kind: "huggingface-hub",
		}
	}

	return {
		kind: "named-model",
	}
}

export async function buildModelUsePlan(request: BuildModelUsePlanRequest): Promise<ModelUsePlan> {
	const cwd = request.cwd ?? process.cwd()
	const source = await resolveSource(request.model, cwd)
	const warnings: string[] = []
	const allowExternalStorage = request.allowExternalStorage ?? false

	if (source.kind === "local-path" || source.kind === "local-path-missing") {
		const resolvedPath = source.resolvedPath ?? path.resolve(cwd, request.model)
		const likelyExternal = isLikelyExternalPath(resolvedPath)
		const freeBytes = await getFreeBytes(resolvedPath)
		const status: PlacementStatus = !likelyExternal || allowExternalStorage ? "accepted" : "blocked"

		if (source.kind === "local-path-missing") {
			warnings.push(`The local model path does not exist: ${resolvedPath}`)
		}

		if (likelyExternal && !allowExternalStorage) {
			warnings.push("The selected local model path appears to be on external or removable storage.")
		}

		return {
			source: {
				kind: source.kind,
				input: request.model,
				resolvedPath,
				exists: source.exists,
			},
			download: {
				required: false,
				controllableByCli: false,
			},
			placement: {
				status,
				enforcement: "not-applicable",
				allowExternalStorage,
				likelyExternal,
				effectiveStorageRoot: path.dirname(resolvedPath),
				targetPathHint: resolvedPath,
				freeBytes,
			},
			warnings,
		}
	}

	const effectiveStorageRoot = request.storageRoot
		? path.resolve(cwd, expandHomePath(request.storageRoot))
		: undefined
	const likelyExternal = effectiveStorageRoot ? isLikelyExternalPath(effectiveStorageRoot) : false
	const freeBytes = effectiveStorageRoot ? await getFreeBytes(effectiveStorageRoot) : undefined
	const explicitPlacementRequested = Boolean(effectiveStorageRoot)
	const status: PlacementStatus = likelyExternal && !allowExternalStorage ? "blocked" : "accepted"

	if (!effectiveStorageRoot) {
		warnings.push(
			"No explicit storage root was provided. Current live execution still relies on the runtime's default cache path.",
		)
	} else {
		warnings.push(
			"Explicit storage-root planning exists, but live execution still depends on runtime-native placement support.",
		)
	}

	if (likelyExternal && !allowExternalStorage) {
		warnings.push("The requested storage root appears to be on external or removable storage.")
	}

	return {
		source: {
			kind: source.kind,
			input: request.model,
		},
		download: {
			required: true,
			controllableByCli: false,
		},
		placement: {
			status,
			enforcement: explicitPlacementRequested ? "planned-only" : "runtime-default-cache",
			allowExternalStorage,
			likelyExternal,
			effectiveStorageRoot,
			targetPathHint: effectiveStorageRoot
				? path.join(effectiveStorageRoot, request.runtime, sanitizeModelIdentifier(request.model))
				: undefined,
			freeBytes,
		},
		warnings,
	}
}
