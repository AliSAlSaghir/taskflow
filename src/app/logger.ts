type ErrorLogContext = {
  requestId?: string;
  method?: string;
  path?: string;
  error?: unknown;
  validationErrors?: unknown;
};

function getErrorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  return typeof error;
}

export const logger = {
  info(message: string, context: Record<string, unknown> = {}) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        message,
        ...context,
      }),
    );
  },

  error(message: string, context: ErrorLogContext = {}) {
    const { error, ...safeContext } = context;

    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        message,
        ...safeContext,
        ...(error !== undefined ? { errorName: getErrorName(error) } : {}),
      }),
    );
  },
};
