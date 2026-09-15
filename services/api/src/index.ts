/**
 * @keystone/api — Fastify REST API for the Keystone voting system.
 *
 * Endpoints:
 * - Ballot submission and retrieval
 * - Tally queries (partial and final)
 * - Admin: election creation, key ceremony, result publication
 *
 * No implementation yet — this is a scaffold.
 */

import Fastify from 'fastify';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok' }));

const API_PORT = Number(process.env['API_PORT'] ?? 3000);
const API_HOST = process.env['API_HOST'] ?? '0.0.0.0';

app.listen({ port: API_PORT, host: API_HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
