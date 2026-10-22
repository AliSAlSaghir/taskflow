import { SignJWT, jwtVerify } from "jose";
import { env } from "../../config/env.js";
import { ACCESS_TOKEN_LIFETIME_SECONDS } from "./auth.constants.js";

const accessTokenSecret = new TextEncoder().encode(env.ACCESS_TOKEN_SECRET);

const TOKEN_ISSUER = "taskflow-api";
const TOKEN_AUDIENCE = "taskflow-client";

export async function createAccessToken(userId: string, sessionId: string) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_LIFETIME_SECONDS}s`)
    .sign(accessTokenSecret);
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, accessTokenSecret, {
    algorithms: ["HS256"],
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
  });

  if (!payload.sub) {
    throw new Error("Access token is missing its subject.");
  }

  if (typeof payload.sid !== "string" || payload.sid.length === 0) {
    throw new Error("Access token is missing its session ID.");
  }

  return {
    userId: payload.sub,
    sessionId: payload.sid,
  };
}
