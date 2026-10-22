import { env } from "./config/env.js";
import { app } from "./app/app.js";
import { prisma } from "./infrastructure/database/prisma.js";

const server = app.listen(env.PORT, () => {
  console.log(`TaskFlow API listening on port ${env.PORT}`);
});

function shutdown() {
  server.close(() => {
    void prisma.$disconnect().finally(() => {
      process.exit(0);
    });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
