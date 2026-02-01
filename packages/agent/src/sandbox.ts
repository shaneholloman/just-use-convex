import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import {
  createTool,
  type FileInfo,
  type FileData,
  type GrepMatch,
  type WriteResult,
  type EditResult,
  type FilesystemBackend,
} from "@voltagent/core";
import { z } from "zod";

type SandboxNamespace = DurableObjectNamespace<Sandbox>;

export class SandboxFilesystemBackend implements FilesystemBackend {
  private sandbox: ReturnType<typeof getSandbox>;
  private rootDir: string;

  constructor(options: {
    sandboxNamespace: SandboxNamespace;
    sandboxId: string;
    rootDir?: string;
  }) {
    this.sandbox = getSandbox(options.sandboxNamespace, options.sandboxId);
    this.rootDir = options.rootDir || "/workspace";
  }

  private resolvePath(path: string): string {
    if (path.startsWith("/")) {
      return path;
    }
    return `${this.rootDir}/${path}`.replace(/\/+/g, "/");
  }

  async lsInfo(path: string): Promise<FileInfo[]> {
    const resolvedPath = this.resolvePath(path);

    try {
      const result = await this.sandbox.exec(
        `ls -la --time-style=+%Y-%m-%dT%H:%M:%S ${resolvedPath} 2>/dev/null || echo "[]"`
      );

      if (!result.success || !result.stdout.trim()) {
        return [];
      }

      const lines = result.stdout.trim().split("\n");
      const files: FileInfo[] = [];

      for (const line of lines) {
        // Skip total line and empty lines
        if (line.startsWith("total") || !line.trim()) continue;

        // Parse ls -la output: permissions links owner group size date name
        const parts = line.split(/\s+/);
        if (parts.length < 7) continue;

        const permissions = parts[0] ?? "";
        const sizeStr = parts[4];
        const size = sizeStr ? parseInt(sizeStr, 10) : NaN;
        const date = parts[5] ?? "";
        const name = parts.slice(6).join(" ");

        // Skip . and ..
        if (name === "." || name === "..") continue;

        files.push({
          path: `${resolvedPath}/${name}`.replace(/\/+/g, "/"),
          is_dir: permissions.startsWith("d"),
          size: isNaN(size) ? undefined : size,
          modified_at: date || undefined,
        });
      }

      return files;
    } catch (error) {
      console.error("lsInfo error:", error);
      return [];
    }
  }

  async read(
    filePath: string,
    offset?: number,
    limit?: number
  ): Promise<string> {
    const resolvedPath = this.resolvePath(filePath);

    let cmd = `cat "${resolvedPath}"`;
    if (offset !== undefined || limit !== undefined) {
      const start = (offset || 0) + 1; // sed is 1-indexed
      if (limit !== undefined) {
        const end = start + limit - 1;
        cmd = `sed -n '${start},${end}p' "${resolvedPath}"`;
      } else {
        cmd = `sed -n '${start},$p' "${resolvedPath}"`;
      }
    }

    const result = await this.sandbox.exec(cmd);

    if (!result.success) {
      throw new Error(`Failed to read file: ${result.stderr}`);
    }

    return result.stdout;
  }

  async readRaw(filePath: string): Promise<FileData> {
    const resolvedPath = this.resolvePath(filePath);

    const [contentResult, statResult] = await Promise.all([
      this.sandbox.exec(`cat "${resolvedPath}"`),
      this.sandbox.exec(
        `stat -c '%Y' "${resolvedPath}" 2>/dev/null || echo "0"`
      ),
    ]);

    if (!contentResult.success) {
      throw new Error(`Failed to read file: ${contentResult.stderr}`);
    }

    const modifiedTimestamp = parseInt(statResult.stdout.trim(), 10) || 0;
    const modifiedAt = new Date(modifiedTimestamp * 1000).toISOString();

    return {
      content: contentResult.stdout.split("\n"),
      created_at: modifiedAt, // Unix doesn't track creation time reliably
      modified_at: modifiedAt,
    };
  }

  async grepRaw(
    pattern: string,
    path?: string | null,
    glob?: string | null
  ): Promise<GrepMatch[] | string> {
    const searchPath = path ? this.resolvePath(path) : this.rootDir;

    // Build grep command
    let cmd: string;
    if (glob) {
      // Use find with grep for glob patterns
      cmd = `find "${searchPath}" -type f -name "${glob}" -exec grep -nH "${pattern}" {} \\; 2>/dev/null || true`;
    } else {
      cmd = `grep -rnH "${pattern}" "${searchPath}" 2>/dev/null || true`;
    }

    const result = await this.sandbox.exec(cmd);

    if (!result.stdout.trim()) {
      return [];
    }

    const matches: GrepMatch[] = [];
    const lines = result.stdout.trim().split("\n");

    for (const line of lines) {
      // Format: filepath:linenum:text
      const match = line.match(/^(.+?):(\d+):(.*)$/);
      if (match && match[1] && match[2] && match[3] !== undefined) {
        matches.push({
          path: match[1],
          line: parseInt(match[2], 10),
          text: match[3],
        });
      }
    }

    return matches;
  }

  async globInfo(pattern: string, path?: string): Promise<FileInfo[]> {
    const searchPath = path ? this.resolvePath(path) : this.rootDir;

    const result = await this.sandbox.exec(
      `find "${searchPath}" -name "${pattern}" -printf '%p\\t%s\\t%T@\\t%y\\n' 2>/dev/null || true`
    );

    if (!result.stdout.trim()) {
      return [];
    }

    const files: FileInfo[] = [];
    const lines = result.stdout.trim().split("\n");

    for (const line of lines) {
      const [filePath, size, mtime, type] = line.split("\t");
      if (!filePath) continue;

      files.push({
        path: filePath,
        is_dir: type === "d",
        size: size ? parseInt(size, 10) : undefined,
        modified_at: mtime
          ? new Date(parseFloat(mtime) * 1000).toISOString()
          : undefined,
      });
    }

    return files;
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    const resolvedPath = this.resolvePath(filePath);

    try {
      // Ensure parent directory exists
      const parentDir = resolvedPath.substring(
        0,
        resolvedPath.lastIndexOf("/")
      );
      await this.sandbox.exec(`mkdir -p "${parentDir}"`);

      // Write file using sandbox's writeFile if available, otherwise use heredoc
      await this.sandbox.writeFile(resolvedPath, content);

      const fileData = await this.readRaw(filePath);

      return {
        path: resolvedPath,
        filesUpdate: {
          [resolvedPath]: fileData,
        },
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean
  ): Promise<EditResult> {
    const resolvedPath = this.resolvePath(filePath);

    try {
      // Read current content
      const currentContent = await this.read(filePath);

      // Count occurrences
      const regex = replaceAll
        ? new RegExp(this.escapeRegex(oldString), "g")
        : new RegExp(this.escapeRegex(oldString));

      const occurrences = (currentContent.match(regex) || []).length;

      if (occurrences === 0) {
        return {
          error: `String not found in file: "${oldString.substring(0, 50)}${oldString.length > 50 ? "..." : ""}"`,
          path: resolvedPath,
          occurrences: 0,
        };
      }

      // Perform replacement
      const newContent = replaceAll
        ? currentContent.replaceAll(oldString, newString)
        : currentContent.replace(oldString, newString);

      // Write back
      await this.sandbox.writeFile(resolvedPath, newContent);

      const fileData = await this.readRaw(filePath);

      return {
        path: resolvedPath,
        filesUpdate: {
          [resolvedPath]: fileData,
        },
        occurrences: replaceAll ? occurrences : 1,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async exec(command: string, options?: { timeout?: number; cwd?: string }): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    const cwd = options?.cwd ? this.resolvePath(options.cwd) : this.rootDir;
    const cmd = `cd "${cwd}" && ${command}`;

    const result = await this.sandbox.exec(cmd);

    return {
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.success ? 0 : 1,
    };
  }
}

export interface BashToolOptions {
  maxOutputChars?: number;
  logDir?: string;
}

export function createBashTool(backend: SandboxFilesystemBackend, options: BashToolOptions = {}) {
  const maxOutputChars = options.maxOutputChars ?? 30000;
  const logDir = options.logDir ?? "/workspace/.logs";

  return createTool({
    name: "bash",
    description: `Execute bash commands in the sandbox environment.

Use this tool for:
- Running build commands (npm, yarn, bun, cargo, etc.)
- Installing dependencies
- Running tests
- Git operations
- Any shell command that needs to be executed

The working directory is /workspace by default. Commands run in an isolated sandbox environment.

Important:
- Commands have a default timeout of 120 seconds
- For long-running commands, consider breaking them into smaller steps
- Use absolute paths or paths relative to /workspace
- If output exceeds ${maxOutputChars} characters, it will be written to a log file that you can explore using grep or read tools`,
    parameters: z.object({
      command: z.string().describe("The bash command to execute"),
      cwd: z.string().optional().describe("Working directory for the command (default: /workspace)"),
      timeout: z.number().optional().describe("Timeout in milliseconds (default: 120000)"),
    }),
    execute: async ({ command, cwd, timeout }) => {
      const result = await backend.exec(command, { cwd, timeout });

      // Format output
      const outputParts: string[] = [];

      if (result.stdout) {
        outputParts.push(result.stdout);
      }

      if (result.stderr) {
        outputParts.push(`[stderr]\n${result.stderr}`);
      }

      if (!result.success) {
        outputParts.push(`[exit code: ${result.exitCode}]`);
      }

      const fullOutput = outputParts.join("\n").trim() || "(no output)";

      // Check if output exceeds limit
      if (fullOutput.length > maxOutputChars) {
        // Generate unique log filename
        const timestamp = Date.now();
        const commandSlug = command.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_");
        const logFile = `${logDir}/bash_${timestamp}_${commandSlug}.log`;

        // Ensure log directory exists and write the full output
        await backend.exec(`mkdir -p "${logDir}"`);
        await backend.write(logFile, fullOutput);

        // Return truncated output with pointer to log file
        const truncatedOutput = fullOutput.slice(0, maxOutputChars);
        const lineCount = fullOutput.split("\n").length;
        const truncatedLineCount = truncatedOutput.split("\n").length;

        return {
          success: result.success,
          output: truncatedOutput,
          exitCode: result.exitCode,
          truncated: true,
          logFile,
          message: `Output truncated (showing ${truncatedLineCount} of ${lineCount} lines, ${maxOutputChars} of ${fullOutput.length} chars). Full output saved to: ${logFile}. Use grep or read tools to explore the log file.`,
        };
      }

      return {
        success: result.success,
        output: fullOutput,
        exitCode: result.exitCode,
        truncated: false,
      };
    },
  });
}
