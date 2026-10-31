/*
  Warnings:

  - You are about to drop the column `csrf_token_hash` on the `auth_sessions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "auth_sessions" DROP COLUMN "csrf_token_hash";
