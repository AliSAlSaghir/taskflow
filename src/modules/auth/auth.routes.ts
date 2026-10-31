import { Router } from "express";
import {
  getCsrfToken,
  login,
  logout,
  logoutAll,
  refresh,
  register,
} from "./auth.controller.js";
import { requireAuth } from "./auth.middleware.js";
import { getCurrentUser } from "./auth.me.controller.js";
import {
  loginRateLimit,
  registrationRateLimit,
  refreshRateLimit,
} from "../../app/middleware/rate-limit.js";
import { requireCsrfToken } from "../../app/middleware/require-csrf-token.js";

const authRouter = Router();

authRouter.post("/register", registrationRateLimit, register);
authRouter.post("/login", loginRateLimit, login);
authRouter.get("/me", requireAuth, getCurrentUser);
authRouter.get("/csrf-token", requireAuth, getCsrfToken);
authRouter.post("/logout", requireAuth, requireCsrfToken, logout);
authRouter.post("/logout-all", requireAuth, requireCsrfToken, logoutAll);
authRouter.post("/refresh", refreshRateLimit, refresh);

export { authRouter };
