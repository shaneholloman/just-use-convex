import { escapeShellArg } from "../shared";
import type { SandboxInstance } from "./daytona";

type ExecLogEntry = { type: "stdout" | "stderr" | "info" | "error"; message: string };

type ExecOptions = {
  timeout?: number;
  cwd?: string;
  abortSignal?: AbortSignal;
  streamLogs?: (entry: ExecLogEntry) => void;
};

export async function runSandboxCommand(
  sandbox: SandboxInstance,
  command: string,
  defaultRootDir: string,
  resolvePath: (path: string, rootDir: string) => string,
  options?: ExecOptions
): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const providedCwd = typeof options?.cwd === "string" ? options.cwd.trim() : "";
  const cwd = providedCwd ? resolvePath(providedCwd, defaultRootDir) : defaultRootDir;
  const escapedCwd = escapeShellArg(cwd);
  const cmd = `cd ${escapedCwd} && ${command}`;
  const timeoutMs = options?.timeout ? Math.max(1, Math.ceil(options.timeout)) : undefined;
  const streamLogs = options?.streamLogs;
  const sessionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  await sandbox.process.createSession(sessionId);

  let stdout = "";
  let stderr = "";
  let logStreamPromise: Promise<void> | undefined;
  const startedAt = Date.now();

  try {
    const runResponse = await sandbox.process.executeSessionCommand(sessionId, {
      command: cmd,
      runAsync: true,
    });
    const commandId = runResponse.cmdId;

    if (!commandId) {
      const fallbackStdout = runResponse.stdout ?? "";
      const fallbackStderr = runResponse.stderr ?? "";
      if (fallbackStdout && streamLogs) {
        streamLogs({ type: "stdout", message: fallbackStdout });
      }
      if (fallbackStderr && streamLogs) {
        streamLogs({ type: "stderr", message: fallbackStderr });
      }
      return {
        success: (runResponse.exitCode ?? 1) === 0,
        stdout: fallbackStdout,
        stderr: fallbackStderr,
        exitCode: runResponse.exitCode ?? 1,
      };
    }

    if (streamLogs) {
      logStreamPromise = sandbox.process
        .getSessionCommandLogs(
          sessionId,
          commandId,
          (chunk) => {
            if (!chunk) return;
            stdout += chunk;
            streamLogs({ type: "stdout", message: chunk });
          },
          (chunk) => {
            if (!chunk) return;
            stderr += chunk;
            streamLogs({ type: "stderr", message: chunk });
          }
        )
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          streamLogs({ type: "error", message: `log stream error: ${message}` });
        });
    }

    let exitCode = 1;

    while (true) {
      if (options?.abortSignal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      if (timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Command timed out after ${timeoutMs}ms`);
      }

      const commandState = await sandbox.process.getSessionCommand(sessionId, commandId);
      if (typeof commandState.exitCode === "number") {
        exitCode = commandState.exitCode;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    if (streamLogs) {
      await logStreamPromise;
    } else {
      const logs = await sandbox.process.getSessionCommandLogs(sessionId, commandId).catch(() => null);
      stdout = logs?.stdout ?? "";
      stderr = logs?.stderr ?? "";
    }

    return {
      success: exitCode === 0,
      stdout,
      stderr,
      exitCode,
    };
  } finally {
    await sandbox.process.deleteSession(sessionId).catch(() => {});
  }
}
