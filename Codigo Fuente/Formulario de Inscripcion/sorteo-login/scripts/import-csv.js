const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { parse } = require('csv-parse/sync');
const { createPool } = require('../db/pool');

dotenv.config();

const coreColumns = new Set(['dni', 'nombre', 'apellido', 'bandera']);
const csvPath = path.resolve(
  process.argv[2] || process.env.CSV_PATH || path.join(__dirname, '..', 'data', 'participantes.csv')
);

function normalizeDni(value) {
  return String(value || '').replace(/[.\s]/g, '');
}

async function importCsv() {
  const content = await fs.promises.readFile(csvPath, 'utf8');
  const rows = parse(content, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  if (rows.length === 0 || !['dni', 'nombre', 'apellido'].every((column) => column in rows[0])) {
    throw new Error('El CSV no tiene las columnas obligatorias');
  }

  const pool = createPool();
  let imported = 0;
  let skipped = 0;

  try {
    await pool.query('BEGIN');

    for (const row of rows) {
      const dni = normalizeDni(row.dni);
      const bandera = String(row.bandera || '0').trim();

      if (!/^\d{7,8}$/.test(dni) || !row.nombre || !row.apellido || !['0', '1'].includes(bandera)) {
        throw new Error('El CSV contiene una fila inválida');
      }

      const datosAdicionales = Object.fromEntries(
        Object.entries(row).filter(([column]) => !coreColumns.has(column))
      );
      const result = await pool.query(
        `INSERT INTO participantes (dni, nombre, apellido, bandera, datos_adicionales)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (dni) DO NOTHING`,
        [dni, row.nombre, row.apellido, Number(bandera), JSON.stringify(datosAdicionales)]
      );

      if (result.rowCount === 1) imported += 1;
      else skipped += 1;
    }

    await pool.query('COMMIT');
    console.log(`Importación terminada: ${imported} nuevos, ${skipped} existentes sin modificar`);
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await pool.end();
  }
}

importCsv().catch(() => {
  console.error('No se pudo importar el CSV; revisa DATABASE_URL y el formato del archivo');
  process.exitCode = 1;
});