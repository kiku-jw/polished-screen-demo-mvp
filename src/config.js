const path = require('node:path');

const rootDir = process.cwd();
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data');

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolFromEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

const config = {
  appName: process.env.APP_NAME || 'PolishMP4',
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 4321}`,
  port: numberFromEnv('PORT', 4321),
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  previewDir: path.join(dataDir, 'previews'),
  exportDir: path.join(dataDir, 'exports'),
  tmpDir: path.join(dataDir, 'tmp'),
  dbPath: path.join(dataDir, 'db.json'),
  maxFreeBytes: numberFromEnv('MAX_FREE_BYTES', 250 * 1024 * 1024),
  maxFreeDurationSeconds: numberFromEnv('MAX_FREE_DURATION_SECONDS', 90),
  maxDailyPreviews: numberFromEnv('MAX_DAILY_PREVIEWS', 25),
  maxUploadsPerIpPerDay: numberFromEnv('MAX_UPLOADS_PER_IP_PER_DAY', 5),
  maxUploadsPerEmailPerDay: numberFromEnv('MAX_UPLOADS_PER_EMAIL_PER_DAY', 5),
  outputWidth: numberFromEnv('OUTPUT_WIDTH', 1920),
  outputHeight: numberFromEnv('OUTPUT_HEIGHT', 1080),
  outputFps: Math.min(numberFromEnv('OUTPUT_FPS', 30), 60),
  cleanExportPriceCents: numberFromEnv('CLEAN_EXPORT_PRICE_CENTS', 1900),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  adminKey: process.env.ADMIN_KEY || '',
  allowMockPayments: boolFromEnv('ALLOW_MOCK_PAYMENTS', process.env.NODE_ENV !== 'production'),
  rawRetentionDays: numberFromEnv('RAW_RETENTION_DAYS', 7),
  unpaidPreviewRetentionDays: numberFromEnv('UNPAID_PREVIEW_RETENTION_DAYS', 30)
};

module.exports = { config, numberFromEnv, boolFromEnv };
