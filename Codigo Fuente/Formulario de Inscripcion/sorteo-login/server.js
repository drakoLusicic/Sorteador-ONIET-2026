const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const { createPool } = require('./db/pool');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const trustProxyHops = process.env.TRUST_PROXY_HOPS;
if (trustProxyHops !== undefined) {
  const parsedTrustProxyHops = Number(trustProxyHops);
  if (!Number.isInteger(parsedTrustProxyHops) || parsedTrustProxyHops < 0) {
    throw new Error('TRUST_PROXY_HOPS debe ser un entero no negativo');
  }
  app.set('trust proxy', parsedTrustProxyHops);
}

const projectRoot = __dirname;
const publicDir = path.join(projectRoot, 'public');
const dataDir = path.join(projectRoot, 'data');
const csvPath = path.resolve(process.env.CSV_PATH || path.join(dataDir, 'participantes.csv'));
const useDatabase = Boolean(process.env.DB_HOST || process.env.DB_USER || process.env.DB_PASSWORD);
const pool = useDatabase ? createPool() : null;
let writeQueue = Promise.resolve();
const winnerTokens = new Map();
const winnerTokenLifetimeMs = 60 * 60 * 1000;
const winnerPollMinimumIntervalMs = 4000;

const exampleRows = [
  { dni: '20123456', nombre: 'Juan', apellido: 'Pérez', bandera: '0' },
  { dni: '30789012', nombre: 'María', apellido: 'García', bandera: '0' },
  { dni: '28567123', nombre: 'Lucas', apellido: 'Fernández', bandera: '0' },
  { dni: '33222333', nombre: 'Sofía', apellido: 'López', bandera: '0' },
  { dni: '40234567', nombre: 'Mateo', apellido: 'Ruiz', bandera: '0' },
  { dni: '28900111', nombre: 'Valentina', apellido: 'Castro', bandera: '0' },
  { dni: '31876543', nombre: 'Diego', apellido: 'Moreno', bandera: '0' },
  { dni: '23098765', nombre: 'Camila', apellido: 'Silva', bandera: '0' },
  { dni: '40112233', nombre: 'Nicolás', apellido: 'Torres', bandera: '0' },
  { dni: '27123456', nombre: 'Agustina', apellido: 'Vega', bandera: '0' }
];

function normalizeDni(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[.\s]/g, '');
}

function isValidDni(value) {
  const dni = normalizeDni(value);
  return /^\d{7,8}$/.test(dni);
}

function buildNombreParcial(persona) {
  const nombre = String(persona?.nombre || '').trim();
  const apellido = String(persona?.apellido || '').trim();
  const nombreParts = nombre.split(/\s+/).filter(Boolean);
  const primerNombre = nombreParts[0] || 'Persona';
  const inicialApellido = apellido ? `${apellido.charAt(0).toUpperCase()}.` : '';

  return `${primerNombre} ${inicialApellido}`.trim();
}

function queueTask(task) {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

async function writeCsvRowsFile(rows, columns) {
  const content = stringify(rows, {
    header: true,
    columns,
    quoted: true,
    newline: '\n'
  });

  const tempPath = `${csvPath}.tmp`;

  await fs.promises.writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600 });
  await fs.promises.rename(tempPath, csvPath);
}

async function writeCsvRows(rows, columns) {
  await queueTask(() => writeCsvRowsFile(rows, columns));
}

async function readCsvRows() {
  const content = await fs.promises.readFile(csvPath, 'utf8');
  const parsed = parse(content, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });

  return parsed;
}

async function ensureCsvFile() {
  const relativeToPublic = path.relative(path.resolve(publicDir), csvPath);
  const csvIsPublic = relativeToPublic === '' || (!relativeToPublic.startsWith(`..${path.sep}`) && relativeToPublic !== '..' && !path.isAbsolute(relativeToPublic));

  if (csvIsPublic) {
    throw new Error('El CSV no puede estar dentro del directorio público');
  }

  await fs.promises.mkdir(path.dirname(csvPath), { recursive: true });

  if (!fs.existsSync(csvPath)) {
    const columns = ['dni', 'nombre', 'apellido', 'bandera'];
    const rows = exampleRows.map((row) => ({ ...row, bandera: '0' }));
    await writeCsvRows(rows, columns);
    return;
  }

  const content = await fs.promises.readFile(csvPath, 'utf8');
  const existingRows = parse(content, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });

  if (existingRows.length === 0 && content.trim() === '') {
    const columns = ['dni', 'nombre', 'apellido', 'bandera'];
    await writeCsvRows([], columns);
    return;
  }

  const hasBandera = Object.keys(existingRows[0] || {}).includes('bandera');

  if (!hasBandera) {
    const columns = [...Object.keys(existingRows[0] || {}), 'bandera'];
    const rows = existingRows.map((row) => ({ ...row, bandera: '0' }));
    await writeCsvRows(rows, columns);
  }
}

async function findParticipant(dni) {
  if (pool) {
    const [rows] = await pool.execute(
      'SELECT id, dni, nombre, apellido, inscripto AS bandera FROM estudiantes WHERE dni = ? LIMIT 1',
      [dni]
    );
    return rows[0] || null;
  }

  const rows = await readCsvRows();
  return rows.find((row) => normalizeDni(row.dni) === dni) || null;
}

function createWinnerToken(studentId) {
  if (!pool || studentId === undefined || studentId === null) return null;

  const now = Date.now();
  for (const [token, session] of winnerTokens) {
    if (session.expiresAt <= now) winnerTokens.delete(token);
  }

  const token = crypto.randomBytes(32).toString('hex');
  winnerTokens.set(token, {
    studentId,
    expiresAt: now + winnerTokenLifetimeMs,
    lastPollAt: 0
  });
  return token;
}

function requireWinnerToken(req, res, next) {
  const token = req.body?.token;
  const session = winnerTokens.get(token);

  if (!session || session.expiresAt <= Date.now()) {
    if (session) winnerTokens.delete(token);
    return res.status(401).json({ error: 'Sesión vencida' });
  }

  const now = Date.now();
  if (now - session.lastPollAt < winnerPollMinimumIntervalMs) {
    return res.status(429).json({ error: 'Consulta demasiado frecuente' });
  }

  session.lastPollAt = now;
  req.studentId = session.studentId;
  return next();
}

async function findLatestWinner(studentId) {
  if (!pool) return null;

  const [rows] = await pool.execute(
    `SELECT e.id AS estudianteId, e.nombre, e.apellido, p.nombre AS premio
     FROM estudiantes AS e
     INNER JOIN ganadores AS g ON g.id_estudiante = e.id
     INNER JOIN premios AS p ON p.id = g.id_premio
     WHERE e.id = ? AND e.inscripto = 1
     ORDER BY g.fecha DESC, g.id DESC
     LIMIT 1`,
    [studentId]
  );

  return rows[0] || null;
}

async function confirmParticipant(dni) {
  if (pool) {
    const [updated] = await pool.execute(
      'UPDATE estudiantes SET inscripto = 1 WHERE dni = ? AND inscripto = 0',
      [dni]
    );

    if (updated.affectedRows > 0) {
      return { status: 200, body: { estado: 'confirmado' } };
    }

    const [existing] = await pool.execute(
      'SELECT dni FROM estudiantes WHERE dni = ? LIMIT 1',
      [dni]
    );

    return existing.length === 0
      ? { status: 404, body: { error: 'DNI no encontrado' } }
      : { status: 409, body: { error: 'Ya estás participando' } };
  }

  return queueTask(async () => {
    const rows = await readCsvRows();
    const index = rows.findIndex((row) => normalizeDni(row.dni) === dni);

    if (index === -1) {
      return { status: 404, body: { error: 'DNI no encontrado' } };
    }

    const actual = rows[index];
    if (String(actual.bandera || '0').trim() !== '0') {
      return { status: 409, body: { error: 'Ya estás participando' } };
    }

    rows[index].bandera = '1';
    await writeCsvRowsFile(rows, Object.keys(actual));
    return { status: 200, body: { estado: 'confirmado' } };
  });
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Inténtalo más tarde.' }
});

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '4kb', strict: true, type: 'application/json' }));
app.use(express.static(publicDir));

app.post('/api/ganador', requireWinnerToken, async (req, res) => {
  try {
    const ganador = await findLatestWinner(req.studentId);
    return res.status(200).json({ ganador });
  } catch (error) {
    console.error('Error en /api/ganador:', error.code || error.name || 'Error', error.message);
    return res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/verificar', apiLimiter, async (req, res) => {
  try {
    const dni = normalizeDni(req.body?.dni);

    if (!isValidDni(dni)) {
      return res.status(400).json({ error: 'DNI inválido' });
    }

    const persona = await findParticipant(dni);

    if (!persona) {
      return res.status(404).json({ error: 'DNI no encontrado' });
    }

    const bandera = String(persona.bandera || '0').trim();

    if (bandera === '1') {
      return res.status(200).json({
        estado: 'ya_participa',
        winnerToken: createWinnerToken(persona.id)
      });
    }

    return res.status(200).json({
      estado: 'pendiente',
      nombreParcial: buildNombreParcial(persona)
    });
  } catch (error) {
    console.error('Error en /api/verificar:', error.code || error.name || 'Error', error.message);
    return res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/confirmar', apiLimiter, async (req, res) => {
  try {
    const dni = normalizeDni(req.body?.dni);

    if (!isValidDni(dni)) {
      return res.status(400).json({ error: 'DNI inválido' });
    }

    const persona = await findParticipant(dni);
    const result = await confirmParticipant(dni);
    const body = result.status === 200 && result.body.estado === 'confirmado'
      ? { ...result.body, winnerToken: createWinnerToken(persona?.id) }
      : result.body;
    return res.status(result.status).json(body);
  } catch (error) {
    console.error('Error en /api/confirmar:', error.code || error.name || 'Error', error.message);
    return res.status(500).json({ error: 'Error del servidor' });
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (req.path.startsWith('/api')) {
    const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
    const message = status === 500 ? 'Error del servidor' : 'Solicitud inválida';
    return res.status(status).json({ error: message });
  }

  return res.status(500).send('Error del servidor');
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Ruta no encontrada' });
  }

  return res.sendFile(path.join(publicDir, 'index.html'));
});

async function boot() {
  if (pool) {
    await pool.query('SELECT 1');
  } else {
    await ensureCsvFile();

    if (process.platform !== 'win32') {
      await fs.promises.chmod(csvPath, 0o600);
    }
  }

  app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT} (${pool ? 'MySQL' : 'CSV local'})`);
  });
}

boot().catch(() => {
  console.error('No se pudo iniciar el servidor');
  if (pool) pool.end().catch(() => undefined);
  process.exit(1);
});
