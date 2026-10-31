-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "csrf_token_hash" VARCHAR(64);
