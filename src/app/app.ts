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
import { profileRouter } from "../modules/profile/profile.routes.js";
import { adminRouter } from "../modules/admin/admin.routes.js";
import { requireTrustedOrigin } from "./middleware/require-trusted-origin.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { logger } from "./logger.js";

const app = express();

app.use(requestIdMiddleware);

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
app.use(requireTrustedOrigin);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
  });
});

app.get("/health/ready", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: "ready",
      database: "connected",
    });
  } catch (error) {
    logger.error("Database readiness check failed", {
      ...(res.locals.requestId
        ? { requestId: res.locals.requestId as string }
        : {}),
      method: req.method,
      path: req.path,
      error,
    });

    res.status(503).json({
      status: "not_ready",
    });
  }
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/profile", profileRouter);
app.use("/api/v1/projects", projectRouter);
app.use("/api/v1/admin", adminRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
