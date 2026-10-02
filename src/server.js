import app from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const HOST = '0.0.0.0'; // Required for Render and containerized deployments

app.listen(env.PORT, HOST, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV },
    `🚀  Subvora backend listening on ${HOST}:${env.PORT}`,
  );
});
