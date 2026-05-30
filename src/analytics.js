const crypto = require('node:crypto');
const { appendAnalyticsEvent } = require('./db');

const allowedEvents = new Set([
  'landing_view',
  'upload_start',
  'upload_success',
  'processing_started',
  'preview_generated',
  'preview_watched',
  'paywall_view',
  'export_click',
  'checkout_started',
  'payment_completed',
  'export_downloaded',
  'failed_processing_reason'
]);

function bucketFileSize(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
  const mb = bytes / 1024 / 1024;
  if (mb < 25) return '<25MB';
  if (mb < 100) return '25-100MB';
  if (mb <= 250) return '100-250MB';
  return '>250MB';
}

function bucketDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'unknown';
  if (seconds < 30) return '<30s';
  if (seconds <= 90) return '30-90s';
  if (seconds <= 180) return '90-180s';
  return '>180s';
}

async function trackEvent(name, payload = {}) {
  if (!allowedEvents.has(name)) return null;
  const event = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    visitorId: payload.visitorId || 'anonymous',
    jobId: payload.jobId || null,
    sourcePage: payload.sourcePage || '/',
    fileSizeBucket: payload.fileSizeBucket || null,
    durationBucket: payload.durationBucket || null,
    renderDurationMs: payload.renderDurationMs || null,
    failureReason: payload.failureReason || null,
    paidStatus: payload.paidStatus || 'free'
  };
  return appendAnalyticsEvent(event);
}

module.exports = {
  allowedEvents,
  bucketFileSize,
  bucketDuration,
  trackEvent
};
