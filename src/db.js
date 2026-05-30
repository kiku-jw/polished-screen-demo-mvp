const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('./config');

const initialDb = {
  jobs: {},
  analytics: []
};

let writeChain = Promise.resolve();

async function ensureStorage() {
  await Promise.all([
    fs.mkdir(config.dataDir, { recursive: true }),
    fs.mkdir(config.uploadDir, { recursive: true }),
    fs.mkdir(config.previewDir, { recursive: true }),
    fs.mkdir(config.exportDir, { recursive: true }),
    fs.mkdir(config.tmpDir, { recursive: true })
  ]);

  try {
    await fs.access(config.dbPath);
  } catch {
    await writeDb(initialDb);
  }
}

async function readDb() {
  try {
    const raw = await fs.readFile(config.dbPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      jobs: parsed.jobs || {},
      analytics: Array.isArray(parsed.analytics) ? parsed.analytics : []
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { ...initialDb, jobs: {}, analytics: [] };
    throw error;
  }
}

async function writeDb(db) {
  const tmpPath = `${config.dbPath}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(config.dbPath), { recursive: true });
  await fs.writeFile(tmpPath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, config.dbPath);
}

function mutateDb(mutator) {
  writeChain = writeChain.then(async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  });
  return writeChain;
}

async function getJob(jobId) {
  const db = await readDb();
  return db.jobs[jobId] || null;
}

async function saveJob(job) {
  return mutateDb((db) => {
    db.jobs[job.id] = job;
    return job;
  });
}

async function updateJob(jobId, updater) {
  return mutateDb((db) => {
    const current = db.jobs[jobId];
    if (!current) return null;
    const next = updater(current);
    db.jobs[jobId] = next || current;
    return db.jobs[jobId];
  });
}

async function listJobs() {
  const db = await readDb();
  return Object.values(db.jobs).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function appendAnalyticsEvent(event) {
  return mutateDb((db) => {
    db.analytics.push(event);
    if (db.analytics.length > 5000) {
      db.analytics = db.analytics.slice(db.analytics.length - 5000);
    }
    return event;
  });
}

async function listAnalytics() {
  const db = await readDb();
  return db.analytics;
}

module.exports = {
  ensureStorage,
  readDb,
  writeDb,
  mutateDb,
  getJob,
  saveJob,
  updateJob,
  listJobs,
  appendAnalyticsEvent,
  listAnalytics
};
