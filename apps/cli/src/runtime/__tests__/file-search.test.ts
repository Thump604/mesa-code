import { describe, expect, it, vi, beforeEach } from "vitest"

import { clearWorkspaceFileSearchCache, searchWorkspaceFiles, type FileSearchResult } from "../file-search.js"

describe("searchWorkspaceFiles", () => {
	beforeEach(() => {
		clearWorkspaceFileSearchCache()
	})

	it("filters .rooignore results by default", async () => {
		const loadWorkspaceIndex = vi.fn().mockResolvedValue([
			{ path: "src/index.ts", type: "file", label: "index.ts" },
			{ path: "src", type: "folder", label: "src" },
			{ path: "secrets/token.txt", type: "file", label: "token.txt" },
		] satisfies FileSearchResult[])

		const results = await searchWorkspaceFiles(
			{
				workspacePath: "/workspace",
				query: "",
			},
			{
				loadWorkspaceIndex,
				loadRooIgnorePatterns: vi.fn().mockResolvedValue("secrets/\n"),
				realpathSync: vi.fn((filePath: string) => filePath),
				now: vi.fn().mockReturnValue(0),
			},
		)

		expect(results).toEqual([
			{ path: "src/index.ts", type: "file", label: "index.ts" },
			{ path: "src", type: "folder", label: "src" },
		])
	})

	it("can show .rooignore results when requested", async () => {
		const loadWorkspaceIndex = vi.fn().mockResolvedValue([
			{ path: "src/index.ts", type: "file", label: "index.ts" },
			{ path: "secrets/token.txt", type: "file", label: "token.txt" },
		] satisfies FileSearchResult[])

		const loadRooIgnorePatterns = vi.fn().mockResolvedValue("secrets/\n")

		const results = await searchWorkspaceFiles(
			{
				workspacePath: "/workspace",
				query: "",
				showRooIgnoredFiles: true,
			},
			{
				loadWorkspaceIndex,
				loadRooIgnorePatterns,
				realpathSync: vi.fn((filePath: string) => filePath),
				now: vi.fn().mockReturnValue(0),
			},
		)

		expect(loadRooIgnorePatterns).not.toHaveBeenCalled()
		expect(results).toEqual([
			{ path: "src/index.ts", type: "file", label: "index.ts" },
			{ path: "secrets/token.txt", type: "file", label: "token.txt" },
		])
	})

	it("reuses the cached workspace index across searches", async () => {
		const loadWorkspaceIndex = vi
			.fn()
			.mockResolvedValue([{ path: "src/index.ts", type: "file", label: "index.ts" }] satisfies FileSearchResult[])
		const now = vi.fn().mockReturnValue(10)

		await searchWorkspaceFiles(
			{
				workspacePath: "/workspace",
				query: "",
			},
			{
				loadWorkspaceIndex,
				loadRooIgnorePatterns: vi.fn().mockResolvedValue(null),
				realpathSync: vi.fn((filePath: string) => filePath),
				now,
			},
		)

		await searchWorkspaceFiles(
			{
				workspacePath: "/workspace",
				query: "index",
			},
			{
				loadWorkspaceIndex,
				loadRooIgnorePatterns: vi.fn().mockResolvedValue(null),
				realpathSync: vi.fn((filePath: string) => filePath),
				now,
			},
		)

		expect(loadWorkspaceIndex).toHaveBeenCalledTimes(1)
	})
})
