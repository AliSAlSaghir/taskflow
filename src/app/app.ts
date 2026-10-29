import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import cors from "cors";
import { prisma } from "../infrastructure/database/prisma.js";
import { authRouter } from "../modules/auth/auth.routes.js";
import { projectRouter } from "../modules/projects/project.routes.js";
import { errorHandler } from "./error-handler.js";
import { notFoundHandler } from "./not-found.js";
import { env } from "../config/env.js";

const app = express();

app.set("trust proxy", 2);

app.disable("x-powered-by");

if (env.FRONTEND_ORIGIN) {
  app.use(
    cors({
      origin: (origin, callback) => {
        if (origin === env.FRONTEND_ORIGIN) {
          callback(null, origin);
          return;
        }

        callback(null, false);
      },
      credentials: true,
    }),
  );
}

app.use(helmet());
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
  });
});

app.get("/health/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: "ready",
      database: "connected",
    });
  } catch (error) {
    console.error("Database readiness check failed:", error);

    res.status(503).json({
      status: "not_ready",
    });
  }
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/projects", projectRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
