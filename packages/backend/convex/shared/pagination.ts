export async function withInvalidCursorRetry<Args, Result>(
  args: Args,
  run: (nextArgs: Args) => Promise<Result>,
  resetArgs: (nextArgs: Args) => Args
) {
  try {
    return await run(args);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!errorMessage.includes("InvalidCursor")) {
      throw error;
    }
    return run(resetArgs(args));
  }
}
