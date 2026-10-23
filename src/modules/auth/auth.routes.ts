import { Router } from "express";
import { login, logout, refresh, register } from "./auth.controller.js";
import { requireAuth } from "./auth.middleware.js";
import { getCurrentUser } from "./auth.me.controller.js";

const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.get("/me", requireAuth, getCurrentUser);
authRouter.post("/logout", requireAuth, logout);
authRouter.post("/refresh", refresh);

export { authRouter };
