import "dotenv/config";
import { app } from "./app/app.js";
import { prisma } from "./infrastructure/database/prisma.js";

const port = Number(process.env.PORT ?? 3000);

const server = app.listen(port, () => {
  console.log(`TaskFlow API listening on port ${port}`);
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
