-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'LEASED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlayerStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'DISABLED', 'INVALID_AUTH', 'CHAIN_BROKEN');

-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('manual', 'auto_match_history');

-- CreateTable
CREATE TABLE "workers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "machine_token" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "steam_id64" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "status" "PlayerStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "note" TEXT,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_by_id" TEXT,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_states" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "invite_code" TEXT,
    "return_to" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_history_enrollments" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "auth_code_ciphertext" TEXT NOT NULL,
    "auth_code_last4" TEXT NOT NULL,
    "known_share_code" TEXT NOT NULL,
    "last_share_code" TEXT NOT NULL,
    "last_polled_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_history_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_share_codes" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "share_code" TEXT NOT NULL,
    "job_id" TEXT,
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_share_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'clip',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "source" "JobSource" NOT NULL DEFAULT 'manual',
    "payload" JSONB NOT NULL,
    "player_id" TEXT,
    "share_code" TEXT,
    "leased_by" TEXT,
    "leased_at" TIMESTAMP(3),
    "lease_expires_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT,
    "message" TEXT,
    "result" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workers_machine_token_key" ON "workers"("machine_token");

-- CreateIndex
CREATE UNIQUE INDEX "players_steam_id64_key" ON "players"("steam_id64");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_player_id_idx" ON "sessions"("player_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "invites_code_key" ON "invites"("code");

-- CreateIndex
CREATE UNIQUE INDEX "invites_used_by_id_key" ON "invites"("used_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_states_state_key" ON "auth_states"("state");

-- CreateIndex
CREATE INDEX "auth_states_expires_at_idx" ON "auth_states"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "match_history_enrollments_player_id_key" ON "match_history_enrollments"("player_id");

-- CreateIndex
CREATE INDEX "match_history_enrollments_status_idx" ON "match_history_enrollments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "match_share_codes_job_id_key" ON "match_share_codes"("job_id");

-- CreateIndex
CREATE INDEX "match_share_codes_player_id_job_id_idx" ON "match_share_codes"("player_id", "job_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_share_codes_player_id_share_code_key" ON "match_share_codes"("player_id", "share_code");

-- CreateIndex
CREATE INDEX "jobs_status_lease_expires_at_idx" ON "jobs"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "jobs_created_at_idx" ON "jobs"("created_at");

-- CreateIndex
CREATE INDEX "jobs_player_id_idx" ON "jobs"("player_id");

-- CreateIndex
CREATE INDEX "jobs_player_id_share_code_idx" ON "jobs"("player_id", "share_code");

-- CreateIndex
CREATE INDEX "jobs_source_status_created_at_idx" ON "jobs"("source", "status", "created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_id_fkey" FOREIGN KEY ("used_by_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_history_enrollments" ADD CONSTRAINT "match_history_enrollments_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_share_codes" ADD CONSTRAINT "match_share_codes_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_share_codes" ADD CONSTRAINT "match_share_codes_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_leased_by_fkey" FOREIGN KEY ("leased_by") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

