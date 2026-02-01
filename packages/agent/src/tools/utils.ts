import {
  createTool,
  createToolkit,
  type BaseTool,
  type Toolkit,
  type ToolExecuteOptions,
} from "@voltagent/core";
import { z, type ZodObject, type ZodRawShape } from "zod";

// ============================================================================
// Types
// ============================================================================

export type BackgroundTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type BackgroundTaskLogType = "stdout" | "stderr" | "info" | "error";

export type BackgroundTaskLog = {
  timestamp: number;
  type: BackgroundTaskLogType;
  message: string;
};

export type BackgroundTask = {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  status: BackgroundTaskStatus;
  startedAt: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  logs: BackgroundTaskLog[];
  abortController?: AbortController;
};

export type ToolCallConfig = {
  /** Default timeout in ms (default: 60000ms) */
  duration?: number;
  /** Allow agent to set custom timeout (default: false) */
  allowAgentSetDuration?: boolean;
  /** Max timeout agent can set in ms (default: 1800000ms = 30m), if allowAgentSetDuration is true and maxAllowedAgentDuration is not set, it will be set to duration*/
  maxAllowedAgentDuration?: number;
  /** Allow agent to run tool in background (default: false), if allowAgentSetDuration is true, make sure to include the args for em */
  allowBackground?: boolean;
};

export type WrappedExecuteOptions = ToolExecuteOptions & {
  timeout?: number;
  log?: (entry: { type: BackgroundTaskLogType; message: string }) => void;
};

/** Symbol to mark tools that have background execution enabled */
export const BACKGROUND_ENABLED: unique symbol = Symbol.for("backgroundEnabled");

/** Tool with background enabled marker */
interface BackgroundMarkedTool extends BaseTool {
  [BACKGROUND_ENABLED]?: boolean;
}

/** Type guard for background-marked tools */
function isBackgroundMarked(tool: unknown): tool is BackgroundMarkedTool {
  return (
    typeof tool === "object" &&
    tool !== null &&
    BACKGROUND_ENABLED in tool
  );
}

// ============================================================================
// BackgroundTaskStore
// ============================================================================

class BackgroundTaskStore {
  private tasks = new Map<string, BackgroundTask>();
  private idCounter = 0;

  generateId(): string {
    return `bg_${Date.now()}_${++this.idCounter}`;
  }

  create(toolName: string, args: Record<string, unknown>): BackgroundTask {
    const task: BackgroundTask = {
      id: this.generateId(),
      toolName,
      args,
      status: "pending",
      startedAt: Date.now(),
      logs: [],
      abortController: new AbortController(),
    };
    this.tasks.set(task.id, task);
    return task;
  }

  get(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  getAll(): BackgroundTask[] {
    return Array.from(this.tasks.values());
  }

  update(id: string, updates: Partial<BackgroundTask>): void {
    const task = this.tasks.get(id);
    if (task) {
      Object.assign(task, updates);
    }
  }

  addLog(id: string, log: Omit<BackgroundTaskLog, "timestamp">): void {
    const task = this.tasks.get(id);
    if (task) {
      task.logs.push({ ...log, timestamp: Date.now() });
    }
  }

  getLogs(
    id: string,
    offset = 0,
    limit = 100
  ): { logs: BackgroundTaskLog[]; total: number; hasMore: boolean } {
    const task = this.tasks.get(id);
    if (!task) {
      return { logs: [], total: 0, hasMore: false };
    }
    const total = task.logs.length;
    const logs = task.logs.slice(offset, offset + limit);
    return { logs, total, hasMore: offset + limit < total };
  }

  cancel(id: string): { cancelled: boolean; previousStatus: BackgroundTaskStatus | null } {
    const task = this.tasks.get(id);
    if (!task) {
      return { cancelled: false, previousStatus: null };
    }
    const previousStatus = task.status;
    if (task.status === "running" || task.status === "pending") {
      task.abortController?.abort();
      task.status = "cancelled";
      task.completedAt = Date.now();
      return { cancelled: true, previousStatus };
    }
    return { cancelled: false, previousStatus };
  }

  cleanup(maxAgeMs = 3600000): void {
    const now = Date.now();
    for (const [id, task] of this.tasks) {
      if (task.completedAt && now - task.completedAt > maxAgeMs) {
        this.tasks.delete(id);
      }
    }
  }
}

export const backgroundTaskStore = new BackgroundTaskStore();

// ============================================================================
// Timeout Utility
// ============================================================================

async function executeWithTimeout<R>(
  fn: () => R | Promise<R> | undefined,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<R | undefined> {
  if (abortSignal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  return new Promise<R | undefined>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      if (!settled) {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      }
    };

    abortSignal?.addEventListener("abort", onAbort);

    timeoutId = setTimeout(() => {
      if (!settled) {
        cleanup();
        reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    Promise.resolve(fn())
      .then((result) => {
        if (!settled) {
          cleanup();
          resolve(result);
        }
      })
      .catch((error) => {
        if (!settled) {
          cleanup();
          reject(error);
        }
      });
  });
}

// ============================================================================
// createWrappedTool
// ============================================================================

type WrappedToolOptions = Omit<
  Parameters<typeof createTool>[0],
  "execute" | "parameters"
> & {
  parameters: ZodObject<ZodRawShape>;
  toolCallConfig?: ToolCallConfig;
  execute?: (
    args: Record<string, unknown>,
    options?: WrappedExecuteOptions
  ) => unknown | Promise<unknown>;
};

/**
 * Creates a tool with configurable timeout and background execution capabilities.
 *
 * @param options - Standard tool options plus toolCallConfig
 * @returns A Tool with augmented parameters based on config
 *
 * @example
 * ```ts
 * const myTool = createWrappedTool({
 *   name: "my_tool",
 *   description: "Does something",
 *   parameters: z.object({ input: z.string() }),
 *   toolCallConfig: {
 *     duration: 30000,
 *     allowAgentSetDuration: true,
 *     allowBackground: true,
 *   },
 *   execute: async ({ input }, options) => {
 *     // options.log?.({ type: 'info', message: 'Processing...' })
 *     return { result: input.toUpperCase() };
 *   },
 * });
 * ```
 */
export function createWrappedTool(options: WrappedToolOptions): BackgroundMarkedTool {
  const { name, description, toolCallConfig = {}, parameters, execute } = options;

  const {
    duration = 60000,
    allowAgentSetDuration = false,
    allowBackground = false,
  } = toolCallConfig;

  // If allowAgentSetDuration is true and maxAllowedAgentDuration is not set, default to duration
  const maxAllowedAgentDuration = toolCallConfig.maxAllowedAgentDuration
    ?? (allowAgentSetDuration ? duration : 1800000);

  // If allowBackground is true, also enable agent timeout control
  const effectiveAllowAgentSetDuration = allowAgentSetDuration || allowBackground;

  // Build augmented schema
  const augmentedShape: ZodRawShape = { ...parameters.shape };

  if (effectiveAllowAgentSetDuration) {
    augmentedShape.timeout = z
      .number()
      .optional()
      .describe(
        `Optional timeout in milliseconds (max: ${maxAllowedAgentDuration}ms). Default: ${duration}ms`
      );
  }

  if (allowBackground) {
    augmentedShape.background = z
      .boolean()
      .optional()
      .describe(
        "Set to true to run this tool in the background. Returns immediately with a task ID."
      );
  }

  const augmentedParameters = z.object(augmentedShape);

  // Wrapped execute function
  const wrappedExecute = async (
    args: Record<string, unknown>,
    opts?: ToolExecuteOptions
  ): Promise<unknown> => {
    // Extract control params
    const timeout = typeof args.timeout === "number" ? args.timeout : undefined;
    const background = typeof args.background === "boolean" ? args.background : undefined;
    const { timeout: _t, background: _b, ...toolArgs } = args;
    void _t;
    void _b;

    // Calculate effective timeout:
    // - If agent can set duration AND provides a timeout → use it (capped by max)
    // - Otherwise → fallback to default duration
    const effectiveTimeout =
      effectiveAllowAgentSetDuration && timeout !== undefined
        ? Math.min(timeout, maxAllowedAgentDuration)
        : duration;

    // Build execute options with log callback
    const buildExecOptions = (logCallback?: (entry: { type: BackgroundTaskLogType; message: string }) => void, abortController?: AbortController): WrappedExecuteOptions => ({
      ...opts,
      ...(logCallback && { log: logCallback }),
      ...(abortController && { abortController }),
    });

    // Handle background execution
    if (allowBackground && background) {
      const task = backgroundTaskStore.create(name, toolArgs);
      backgroundTaskStore.update(task.id, { status: "running" });

      // Log callback for background task
      const logCallback = (entry: { type: BackgroundTaskLogType; message: string }) => {
        backgroundTaskStore.addLog(task.id, entry);
      };

      // Fire-and-forget execution
      void (async () => {
        try {
          const result = await executeWithTimeout(
            () => execute?.(toolArgs, buildExecOptions(logCallback, task.abortController)),
            effectiveTimeout,
            task.abortController?.signal
          );

          // Auto-capture stdout/stderr from result
          if (result && typeof result === "object" && result !== null) {
            if ("stdout" in result && typeof result.stdout === "string" && result.stdout) {
              backgroundTaskStore.addLog(task.id, { type: "stdout", message: result.stdout });
            }
            if ("stderr" in result && typeof result.stderr === "string" && result.stderr) {
              backgroundTaskStore.addLog(task.id, { type: "stderr", message: result.stderr });
            }
          }

          backgroundTaskStore.update(task.id, {
            status: "completed",
            completedAt: Date.now(),
            result,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          backgroundTaskStore.addLog(task.id, { type: "error", message: errorMessage });
          backgroundTaskStore.update(task.id, {
            status: error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed",
            completedAt: Date.now(),
            error: errorMessage,
          });
        }
      })();

      // Return immediately with task info
      return {
        backgroundTaskId: task.id,
        status: "started",
        toolName: name,
        message: `Task started in background. Use get_background_task_logs or wait_for_background_task to check progress.`,
      };
    }

    // Foreground execution with timeout
    return executeWithTimeout(
      () => execute?.(toolArgs, opts),
      effectiveTimeout,
      opts?.toolContext?.abortSignal ?? opts?.abortController?.signal
    );
  };

  const tool: BackgroundMarkedTool = Object.assign(
    createTool({
      name,
      description,
      parameters: augmentedParameters,
      execute: wrappedExecute,
    }),
    { [BACKGROUND_ENABLED]: allowBackground }
  );

  return tool;
}

// ============================================================================
// Background Task Management Tools
// ============================================================================

const getBackgroundTaskLogsTool = createTool({
  name: "get_background_task_logs",
  description: `Get logs from a background task.

Use this to check the progress and output of a task running in the background.
Returns the task status, logs, and pagination info.`,
  parameters: z.object({
    taskId: z.string().describe("The background task ID"),
    offset: z.number().default(0).describe("Log offset (default: 0)"),
    limit: z
      .number()
      .default(100)
      .describe("Max logs to return (default: 100)"),
  }),
  execute: async ({ taskId, offset, limit }) => {
    const task = backgroundTaskStore.get(taskId);
    if (!task) {
      return { error: `Task not found: ${taskId}` };
    }
    const { logs, total, hasMore } = backgroundTaskStore.getLogs(
      taskId,
      offset,
      limit
    );
    return {
      taskId,
      toolName: task.toolName,
      status: task.status,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      logs,
      totalLogs: total,
      hasMore,
      ...(task.status === "completed" && { result: task.result }),
      ...(task.status === "failed" && { error: task.error }),
    };
  },
});

const waitForBackgroundTaskTool = createTool({
  name: "wait_for_background_task",
  description: `Wait for a background task to complete.

Polls the task status until it completes, fails, or times out.
Returns the final status and result.`,
  parameters: z.object({
    taskId: z.string().describe("The background task ID"),
    pollIntervalMs: z
      .number()
      .default(1000)
      .describe("Poll interval in ms (default: 1000)"),
    timeoutMs: z
      .number()
      .default(300000)
      .describe("Max wait time in ms (default: 300000 = 5 min)"),
  }),
  execute: async ({ taskId, pollIntervalMs, timeoutMs }, opts) => {
    const startTime = Date.now();
    const abortSignal =
      opts?.toolContext?.abortSignal ?? opts?.abortController?.signal;

    while (Date.now() - startTime < timeoutMs) {
      if (abortSignal?.aborted) {
        return { taskId, status: "wait_aborted", message: "Wait was aborted" };
      }

      const task = backgroundTaskStore.get(taskId);
      if (!task) {
        return { error: `Task not found: ${taskId}` };
      }

      if (
        task.status === "completed" ||
        task.status === "failed" ||
        task.status === "cancelled"
      ) {
        return {
          taskId,
          status: task.status,
          duration: (task.completedAt ?? Date.now()) - task.startedAt,
          ...(task.status === "completed" && { result: task.result }),
          ...(task.status === "failed" && { error: task.error }),
        };
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return {
      taskId,
      status: "wait_timeout",
      message: `Task did not complete within ${timeoutMs}ms`,
    };
  },
});

const cancelBackgroundTaskTool = createTool({
  name: "cancel_background_task",
  description: `Cancel a running background task.

Attempts to abort the task execution. Only works for tasks that are still running or pending.`,
  parameters: z.object({
    taskId: z.string().describe("The background task ID to cancel"),
  }),
  execute: async ({ taskId }) => {
    const { cancelled, previousStatus } = backgroundTaskStore.cancel(taskId);
    if (previousStatus === null) {
      return { error: `Task not found: ${taskId}` };
    }
    return {
      taskId,
      cancelled,
      previousStatus,
      message: cancelled
        ? "Task cancelled successfully"
        : `Cannot cancel task with status: ${previousStatus}`,
    };
  },
});

const listBackgroundTasksTool = createTool({
  name: "list_background_tasks",
  description: `List all background tasks.

Returns a summary of all tasks with their status.
Useful for checking what tasks are running or have completed.`,
  parameters: z.object({
    status: z
      .enum(["all", "pending", "running", "completed", "failed", "cancelled"])
      .default("all")
      .describe("Filter by status (default: all)"),
  }),
  execute: async ({ status }) => {
    let tasks = backgroundTaskStore.getAll();

    if (status !== "all") {
      tasks = tasks.filter((t) => t.status === status);
    }

    return {
      tasks: tasks.map((t) => ({
        id: t.id,
        toolName: t.toolName,
        status: t.status,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        duration: t.completedAt
          ? t.completedAt - t.startedAt
          : Date.now() - t.startedAt,
        logsCount: t.logs.length,
      })),
      total: tasks.length,
    };
  },
});

const BACKGROUND_TASK_INSTRUCTIONS = `You have access to background task management tools for monitoring and controlling long-running operations.

## Background Tasks

When a tool is executed with \`background: true\`, it runs asynchronously and returns a task ID immediately. Use these tools to manage background tasks:

- **get_background_task_logs**: Check progress, view logs, and get results
- **wait_for_background_task**: Block until a task completes (with timeout)
- **cancel_background_task**: Abort a running task
- **list_background_tasks**: See all tasks and their status

## Workflow

1. Start a tool in background: \`{ "background": true, ... }\`
2. Get the returned \`backgroundTaskId\`
3. Either poll with \`get_background_task_logs\` or block with \`wait_for_background_task\`
4. Cancel if needed with \`cancel_background_task\`

Tasks persist in memory for the agent session. Use \`list_background_tasks\` to see all tasks.
`;

/**
 * Background task management toolkit for monitoring and controlling long-running operations.
 */
export const backgroundTaskToolkit = createToolkit({
  name: "background_tasks",
  description: "Tools for managing background task execution, monitoring progress, and retrieving results",
  instructions: BACKGROUND_TASK_INSTRUCTIONS,
  tools: [
    getBackgroundTaskLogsTool,
    waitForBackgroundTaskTool,
    cancelBackgroundTaskTool,
    listBackgroundTasksTool,
  ],
});

type ToolOrToolkit = BaseTool | Toolkit;

/**
 * Checks if a tool has background execution enabled.
 */
export function hasBackgroundEnabled(tool: unknown): boolean {
  return isBackgroundMarked(tool) && tool[BACKGROUND_ENABLED] === true;
}

/**
 * Processes a list of tools/toolkits and automatically adds the background task toolkit
 * if any tool has background execution enabled.
 *
 * Use this at the agent level when combining tools and toolkits.
 *
 * @param tools - Array of tools and/or toolkits
 * @returns The tools array with backgroundTaskToolkit added if needed
 *
 * @example
 * ```ts
 * const agent = new PlanAgent({
 *   tools: withBackgroundTaskTools([
 *     sandboxToolkit,
 *     webSearchTool,
 *   ]),
 * });
 * ```
 */
export function withBackgroundTaskTools<T extends ToolOrToolkit>(
  tools: T[]
): (T | Toolkit)[] {
  const hasBackground = tools.some((tool) => {
    // Check if it's a toolkit with tools
    if ("tools" in tool && Array.isArray(tool.tools)) {
      return tool.tools.some(hasBackgroundEnabled);
    }
    // Check individual tool
    return hasBackgroundEnabled(tool);
  });

  if (hasBackground) {
    return [...tools, backgroundTaskToolkit];
  }

  return tools;
}
