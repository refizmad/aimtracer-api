-- CreateTable
CREATE TABLE "worker_logs" (
    "id" BIGSERIAL NOT NULL,
    "worker_id" TEXT NOT NULL,
    "job_id" TEXT,
    "line" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "worker_logs_worker_id_id_idx" ON "worker_logs"("worker_id", "id");

-- AddForeignKey
ALTER TABLE "worker_logs" ADD CONSTRAINT "worker_logs_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
