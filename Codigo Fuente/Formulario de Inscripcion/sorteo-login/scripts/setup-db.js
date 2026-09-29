const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createPool } = require('../db/pool');

dotenv.config();

async function setupDatabase() {
  const pool = createPool();

  try {
    const schema = await fs.promises.readFile(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('Esquema de PostgreSQL preparado');
  } finally {
    await pool.end();
  }
}

setupDatabase().catch(() => {
  console.error('No se pudo preparar PostgreSQL');
  process.exitCode = 1;
});