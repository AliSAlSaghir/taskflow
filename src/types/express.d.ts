declare global {
  namespace Express {
    interface Locals {
      user: {
        id: string;
        sessionId: string;
        role: "USER" | "ADMIN";
      };
    }
  }
}

export {};
