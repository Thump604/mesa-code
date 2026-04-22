import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"

import { API } from "../api"
import { ClineProvider } from "../../core/webview/ClineProvider"

vi.mock("vscode")
vi.mock("../../core/webview/ClineProvider")

describe("API - Approval Buttons", () => {
	let api: API
	let mockOutputChannel: vscode.OutputChannel
	let mockProvider: ClineProvider
	let mockPostMessageToWebview: ReturnType<typeof vi.fn>
	let mockApproveAsk: ReturnType<typeof vi.fn>
	let mockDenyAsk: ReturnType<typeof vi.fn>
	let mockLog: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockOutputChannel = {
			appendLine: vi.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessageToWebview = vi.fn().mockResolvedValue(undefined)
		mockApproveAsk = vi.fn()
		mockDenyAsk = vi.fn()

		mockProvider = {
			context: {} as vscode.ExtensionContext,
			postMessageToWebview: mockPostMessageToWebview,
			on: vi.fn(),
			getCurrentTaskStack: vi.fn().mockReturnValue([]),
			getCurrentTask: vi.fn().mockReturnValue({
				approveAsk: mockApproveAsk,
				denyAsk: mockDenyAsk,
			}),
			viewLaunched: true,
		} as unknown as ClineProvider

		mockLog = vi.fn()
		api = new API(mockOutputChannel, mockProvider, undefined, true)
		;(api as any).log = mockLog
	})

	it("routes primary approval directly to the live task when one exists", async () => {
		await api.pressPrimaryButton()

		expect(mockApproveAsk).toHaveBeenCalledOnce()
		expect(mockPostMessageToWebview).not.toHaveBeenCalled()
	})

	it("routes primary approval directly to the task in headless mode", async () => {
		;(mockProvider as unknown as { viewLaunched: boolean }).viewLaunched = false

		await api.pressPrimaryButton()

		expect(mockApproveAsk).toHaveBeenCalledOnce()
		expect(mockPostMessageToWebview).not.toHaveBeenCalled()
	})

	it("routes secondary approval directly to the task in headless mode", async () => {
		;(mockProvider as unknown as { viewLaunched: boolean }).viewLaunched = false

		await api.pressSecondaryButton()

		expect(mockDenyAsk).toHaveBeenCalledOnce()
		expect(mockPostMessageToWebview).not.toHaveBeenCalled()
	})

	it("logs and drops approval actions when no headless task exists", async () => {
		;(mockProvider as unknown as { viewLaunched: boolean }).viewLaunched = false
		;(mockProvider.getCurrentTask as ReturnType<typeof vi.fn>).mockReturnValue(undefined)

		await api.pressPrimaryButton()
		await api.pressSecondaryButton()

		expect(mockLog).toHaveBeenCalledWith(
			"[API#pressPrimaryButton] no current task in headless mode; approval dropped",
		)
		expect(mockLog).toHaveBeenCalledWith(
			"[API#pressSecondaryButton] no current task in headless mode; rejection dropped",
		)
	})

	it("falls back to webview button invokes when there is no task but the view is live", async () => {
		;(mockProvider.getCurrentTask as ReturnType<typeof vi.fn>).mockReturnValue(undefined)

		await api.pressPrimaryButton()
		await api.pressSecondaryButton()

		expect(mockPostMessageToWebview).toHaveBeenCalledWith({ type: "invoke", invoke: "primaryButtonClick" })
		expect(mockPostMessageToWebview).toHaveBeenCalledWith({ type: "invoke", invoke: "secondaryButtonClick" })
	})
})
