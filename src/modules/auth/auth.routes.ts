import { Router } from "express";
import {
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
} from "../../app/middleware/rate-limit.js";

const authRouter = Router();

authRouter.post("/register", registrationRateLimit, register);
authRouter.post("/login", loginRateLimit, login);
authRouter.get("/me", requireAuth, getCurrentUser);
authRouter.post("/logout", requireAuth, logout);
authRouter.post("/logout-all", requireAuth, logoutAll);
authRouter.post("/refresh", refresh);

export { authRouter };
