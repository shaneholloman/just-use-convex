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

// --- Background Task Types ---

/** Callback invoked when a background task completes */
export type TaskCompletionCallback = (task: BackgroundTask) => void | Promise<void>;

/** Status of a background task */
export type BackgroundTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Type of log entry in a background task */
export type BackgroundTaskLogType = "stdout" | "stderr" | "info" | "error";

/** A single log entry from a background task */
export type BackgroundTaskLog = {
  timestamp: number;
  type: BackgroundTaskLogType;
  message: string;
};

/** Internal representation of a background task */
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

/** Result returned when a task is started or converted to background */
export type BackgroundTaskResult = {
  backgroundTaskId: string;
  status: "started" | "converted_to_background";
};

/** Options for runInBackground helper */
export type RunInBackgroundOptions = {
  store: BackgroundTaskStore;
  toolName: string;
  toolArgs: Record<string, unknown>;
  executionPromise: Promise<unknown> | unknown;
  timeoutMs: number;
  /** If provided, task was converted from foreground (affects status) */
  initialLog?: string;
  /** Callback invoked when task completes (success or failure) */
  onComplete?: TaskCompletionCallback;
};

// --- Tool Configuration Types ---

/** Configuration for wrapped tool timeout and background behavior */
export type ToolCallConfig = {
  /** Default timeout in ms (default: 60000ms) */
  duration?: number;
  /** Allow agent to set custom timeout (default: false) */
  allowAgentSetDuration?: boolean;
  /** Max timeout agent can set in ms (default: 1800000ms = 30m) */
  maxAllowedAgentDuration?: number;
  /** Allow agent to run tool in background via background param (default: false) */
  allowBackground?: boolean;
};

/** Extended execute options passed to wrapped tool handlers */
export type WrappedExecuteOptions = ToolExecuteOptions & {
  timeout?: number;
  log?: (entry: { type: BackgroundTaskLogType; message: string }) => void;
};

/** Options for createWrappedTool */
export type WrappedToolOptions = Omit<
  Parameters<typeof createTool>[0],
  "execute" | "parameters"
> & {
  parameters: ZodObject<ZodRawShape>;
  toolCallConfig?: ToolCallConfig;
  store: BackgroundTaskStore;
  execute?: (
    args: Record<string, unknown>,
    options?: WrappedExecuteOptions
  ) => unknown | Promise<unknown>;
};

// --- Utility Types ---

/** A tool or toolkit that can be passed to withBackgroundTaskTools */
export type ToolOrToolkit = BaseTool | Toolkit;


// ============================================================================
// BackgroundTaskStore
// ============================================================================

export class BackgroundTaskStore {
  private tasks = new Map<string, BackgroundTask>();
  private callbacks = new Map<string, TaskCompletionCallback[]>();
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
        this.callbacks.delete(id);
      }
    }
  }

  /**
   * Register a callback to be invoked when a task completes.
   * Returns an unsubscribe function.
   */
  onComplete(taskId: string, callback: TaskCompletionCallback): () => void {
    // Check if task already completed - invoke callback immediately
    const task = this.tasks.get(taskId);
    if (task && (task.status === "completed" || task.status === "failed" || task.status === "cancelled")) {
      void Promise.resolve().then(() => callback(task));
      return () => {};
    }

    const existing = this.callbacks.get(taskId) || [];
    existing.push(callback);
    this.callbacks.set(taskId, existing);

    return () => {
      const cbs = this.callbacks.get(taskId);
      if (cbs) {
        const idx = cbs.indexOf(callback);
        if (idx >= 0) cbs.splice(idx, 1);
      }
    };
  }

  /**
   * Notify all registered callbacks that a task has completed.
   * Called internally after task status changes to completed/failed/cancelled.
   */
  async notifyCompletion(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const callbacks = this.callbacks.get(taskId) || [];
    for (const cb of callbacks) {
      try {
        await cb(task);
      } catch (e) {
        console.error(`Background task completion callback error for ${taskId}:`, e);
      }
    }
    this.callbacks.delete(taskId);
  }
}

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
// Background Task Runner
// ============================================================================

/**
 * Runs a promise as a background task, tracking its progress and result.
 * Returns immediately with task info.
 */
function runInBackground({
  store,
  toolName,
  toolArgs,
  executionPromise,
  timeoutMs,
  initialLog,
  onComplete,
}: RunInBackgroundOptions): BackgroundTaskResult {
  const task = store.create(toolName, toolArgs);
  store.update(task.id, { status: "running" });

  if (initialLog) {
    store.addLog(task.id, { type: "info", message: initialLog });
  }

  // Register completion callback if provided
  if (onComplete) {
    store.onComplete(task.id, onComplete);
  }

  // Fire-and-forget execution
  void (async () => {
    try {
      const result = await executeWithTimeout(
        () => executionPromise,
        timeoutMs,
        task.abortController?.signal
      );

      // Auto-capture stdout/stderr from result
      if (result && typeof result === "object" && result !== null) {
        if ("stdout" in result && typeof result.stdout === "string" && result.stdout) {
          store.addLog(task.id, { type: "stdout", message: result.stdout });
        }
        if ("stderr" in result && typeof result.stderr === "string" && result.stderr) {
          store.addLog(task.id, { type: "stderr", message: result.stderr });
        }
      }

      store.update(task.id, {
        status: "completed",
        completedAt: Date.now(),
        result,
      });
      await store.notifyCompletion(task.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      store.addLog(task.id, { type: "error", message: errorMessage });
      store.update(task.id, {
        status: error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed",
        completedAt: Date.now(),
        error: errorMessage,
      });
      await store.notifyCompletion(task.id);
    }
  })();

  return {
    backgroundTaskId: task.id,
    status: initialLog ? "converted_to_background" : "started",
  };
}

// ============================================================================
// Shared Wrapped Execute Logic
// ============================================================================

const MAX_BACKGROUND_TIMEOUT = 30 * 60 * 1000; // 30 minutes

type ResolvedConfig = {
  duration: number;
  allowAgentSetDuration: boolean;
  allowBackground: boolean;
  maxAllowedAgentDuration: number;
};

function resolveConfig(config: ToolCallConfig): ResolvedConfig {
  const {
    duration = 60000,
    allowAgentSetDuration = false,
    allowBackground = false,
  } = config;
  const maxAllowedAgentDuration = config.maxAllowedAgentDuration
    ?? (allowAgentSetDuration ? duration : 1800000);
  return {
    duration,
    allowAgentSetDuration: allowAgentSetDuration || allowBackground,
    allowBackground,
    maxAllowedAgentDuration,
  };
}

function augmentParametersSchema(
  shape: ZodRawShape,
  config: ResolvedConfig
): ZodObject<ZodRawShape> {
  const augmentedShape: ZodRawShape = { ...shape };

  if (config.allowAgentSetDuration) {
    augmentedShape.timeout = z
      .number()
      .optional()
      .describe(
        `Optional timeout in milliseconds (max: ${config.maxAllowedAgentDuration}ms). Default: ${config.duration}ms`
      );
  }

  if (config.allowBackground) {
    augmentedShape.background = z
      .boolean()
      .optional()
      .describe(
        "Set to true to run this tool in the background. Returns immediately with a task ID."
      );
  }

  return z.object(augmentedShape);
}

function createWrappedExecute(
  toolName: string,
  originalExecute: (args: Record<string, unknown>, opts?: ToolExecuteOptions) => unknown | Promise<unknown>,
  config: ResolvedConfig,
  store: BackgroundTaskStore
) {
  const { duration, allowAgentSetDuration, allowBackground, maxAllowedAgentDuration } = config;

  return async (
    args: Record<string, unknown>,
    opts?: ToolExecuteOptions
  ): Promise<unknown> => {
    const timeout = typeof args.timeout === "number" ? args.timeout : undefined;
    const background = typeof args.background === "boolean" ? args.background : undefined;
    const { timeout: _t, background: _b, ...toolArgs } = args;
    void _t;
    void _b;

    const effectiveTimeout =
      allowAgentSetDuration && timeout !== undefined
        ? Math.min(timeout, maxAllowedAgentDuration)
        : duration;

    if (allowBackground && background) {
      // Extract completion callback from operation context (systemContext is set via onToolStart hook)
      const onComplete = (
        opts?.systemContext?.get?.("onBackgroundTaskComplete") ||
        opts?.context?.get?.("onBackgroundTaskComplete")
      ) as TaskCompletionCallback | undefined;

      return runInBackground({
        store,
        toolName,
        toolArgs,
        executionPromise: originalExecute(toolArgs, opts),
        timeoutMs: effectiveTimeout,
        onComplete,
      });
    }

    const executionPromise = originalExecute(toolArgs, opts);
    const abortSignal = opts?.toolContext?.abortSignal ?? opts?.abortController?.signal;

    try {
      return await executeWithTimeout(
        () => executionPromise,
        effectiveTimeout,
        abortSignal
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("timed out")) {
        return runInBackground({
          store,
          toolName,
          toolArgs,
          executionPromise,
          timeoutMs: MAX_BACKGROUND_TIMEOUT,
          initialLog: `Foreground execution timed out after ${effectiveTimeout}ms, converted to background task`,
        });
      }
      throw error;
    }
  };
}

// ============================================================================
// createWrappedTool
// ============================================================================

/**
 * Creates a tool with configurable timeout and background execution capabilities.
 *
 * @param options - Standard tool options plus toolCallConfig and store
 * @returns A Tool with augmented parameters based on config
 *
 * @example
 * ```ts
 * const store = new BackgroundTaskStore();
 * const myTool = createWrappedTool({
 *   name: "my_tool",
 *   description: "Does something",
 *   parameters: z.object({ input: z.string() }),
 *   store,
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
export function createWrappedTool(options: WrappedToolOptions): BaseTool {
  const { name, description, toolCallConfig = {}, parameters, store, execute } = options;
  const config = resolveConfig(toolCallConfig);

  return createTool({
    name,
    description,
    parameters: augmentParametersSchema(parameters.shape, config),
    execute: createWrappedExecute(name, execute ?? (() => undefined), config, store),
  });
}

// ============================================================================
// Background Task Management Tools
// ============================================================================

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
 * Creates the background task management tools bound to a specific store.
 */
function createBackgroundTaskTools(store: BackgroundTaskStore) {
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
      const task = store.get(taskId);
      if (!task) {
        return { error: `Task not found: ${taskId}` };
      }
      const { logs } = store.getLogs(taskId, offset, limit);
      // Strip timestamps from logs for minimal context
      const minimalLogs = logs.map(({ type, message }) => ({ type, message }));
      return {
        taskId,
        status: task.status,
        logs: minimalLogs,
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

        const task = store.get(taskId);
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
      const { cancelled, previousStatus } = store.cancel(taskId);
      if (previousStatus === null) {
        return { error: `Task not found: ${taskId}` };
      }
      return { taskId, cancelled };
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
      let tasks = store.getAll();

      if (status !== "all") {
        tasks = tasks.filter((t) => t.status === status);
      }

      return {
        tasks: tasks.map((t) => ({ id: t.id, status: t.status })),
      };
    },
  });

  return [
    getBackgroundTaskLogsTool,
    waitForBackgroundTaskTool,
    cancelBackgroundTaskTool,
    listBackgroundTasksTool,
  ];
}

/**
 * Creates a background task management toolkit bound to a specific store.
 *
 * @param store - The BackgroundTaskStore instance to use
 * @returns A Toolkit with tools for managing background tasks
 */
export function createBackgroundTaskToolkit(store: BackgroundTaskStore): Toolkit {
  return createToolkit({
    name: "background_tasks",
    description: "Tools for managing background task execution, monitoring progress, and retrieving results",
    instructions: BACKGROUND_TASK_INSTRUCTIONS,
    tools: createBackgroundTaskTools(store),
  });
}

/**
 * Adds the background task toolkit to a list of tools/toolkits.
 * Background task tools are always needed since any wrapped tool can convert to a
 * background task on timeout.
 *
 * @param tools - Array of tools and/or toolkits
 * @param store - The BackgroundTaskStore instance to use
 * @returns The tools array with backgroundTaskToolkit added
 *
 * @example
 * ```ts
 * const store = new BackgroundTaskStore();
 * const agent = new PlanAgent({
 *   tools: withBackgroundTaskTools([
 *     sandboxToolkit,
 *     webSearchTool,
 *   ], store),
 * });
 * ```
 */
export function withBackgroundTaskTools<T extends ToolOrToolkit>(
  tools: T[],
  store: BackgroundTaskStore
): (T | Toolkit)[] {
  return [...tools, createBackgroundTaskToolkit(store)];
}

/**
 * Patches an existing tool's execute function and parameters to add background task support.
 * Uses Object.defineProperty to modify the tool in-place.
 *
 * @param tool - The tool to patch
 * @param store - The BackgroundTaskStore instance to use
 * @param config - Optional configuration for timeout and background behavior
 *
 * @example
 * ```ts
 * const store = new BackgroundTaskStore();
 * const writeTodos = agent.getTools().find(t => t.name === "write_todos");
 * if (writeTodos) {
 *   patchToolWithBackgroundSupport(writeTodos, store, { duration: 30000, allowBackground: true });
 * }
 * ```
 */
export function patchToolWithBackgroundSupport(
  tool: BaseTool,
  store: BackgroundTaskStore,
  config: ToolCallConfig = {}
): void {
  const originalExecute = tool.execute;
  if (!originalExecute) return;

  const resolvedConfig = resolveConfig(config);

  // Patch execute function
  Object.defineProperty(tool, "execute", {
    value: createWrappedExecute(tool.name, originalExecute, resolvedConfig, store),
    writable: true,
    configurable: true,
  });

  // Patch parameters schema to include timeout/background fields
  const originalParams = tool.parameters;
  if (originalParams && typeof originalParams === "object" && "shape" in originalParams) {
    Object.defineProperty(tool, "parameters", {
      value: augmentParametersSchema(
        (originalParams as ZodObject<ZodRawShape>).shape,
        resolvedConfig
      ),
      writable: true,
      configurable: true,
    });
  }
}
