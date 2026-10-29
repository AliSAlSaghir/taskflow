import { env } from "./config/env.js";
import { app } from "./app/app.js";
import { prisma } from "./infrastructure/database/prisma.js";

const server = app.listen(env.PORT, () => {
  console.log(`TaskFlow API listening on port ${env.PORT}`);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}. Starting graceful shutdown...`);

  const forceShutdown = setTimeout(() => {
    console.error("Graceful shutdown timed out. Forcing exit.");
    server.closeAllConnections();
    process.exit(1);
  }, 10_000);

  forceShutdown.unref();

  server.close((serverError) => {
    void (async () => {
      let exitCode = 0;

      if (serverError) {
        console.error("HTTP server shutdown failed:", serverError);
        exitCode = 1;
      }

      try {
        await prisma.$disconnect();
        console.log("Database disconnected.");
      } catch (error: unknown) {
        console.error("Database disconnection failed:", error);
        exitCode = 1;
      } finally {
        clearTimeout(forceShutdown);
        process.exit(exitCode);
      }
    })();
  });

  server.closeIdleConnections();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
