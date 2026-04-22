import type { JsonEventEmitter } from "@/agent/json-event-emitter.js"
import { TextSessionSurface } from "@/agent/text-session-surface.js"
import type { CliSessionLifecycle } from "@/runtime/session-lifecycle.js"
import type { CliRuntime } from "@/runtime/runtime.js"

export interface NonInteractiveSessionLifecycleOptions {
	useJsonOutput: boolean
	jsonEmitter: JsonEventEmitter | null
	nonInteractive: boolean
	exitOnError?: boolean
	stdinPromptStream?: boolean
	bootstrapResumeForStdinStream?: (runtime: CliRuntime, sessionId: string) => Promise<void>
}

export function createNonInteractiveSessionLifecycle({
	useJsonOutput,
	jsonEmitter,
	nonInteractive,
	exitOnError,
	stdinPromptStream,
	bootstrapResumeForStdinStream,
}: NonInteractiveSessionLifecycleOptions): CliSessionLifecycle {
	let textSurface: TextSessionSurface | null = null

	return {
		afterActivate: (runtime, controller) => {
			if (!useJsonOutput) {
				textSurface = new TextSessionSurface(runtime, {
					nonInteractive,
					exitOnError,
				})
				textSurface.attach()
			}

			if (jsonEmitter) {
				controller.attachJsonEmitter(jsonEmitter)
			}
		},
		onResume:
			stdinPromptStream && bootstrapResumeForStdinStream
				? async (launch, controller) => {
						await bootstrapResumeForStdinStream(controller.getRuntimeOrThrow(), launch.sessionId)
					}
				: undefined,
		dispose: async () => {
			if (!textSurface) {
				return
			}

			await textSurface.dispose()
			textSurface = null
		},
	}
}
