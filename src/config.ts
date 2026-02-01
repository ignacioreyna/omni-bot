import { config } from 'dotenv';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import path from 'path';

config();

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  sessionSecret: z.string().min(16).default(() => randomBytes(32).toString('hex')),
  allowedDirectories: z
    .string()
    .default('/tmp')
    .transform((val) => val.split(',').map((d) => d.trim()).filter((d) => d.length > 0)),
  databasePath: z.string().default('./data/omni-bot.db'),
  maxConcurrentSessions: z.coerce.number().int().positive().default(5),
});

function loadConfig() {
  const result = configSchema.safeParse({
    port: process.env.PORT,
    sessionSecret: process.env.SESSION_SECRET,
    allowedDirectories: process.env.ALLOWED_DIRECTORIES,
    databasePath: process.env.DATABASE_PATH,
    maxConcurrentSessions: process.env.MAX_CONCURRENT_SESSIONS,
  });

  if (!result.success) {
    console.error('Configuration validation failed:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return {
    ...result.data,
    databasePath: path.resolve(result.data.databasePath),
    allowedDirectories: result.data.allowedDirectories.map((d) => path.resolve(d)),
  };
}

export type Config = ReturnType<typeof loadConfig>;
export const appConfig = loadConfig();
