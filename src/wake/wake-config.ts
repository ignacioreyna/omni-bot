import { config } from 'dotenv';
import { z } from 'zod';

config();

const wakeConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  omniBotPort: z.coerce.number().int().positive().default(3001),
  authMode: z.enum(['tailscale', 'cloudflare']).default('tailscale'),
  cfAccessTeamDomain: z.string().optional(),
  cfAccessAud: z.string().optional(),
  projectRoot: z.string().default(process.cwd()),
  omniBotLogPath: z.string().default('/tmp/omni-bot.log'),
});

function loadWakeConfig(): z.infer<typeof wakeConfigSchema> {
  const result = wakeConfigSchema.safeParse({
    port: process.env.PORT,
    omniBotPort: process.env.OMNI_BOT_PORT,
    authMode: process.env.AUTH_MODE,
    cfAccessTeamDomain: process.env.CF_ACCESS_TEAM_DOMAIN,
    cfAccessAud: process.env.CF_ACCESS_AUD,
    projectRoot: process.env.PROJECT_ROOT,
    omniBotLogPath: process.env.OMNI_BOT_LOG_PATH,
  });

  if (!result.success) {
    console.error('[Wake] Config validation failed:', result.error.issues);
    process.exit(1);
  }

  if (result.data.authMode === 'cloudflare') {
    if (!result.data.cfAccessTeamDomain || !result.data.cfAccessAud) {
      console.error('[Wake] CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD required for cloudflare mode');
      process.exit(1);
    }
  }

  return result.data;
}

export const wakeConfig = loadWakeConfig();
