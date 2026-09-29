const fs = require('fs');
const { Pool } = require('pg');

function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL no está configurada');
  }

  const connectionUrl = new URL(process.env.DATABASE_URL);
  const sslMode = connectionUrl.searchParams.get('sslmode');
  ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].forEach((parameter) => {
    connectionUrl.searchParams.delete(parameter);
  });

  const useTls = process.env.NODE_ENV === 'production' || Boolean(sslMode && sslMode !== 'disable');
  const ssl = useTls
    ? {
        rejectUnauthorized: true,
        ...(process.env.PGSSL_CA_FILE
          ? { ca: fs.readFileSync(process.env.PGSSL_CA_FILE, 'utf8') }
          : {})
      }
    : undefined;

  return new Pool({
    connectionString: connectionUrl.toString(),
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    ssl
  });
}

module.exports = { createPool };