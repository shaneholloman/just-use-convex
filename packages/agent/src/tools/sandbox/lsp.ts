import { LspLanguageId } from "@daytonaio/sdk";
import type {
  LspCompletionsInput,
  LspSessionState,
  SandboxSessionState,
} from "./types";

function normalizeLanguageId(languageId: string): LspLanguageId | string {
  switch (languageId.toLowerCase()) {
    case "python":
      return LspLanguageId.PYTHON;
    case "typescript":
      return LspLanguageId.TYPESCRIPT;
    case "javascript":
      return LspLanguageId.JAVASCRIPT;
    default:
      return languageId;
  }
}

function languageKey(languageId: string): string {
  return languageId.toLowerCase();
}

type GetOrCreateLspInput = Pick<
  LspCompletionsInput,
  "languageId" | "projectPath"
>;

export async function getOrCreateLspSession(
  sandboxSession: SandboxSessionState,
  input: GetOrCreateLspInput
): Promise<LspSessionState> {
  const targetLanguageId = languageKey(input.languageId);
  const existing = sandboxSession.lspSession;
  if (existing && existing.languageId === targetLanguageId) {
    return existing;
  }
  if (existing) {
    await existing.server.stop().catch(() => undefined);
    sandboxSession.lspSession = null;
  }

  const server = await sandboxSession.sandbox.createLspServer(
    normalizeLanguageId(targetLanguageId),
    input.projectPath
  );
  await server.start();

  const session: LspSessionState = {
    languageId: targetLanguageId,
    server,
  };
  sandboxSession.lspSession = session;
  return session;
}

export async function getLspCompletions(
  sandboxSession: SandboxSessionState,
  input: LspCompletionsInput
) {
  const lspSession = await getOrCreateLspSession(sandboxSession, input);
  await lspSession.server.didOpen(input.filePath);
  const completions = await lspSession.server.completions(input.filePath, {
    line: input.line,
    character: input.character,
  });

  return {
    languageId: lspSession.languageId,
    filePath: input.filePath,
    line: input.line,
    character: input.character,
    completions,
  };
}

export async function closeAllLspSessions(
  sandboxSession: SandboxSessionState
): Promise<void> {
  const lspSession = sandboxSession.lspSession;
  if (!lspSession) {
    return;
  }
  await lspSession.server.stop().catch(() => undefined);
  sandboxSession.lspSession = null;
}
