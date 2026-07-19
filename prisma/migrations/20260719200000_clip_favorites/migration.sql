-- CreateTable
CREATE TABLE "clip_favorites" (
    "player_id" TEXT NOT NULL,
    "clip_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clip_favorites_pkey" PRIMARY KEY ("player_id","clip_id")
);

-- CreateIndex
CREATE INDEX "clip_favorites_clip_id_idx" ON "clip_favorites"("clip_id");

-- AddForeignKey
ALTER TABLE "clip_favorites" ADD CONSTRAINT "clip_favorites_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clip_favorites" ADD CONSTRAINT "clip_favorites_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "clips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
