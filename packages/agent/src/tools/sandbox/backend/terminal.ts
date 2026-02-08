import { callable } from "agents";
import { AIChatAgent } from "@cloudflare/ai-chat";
import type { PtyHandle } from "@daytonaio/sdk";
import type { worker } from "../../../../alchemy.run";
import { getSandbox, type SandboxInstance } from "./daytona";

type TerminalChunk = {
  offset: number;
  data: string;
};

export type PtyTerminalSession = {
  sandbox: SandboxInstance;
  ptyHandle: PtyHandle;
  chunks: TerminalChunk[];
  nextSeq: number;
  connected: boolean;
  closed: boolean;
  closeReason: string | null;
  lastUsedAt: number;
};

export type PtyTerminalSessions = Map<string, PtyTerminalSession>;

export type OpenPtyTerminalParams = {
  env: typeof worker.Env;
  sandboxName: string;
  sessions: PtyTerminalSessions;
  waitUntil: (promise: Promise<unknown>) => void;
  cols?: number;
  rows?: number;
};

export type ReadPtyTerminalParams = {
  sessions: PtyTerminalSessions;
  terminalId: string;
  offset?: number;
};

export type WritePtyTerminalParams = {
  sessions: PtyTerminalSessions;
  terminalId: string;
  data: string;
};

export type ResizePtyTerminalParams = {
  sessions: PtyTerminalSessions;
  terminalId: string;
  cols: number;
  rows: number;
};

export type ClosePtyTerminalParams = {
  sessions: PtyTerminalSessions;
  terminalId: string;
};

export function createPtyTerminalSessions(): PtyTerminalSessions {
  return new Map<string, PtyTerminalSession>();
}

async function closePtyTerminalSession(
  sessions: PtyTerminalSessions,
  terminalId: string,
  reason: string
) {
  const session = sessions.get(terminalId);
  if (!session) {
    return;
  }
  try {
    await session.ptyHandle.kill();
  } catch {
    // ignore close errors
  }
  await session.ptyHandle.disconnect().catch(() => {});
  await session.sandbox.process.killPtySession(terminalId).catch(() => {});
  markTerminalClosed(sessions, terminalId, reason);
  sessions.delete(terminalId);
}

function pushTerminalChunk(session: PtyTerminalSession, data: string) {
  session.chunks.push({
    offset: session.nextSeq,
    data,
  });
  session.nextSeq += data.length;
  if (session.chunks.length > 2000) {
    session.chunks.splice(0, session.chunks.length - 2000);
  }
}

function markTerminalClosed(sessions: PtyTerminalSessions, terminalId: string, reason?: string) {
  const session = sessions.get(terminalId);
  if (!session) {
    return;
  }

  session.closed = true;
  session.connected = false;
  session.closeReason = reason ?? session.closeReason;
  session.lastUsedAt = Date.now();
}

export async function openPtyTerminal({
  env,
  sandboxName,
  sessions,
  waitUntil,
  cols = 120,
  rows = 30,
}: OpenPtyTerminalParams) {
  if (!env.DAYTONA_API_KEY) {
    throw new Error("DAYTONA_API_KEY is not configured");
  }

  const sandbox = await getSandbox(env, sandboxName);
  await sandbox.start();
  await sandbox.waitUntilStarted();
  const workdir = await sandbox.getWorkDir();
  const terminalId = crypto.randomUUID();
  const decoder = new TextDecoder();

  const ptyHandle = await sandbox.process.createPty({
    id: terminalId,
    cwd: workdir ?? "/",
    cols,
    rows,
    onData: (data) => {
      const currentSession = sessions.get(terminalId);
      if (!currentSession) {
        return;
      }
      const text = decoder.decode(data, { stream: true });
      if (!text) {
        return;
      }
      pushTerminalChunk(currentSession, text);
    },
  });

  await ptyHandle.waitForConnection();

  sessions.set(terminalId, {
    sandbox,
    ptyHandle,
    chunks: [],
    nextSeq: 0,
    connected: true,
    closed: false,
    closeReason: null,
    lastUsedAt: Date.now(),
  });

  await ptyHandle.sendInput("if [ -n \"$ZSH_VERSION\" ]; then PROMPT=\"${USER}@workspace:%~$ \"; else PS1=\"\\u@workspace:\\w\\$ \"; fi\nclear\n");

  waitUntil(
    ptyHandle.wait().then((result) => {
      const reason = result.error ?? `Shell exited with code ${result.exitCode ?? "unknown"}`;
      markTerminalClosed(sessions, terminalId, reason);
    }).catch((error) => {
      markTerminalClosed(
        sessions,
        terminalId,
        error instanceof Error ? error.message : String(error)
      );
    })
  );

  return {
    terminalId
  };
}

export async function readPtyTerminal({ sessions, terminalId, offset }: ReadPtyTerminalParams) {
  const session = sessions.get(terminalId);
  if (!session) {
    return {
      data: "",
      offset: offset ?? 0,
      connected: false,
      closed: true,
      closeReason: "Terminal session not found",
    };
  }
  const safeOffset = Math.max(0, offset ?? 0);
  const dataParts = session.chunks
    .map((chunk) => {
      const chunkEnd = chunk.offset + chunk.data.length;
      if (chunkEnd <= safeOffset) {
        return "";
      }
      if (chunk.offset >= safeOffset) {
        return chunk.data;
      }
      return chunk.data.slice(safeOffset - chunk.offset);
    })
    .filter(Boolean);
  const data = dataParts.join("");
  const nextOffset = session.nextSeq;

  session.lastUsedAt = Date.now();
  return {
    data,
    offset: nextOffset,
    connected: session.connected,
    closed: session.closed,
    closeReason: session.closeReason,
  };
}

export async function writePtyTerminal({ sessions, terminalId, data }: WritePtyTerminalParams) {
  const session = sessions.get(terminalId);
  if (!session || session.closed) {
    throw new Error("Terminal session is not connected");
  }
  session.lastUsedAt = Date.now();
  await session.ptyHandle.sendInput(data);
  return { ok: true };
}

export async function resizePtyTerminal({
  sessions,
  terminalId,
  cols,
  rows,
}: ResizePtyTerminalParams) {
  const session = sessions.get(terminalId);
  if (!session || session.closed) {
    return { ok: false };
  }
  const safeCols = Math.max(20, Math.min(500, Math.floor(cols)));
  const safeRows = Math.max(5, Math.min(200, Math.floor(rows)));
  session.lastUsedAt = Date.now();
  await session.ptyHandle.resize(safeCols, safeRows);
  return { ok: true };
}

export async function closePtyTerminal({ sessions, terminalId }: ClosePtyTerminalParams) {
  await closePtyTerminalSession(sessions, terminalId, "Closed by client");
  return { ok: true };
}

export class PtyTerminalService {
  private sessions: PtyTerminalSessions;

  constructor(sessions: PtyTerminalSessions = createPtyTerminalSessions()) {
    this.sessions = sessions;
  }

  async open(params: Omit<OpenPtyTerminalParams, "sessions">) {
    return openPtyTerminal({
      ...params,
      sessions: this.sessions,
    });
  }

  async read(params: Omit<ReadPtyTerminalParams, "sessions">) {
    return readPtyTerminal({
      ...params,
      sessions: this.sessions,
    });
  }

  async write(params: Omit<WritePtyTerminalParams, "sessions">) {
    return writePtyTerminal({
      ...params,
      sessions: this.sessions,
    });
  }

  async resize(params: Omit<ResizePtyTerminalParams, "sessions">) {
    return resizePtyTerminal({
      ...params,
      sessions: this.sessions,
    });
  }

  async close(params: Omit<ClosePtyTerminalParams, "sessions">) {
    return closePtyTerminal({
      ...params,
      sessions: this.sessions,
    });
  }
}

export abstract class SandboxTerminalAgentBase<TArgs>
  extends AIChatAgent<typeof worker.Env, TArgs> {
  protected readonly ptyTerminalService = new PtyTerminalService();

  protected abstract initSandboxAccess(): Promise<void>;
  protected abstract getSandboxIdForTerminal(): string | null;

  @callable()
  async openPtyTerminal(params?: {
    cols?: number;
    rows?: number;
  }) {
    await this.initSandboxAccess();
    const sandboxId = this.getSandboxIdForTerminal();
    if (!sandboxId) {
      throw new Error("This chat does not have a sandbox attached");
    }
    return this.ptyTerminalService.open({
      env: this.env,
      sandboxName: sandboxId,
      waitUntil: this.ctx.waitUntil.bind(this.ctx),
      cols: params?.cols,
      rows: params?.rows,
    });
  }

  @callable()
  async readPtyTerminal(params: { terminalId: string; offset?: number }) {
    return this.ptyTerminalService.read({
      terminalId: params.terminalId,
      offset: params.offset,
    });
  }

  @callable()
  async writePtyTerminal(params: { terminalId: string; data: string }) {
    return this.ptyTerminalService.write({
      terminalId: params.terminalId,
      data: params.data,
    });
  }

  @callable()
  async resizePtyTerminal(params: { terminalId: string; cols: number; rows: number }) {
    return this.ptyTerminalService.resize({
      terminalId: params.terminalId,
      cols: params.cols,
      rows: params.rows,
    });
  }

  @callable()
  async closePtyTerminal(params: { terminalId: string }) {
    return this.ptyTerminalService.close({
      terminalId: params.terminalId,
    });
  }

  @callable()
  async listFiles(params?: { path?: string }) {
    await this.initSandboxAccess();
    const sandboxId = this.getSandboxIdForTerminal();
    if (!sandboxId) {
      throw new Error("This chat does not have a sandbox attached");
    }
    return listFiles({
      env: this.env,
      sandboxName: sandboxId,
      path: params?.path,
    });
  }
}

export type ListFilesParams = {
  env: typeof worker.Env;
  sandboxName: string;
  path?: string;
};

function normalizeModTime(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (value instanceof Date) return value.getTime();
  return 0;
}

export async function listFiles({ env, sandboxName, path }: ListFilesParams) {
  if (!env.DAYTONA_API_KEY) {
    throw new Error("DAYTONA_API_KEY is not configured");
  }

  const sandbox = await getSandbox(env, sandboxName);
  const workdir = await sandbox.getWorkDir();
  const targetPath = path ?? workdir ?? "/";
  const files = await sandbox.fs.listFiles(targetPath);

  return {
    path: targetPath,
    entries: files.map((file) => ({
      name: file.name,
      path: targetPath === "/" ? `/${file.name}` : `${targetPath.replace(/\/$/, "")}/${file.name}`,
      isDir: file.isDir,
      size: file.size ?? 0,
      modifiedAt: normalizeModTime(file.modTime),
    })),
  };
}
