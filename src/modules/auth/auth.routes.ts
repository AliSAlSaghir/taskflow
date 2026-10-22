import { Router } from "express";
import { register } from "./auth.controller.js";

const authRouter = Router();

authRouter.post("/register", register);

export { authRouter };
