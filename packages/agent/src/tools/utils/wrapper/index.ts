import { createTool, type BaseTool } from "@voltagent/core";
import { runInBackground } from "./background";
import { createWrappedExecute, augmentParametersSchema, isZodObjectSchema } from "./tool";
import { isToolTimeoutError } from "./timeout";
import type {
  BackgroundTaskStoreApi,
  BeforeFailureHook,
  StartBackgroundTask,
  ToolCallConfig,
  WrappedToolOptions,
} from "./types";

function createStartBackgroundTask(store: BackgroundTaskStoreApi): StartBackgroundTask {
  return ({ initialLog, ...input }) => {
    const backgroundResult = runInBackground({ store, ...input });
    if (typeof initialLog === "string" && initialLog.trim().length > 0) {
      store.addLog(backgroundResult.backgroundTaskId, {
        type: "info",
        message: initialLog.trim(),
      });
    }
    return backgroundResult;
  };
}

function createTimeoutPromotionHook(startBackgroundTask: StartBackgroundTask): BeforeFailureHook {
  return async ({
    error,
    toolCallId,
    toolName,
    toolArgs,
    executionFactory,
    maxAllowedDuration,
  }) => {
    if (!isToolTimeoutError(error)) {
      return undefined;
    }

    return startBackgroundTask({
      toolCallId,
      toolName,
      toolArgs,
      executionFactory,
      timeoutMs: maxAllowedDuration,
      initialLog: `Foreground execution timed out. Continued in background for up to ${maxAllowedDuration}ms.`,
    });
  };
}

export function createWrappedTool(options: WrappedToolOptions): BaseTool {
  const { name, description, parameters, toolCallConfig, store, execute } = options;
  const config = toolCallConfig ?? {};
  const startBackgroundTask = createStartBackgroundTask(store);

  return createTool({
    name,
    description,
    parameters: augmentParametersSchema(parameters.shape, config),
    execute: createWrappedExecute({
      toolName: name,
      execute: execute ?? (() => undefined),
      config,
      startBackground: startBackgroundTask,
      beforeFailureHooks: [createTimeoutPromotionHook(startBackgroundTask)],
    }),
  });
}

export function patchToolWithBackgroundSupport(
  tool: BaseTool,
  store: BackgroundTaskStoreApi,
  config: ToolCallConfig = {}
): void {
  if (!tool.execute) {
    return;
  }

  const startBackgroundTask = createStartBackgroundTask(store);

  Object.defineProperty(tool, "execute", {
    value: createWrappedExecute({
      toolName: tool.name,
      execute: tool.execute,
      config,
      startBackground: startBackgroundTask,
      beforeFailureHooks: [createTimeoutPromotionHook(startBackgroundTask)],
    }),
    writable: true,
    configurable: true,
  });

  if (isZodObjectSchema(tool.parameters)) {
    Object.defineProperty(tool, "parameters", {
      value: augmentParametersSchema(tool.parameters.shape, config),
      writable: true,
      configurable: true,
    });
  }
}

export { BackgroundTaskStore, runInBackground } from "./background";
export { createBackgroundTaskToolkit, withBackgroundTaskTools } from "./tools";
export { DEFAULT_MAX_DURATION_MS } from "./tool";
export { TERMINAL_STATUSES } from "./types";
export type {
  BackgroundTask,
  BackgroundTaskLog,
  BackgroundTaskLogType,
  BackgroundTaskResult,
  BackgroundTaskStatus,
  BackgroundTaskStoreApi,
  BeforeFailureHook,
  BeforeFailureHookContext,
  ExecutionFactory,
  RunInBackgroundOptions,
  StartBackgroundTask,
  StartBackgroundTaskInput,
  ToolCallConfig,
  ToolOrToolkit,
  WrappedExecuteFactoryOptions,
  WrappedExecuteOptions,
  WrappedToolOptions,
} from "./types";
