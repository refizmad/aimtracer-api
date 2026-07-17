import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/** Standalone PrismaClient for seeds/scripts (not Nest DI). */
export function createPrismaClient(
  connectionString = process.env.DATABASE_URL,
): PrismaClient {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
