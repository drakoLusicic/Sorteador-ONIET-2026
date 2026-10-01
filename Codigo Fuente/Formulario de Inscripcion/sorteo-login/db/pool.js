const fs = require('fs');
const mysql = require('mysql2/promise');

function createPool() {
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD) {
    throw new Error('DB_HOST, DB_USER y DB_PASSWORD deben estar configuradas');
  }

  const ssl = process.env.DB_SSL === 'true'
    ? {
        rejectUnauthorized: true,
        ...(process.env.DB_SSL_CA_FILE
          ? { ca: fs.readFileSync(process.env.DB_SSL_CA_FILE, 'utf8') }
          : {})
      }
    : undefined;

  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'sorteador_db',
    connectionLimit: 10,
    connectTimeout: 5000,
    waitForConnections: true,
    queueLimit: 0,
    ssl
  });
}

module.exports = { createPool };