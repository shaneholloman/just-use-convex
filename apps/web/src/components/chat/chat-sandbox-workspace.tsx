import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, FileIcon, FolderIcon, LaptopIcon, Loader2, RefreshCw } from "lucide-react";
import { api } from "@just-use-convex/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Terminal as XtermTerminal } from "xterm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import "xterm/css/xterm.css";

type SandboxWorkspaceSession = FunctionReturnType<typeof api.sandboxes.nodeFunctions.createChatSshAccess> &
  Pick<FunctionReturnType<typeof api.sandboxes.nodeFunctions.createChatPreviewAccess>, "preview">;
type XtermTerminalWriteData = Extract<Parameters<XtermTerminal["write"]>[0], string>;
type XtermTerminalInputData = Extract<Parameters<Parameters<XtermTerminal["onData"]>[0]>[0], string>;
type XtermTerminalResizeEvent = Parameters<Parameters<XtermTerminal["onResize"]>[0]>[0];

type ChatSandboxWorkspaceProps = {
  session: SandboxWorkspaceSession | null;
  isLoading: boolean;
  onReconnect: () => Promise<void>;
  agent: {
    call: (method: string, args?: unknown[]) => Promise<unknown>;
  } | null;
};

export function ChatSandboxWorkspace({ session, isLoading, onReconnect, agent }: ChatSandboxWorkspaceProps) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewDraft, setPreviewDraft] = useState("");
  const [terminalReloadKey, setTerminalReloadKey] = useState(0);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const terminalCursorRef = useRef(0);
  const terminalInputBufferRef = useRef<XtermTerminalInputData>("");
  const terminalWriteInFlightRef = useRef(false);
  const terminalWriteErroredRef = useRef(false);

  useEffect(() => {
    const nextUrl = session?.preview.url ?? "";
    setPreviewUrl(nextUrl);
    setPreviewDraft(nextUrl);
  }, [session?.preview.url]);

  const sortedEntries = useMemo(() => {
    const entries = session?.explorer.entries ?? [];
    return [...entries].sort((a, b) => {
      if (a.isDir !== b.isDir) {
        return a.isDir ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [session?.explorer.entries]);

  const copyCommand = useCallback(async () => {
    if (!session?.ssh.command) {
      return;
    }
    try {
      await navigator.clipboard.writeText(session.ssh.command);
      toast.success("SSH command copied");
    } catch {
      toast.error("Failed to copy SSH command");
    }
  }, [session?.ssh.command]);

  const openInEditor = useCallback(
    async (editor: "vscode" | "cursor") => {
      if (!session?.ssh.command) {
        return;
      }

      await copyCommand();

      if (typeof window === "undefined") {
        return;
      }

      window.location.href = editor === "vscode" ? "vscode://" : "cursor://";
    },
    [copyCommand, session?.ssh.command]
  );

  useEffect(() => {
    if (!session || !agent || !terminalContainerRef.current) {
      return;
    }

    let isCancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let writeTimer: ReturnType<typeof setInterval> | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let terminalDispose: (() => void) | null = null;

    const setupTerminal = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (isCancelled || !terminalContainerRef.current) {
        return;
      }

      const term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        scrollback: 20000,
        fontSize: 12,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        theme: {
          background: "#0b0f19",
          foreground: "#e5e7eb",
          cursor: "#f9fafb",
        },
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalContainerRef.current);
      fitAddon.fit();
      term.writeln("Connecting to sandbox shell through agent proxy...");

      terminalDispose = () => {
        term.dispose();
      };

      const openResponse = await agent.call("openSshTerminal", [{
        cols: term.cols,
        rows: term.rows,
      }]) as { terminalId?: string };
      if (isCancelled) {
        const terminalId = openResponse?.terminalId;
        if (terminalId) {
          void agent.call("closeSshTerminal", [{ terminalId }]).catch(() => undefined);
        }
        return;
      }

      const terminalId = openResponse?.terminalId;
      if (!terminalId) {
        term.writeln("\r\nFailed to open SSH terminal session.");
        return;
      }
      terminalIdRef.current = terminalId;
      terminalCursorRef.current = 0;
      terminalInputBufferRef.current = "";
      terminalWriteInFlightRef.current = false;
      terminalWriteErroredRef.current = false;

      term.onData((data: XtermTerminalInputData) => {
        terminalInputBufferRef.current += data;
      });

      writeTimer = setInterval(() => {
        const pendingInput = terminalInputBufferRef.current;
        if (!pendingInput || !terminalIdRef.current || terminalWriteInFlightRef.current) {
          return;
        }
        terminalWriteInFlightRef.current = true;
        terminalInputBufferRef.current = "";
        void agent.call("writeSshTerminal", [{
          terminalId: terminalIdRef.current,
          data: pendingInput,
        }]).then(() => {
          terminalWriteErroredRef.current = false;
        }).catch(() => {
          if (!terminalWriteErroredRef.current) {
            term.writeln("\r\n[input unavailable]");
            terminalWriteErroredRef.current = true;
          }
          terminalInputBufferRef.current = pendingInput + terminalInputBufferRef.current;
        }).finally(() => {
          terminalWriteInFlightRef.current = false;
        });
      }, 25);

      resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        if (!terminalIdRef.current) {
          return;
        }
        void agent.call("resizeSshTerminal", [{
          terminalId: terminalIdRef.current,
          cols: term.cols,
          rows: term.rows,
        } satisfies XtermTerminalResizeEvent & { terminalId: string }]).catch(() => undefined);
      });
      resizeObserver.observe(terminalContainerRef.current);

      pollTimer = setInterval(() => {
        if (!terminalIdRef.current) {
          return;
        }

        void agent.call("readSshTerminal", [{
          terminalId: terminalIdRef.current,
          offset: terminalCursorRef.current,
        }]).then((result) => {
          const response = result as {
            data?: XtermTerminalWriteData;
            offset?: number;
            closed?: boolean;
            closeReason?: string | null;
          };
          if (response.data) {
            term.write(response.data);
          }
          if (typeof response.offset === "number") {
            terminalCursorRef.current = response.offset;
          }

          if (response.closed) {
            const reason = response.closeReason ? `: ${response.closeReason}` : "";
            term.writeln(`\r\n[session closed${reason}]`);
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
            if (writeTimer) {
              clearInterval(writeTimer);
              writeTimer = null;
            }
          }
        }).catch(() => undefined);
      }, 120);
    };

    void setupTerminal().catch(() => {
      toast.error("Failed to initialize terminal");
    });

    return () => {
      isCancelled = true;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      if (writeTimer) {
        clearInterval(writeTimer);
      }
      resizeObserver?.disconnect();

      const terminalId = terminalIdRef.current;
      terminalIdRef.current = null;
      terminalCursorRef.current = 0;
      terminalInputBufferRef.current = "";
      terminalWriteInFlightRef.current = false;
      terminalWriteErroredRef.current = false;
      if (terminalId) {
        void agent.call("closeSshTerminal", [{ terminalId }]).catch(() => undefined);
      }

      terminalDispose?.();
    };
  }, [agent, session, terminalReloadKey]);

  if (isLoading && !session) {
    return (
      <div className="flex h-full flex-col border-l bg-background p-3">
        <Skeleton className="mb-3 h-8 w-64" />
        <Skeleton className="mb-3 h-10 w-full" />
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center border-l bg-background p-4">
        <p className="text-sm text-muted-foreground">Connect sandbox to start preview, terminal, and file explorer.</p>
      </div>
    );
  }

  return (
    <div className="h-full border-l bg-background">
      <Tabs defaultValue="preview" className="flex h-full flex-col gap-0">
        <div className="flex items-center justify-between border-b px-2 py-1.5">
          <TabsList variant="line" className="w-auto">
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="explorer">File Explorer</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void onReconnect()}
              disabled={isLoading}
              aria-label="Reconnect SSH session"
            >
              {isLoading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Open in VSCode or Cursor">
                    <LaptopIcon className="size-3.5" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void openInEditor("vscode")}>
                  Open in VSCode
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void openInEditor("cursor")}>
                  Open in Cursor
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <TabsContent value="preview" className="mt-0 flex min-h-0 flex-1 flex-col p-3">
          <div className="mb-2 flex items-center gap-2">
            <Input
              value={previewDraft}
              onChange={(event) => setPreviewDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setPreviewUrl(previewDraft.trim());
                }
              }}
              placeholder="https://..."
              className="h-8"
            />
            <Button type="button" size="sm" variant="outline" onClick={() => setPreviewUrl(previewDraft.trim())}>
              Open
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
            <iframe
              className="h-full w-full"
              src={previewUrl || undefined}
              title="Sandbox Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
            />
          </div>
        </TabsContent>

        <TabsContent value="terminal" className="mt-0 flex min-h-0 flex-1 flex-col p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">{session.sandboxName}</p>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTerminalReloadKey((value) => value + 1)}
              >
                Reload
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyCommand()}>
                Copy SSH
              </Button>
            </div>
          </div>
          <div ref={terminalContainerRef} className="min-h-0 flex-1 overflow-hidden rounded-md border bg-black" />
          <div className="mt-2 text-xs text-muted-foreground">
            SSH expires: {new Date(session.ssh.expiresAt).toLocaleString()}
          </div>
        </TabsContent>

        <TabsContent value="explorer" className="mt-0 min-h-0 flex-1 p-3">
          <div className="mb-2 text-xs text-muted-foreground">{session.explorer.path}</div>
          <div className="h-full overflow-auto rounded-md border">
            {sortedEntries.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">No files found.</div>
            ) : (
              <ul className="p-1">
                {sortedEntries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {entry.isDir ? (
                          <FolderIcon className="size-3.5 shrink-0 text-blue-500" />
                        ) : (
                          <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{entry.name}</span>
                      </span>
                      {!entry.isDir && <ExternalLink className="size-3 text-muted-foreground" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
