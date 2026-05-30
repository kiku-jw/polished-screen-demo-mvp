const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { updateJob, getJob } = require('./db');
const { trackEvent, bucketDuration, bucketFileSize } = require('./analytics');
const { renderVideo } = require('./render/ffmpeg');

class RenderQueue {
  constructor() {
    this.queue = [];
    this.running = false;
  }

  add(jobId, kind) {
    if (!jobId || !kind) return;
    const exists = this.queue.some((item) => item.jobId === jobId && item.kind === kind);
    if (!exists) this.queue.push({ jobId, kind });
    this.runNext();
  }

  async runNext() {
    if (this.running) return;
    const item = this.queue.shift();
    if (!item) return;
    this.running = true;
    try {
      if (item.kind === 'preview') {
        await this.renderPreview(item.jobId);
      } else {
        await this.renderExport(item.jobId);
      }
    } finally {
      this.running = false;
      setImmediate(() => this.runNext());
    }
  }

  async renderPreview(jobId) {
    let job = await getJob(jobId);
    if (!job || job.state === 'preview_ready') return;
    const startedAt = Date.now();
    job = await updateJob(jobId, (current) => ({
      ...current,
      state: 'processing',
      processingKind: 'preview',
      updatedAt: new Date().toISOString(),
      error: null
    }));
    await trackEvent('processing_started', eventPayload(job));

    try {
      const previewMetadata = await renderVideo({
        inputPath: job.paths.input,
        outputPath: job.paths.preview,
        job,
        watermark: true
      });
      const renderDurationMs = Date.now() - startedAt;
      const updated = await updateJob(jobId, (current) => ({
        ...current,
        state: 'preview_ready',
        processingKind: null,
        previewMetadata,
        renderDurationMs,
        updatedAt: new Date().toISOString()
      }));
      await trackEvent('preview_generated', eventPayload(updated, { renderDurationMs }));
    } catch (error) {
      await markFailed(jobId, error);
    }
  }

  async renderExport(jobId) {
    let job = await getJob(jobId);
    if (!job || job.state === 'export_ready') return;
    const startedAt = Date.now();
    job = await updateJob(jobId, (current) => ({
      ...current,
      state: 'paid',
      processingKind: 'export',
      updatedAt: new Date().toISOString(),
      error: null
    }));

    try {
      const exportMetadata = await renderVideo({
        inputPath: job.paths.input,
        outputPath: job.paths.export,
        job,
        watermark: false
      });
      const renderDurationMs = Date.now() - startedAt;
      await updateJob(jobId, (current) => ({
        ...current,
        state: 'export_ready',
        processingKind: null,
        exportMetadata,
        exportRenderDurationMs: renderDurationMs,
        downloadToken: current.downloadToken || crypto.randomBytes(24).toString('hex'),
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      await markFailed(jobId, error);
    }
  }
}

function eventPayload(job, extra = {}) {
  return {
    visitorId: job.visitorId,
    jobId: job.id,
    sourcePage: job.sourcePage || '/',
    fileSizeBucket: bucketFileSize(job.source && job.source.size),
    durationBucket: bucketDuration(job.metadata && job.metadata.duration),
    paidStatus: job.paidAt ? 'paid' : 'free',
    ...extra
  };
}

async function markFailed(jobId, error) {
  const reason = error && error.message ? error.message.slice(0, 900) : 'Unknown render failure';
  const updated = await updateJob(jobId, (current) => ({
    ...current,
    state: 'failed',
    processingKind: null,
    error: reason,
    updatedAt: new Date().toISOString()
  }));
  if (updated) {
    await trackEvent('failed_processing_reason', eventPayload(updated, { failureReason: reason }));
  }
}

async function cleanupExpiredFiles(config, listJobs, updateJobRef) {
  const now = Date.now();
  const rawCutoff = now - config.rawRetentionDays * 24 * 60 * 60 * 1000;
  const previewCutoff = now - config.unpaidPreviewRetentionDays * 24 * 60 * 60 * 1000;
  const jobs = await listJobs();

  await Promise.all(
    jobs.map(async (job) => {
      const created = Date.parse(job.createdAt);
      if (Number.isFinite(created) && created < rawCutoff && job.paths && job.paths.input) {
        await unlinkIfExists(job.paths.input);
        await updateJobRef(job.id, (current) => ({
          ...current,
          paths: { ...current.paths, input: null },
          updatedAt: new Date().toISOString()
        }));
      }

      const unpaid = job.state !== 'paid' && job.state !== 'export_ready';
      if (unpaid && Number.isFinite(created) && created < previewCutoff && job.paths && job.paths.preview) {
        await unlinkIfExists(job.paths.preview);
        await updateJobRef(job.id, (current) => ({
          ...current,
          paths: { ...current.paths, preview: null },
          updatedAt: new Date().toISOString()
        }));
      }
    })
  );
}

async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

module.exports = {
  RenderQueue,
  cleanupExpiredFiles,
  eventPayload
};
