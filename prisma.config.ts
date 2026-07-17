import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// `prisma generate` does not need a live DB; migrations/seed do.
// Prefer process.env so install/generate works without a .env file.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/aimtrace',
  },
});
