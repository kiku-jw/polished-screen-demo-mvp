const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { formidable } = require('formidable');
const Stripe = require('stripe');
const { config } = require('./config');
const {
  ensureStorage,
  getJob,
  saveJob,
  updateJob,
  listJobs,
  listAnalytics
} = require('./db');
const { trackEvent, allowedEvents, bucketDuration, bucketFileSize } = require('./analytics');
const { probeMedia } = require('./render/ffmpeg');
const { RenderQueue, cleanupExpiredFiles, eventPayload } = require('./queue');
const { landingPageForPath, seoPaths } = require('./seo');

const allowedExtensions = new Set(['.mp4', '.webm', '.mov']);
const queue = new RenderQueue();
const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;

async function main() {
  await ensureStorage();
  const app = express();

  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);
  app.use(express.json({ limit: '1mb' }));
  app.use('/media/previews', express.static(config.previewDir, { fallthrough: false }));
  app.use(express.static(config.publicDir, { index: false }));

  app.post('/api/events', async (req, res) => {
    const name = req.body && req.body.name;
    if (!allowedEvents.has(name)) {
      res.status(400).json({ error: 'Unknown analytics event.' });
      return;
    }
    await trackEvent(name, req.body.payload || {});
    res.json({ ok: true });
  });

  app.get('/api/config', (req, res) => {
    res.json({
      appName: config.appName,
      maxFreeBytes: config.maxFreeBytes,
      maxFreeDurationSeconds: config.maxFreeDurationSeconds,
      cleanExportPriceCents: config.cleanExportPriceCents,
      stripeConfigured: Boolean(stripe),
      mockPaymentsAllowed: config.allowMockPayments
    });
  });

  app.post('/api/uploads/start', async (req, res) => {
    await trackEvent('upload_start', req.body || {});
    res.json({
      ok: true,
      uploadMode: 'multipart',
      completeUrl: '/api/uploads/complete',
      limits: {
        maxBytes: config.maxFreeBytes,
        maxDurationSeconds: config.maxFreeDurationSeconds,
        acceptedExtensions: Array.from(allowedExtensions)
      }
    });
  });

  app.post('/api/uploads/complete', async (req, res) => {
    try {
      await enforceUploadCaps(req);
      const result = await parseUpload(req);
      res.json({ job: publicJob(result.job) });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message || 'Upload failed.' });
    }
  });

  app.get('/api/jobs/:jobId', async (req, res) => {
    const job = await getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    res.json({ job: publicJob(job) });
  });

  app.post('/api/checkout', async (req, res) => {
    const job = await getJob(req.body.jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    if (job.state !== 'preview_ready' && job.state !== 'paid' && job.state !== 'export_ready') {
      res.status(409).json({ error: 'Preview is not ready yet.' });
      return;
    }

    await trackEvent('export_click', eventPayload(job));

    if (!stripe) {
      if (config.allowMockPayments) {
        await trackEvent('checkout_started', eventPayload(job));
        res.json({
          mockPaymentsAllowed: true,
          message: 'Stripe is not configured. Local mock payment is available.'
        });
        return;
      }
      res.status(503).json({ error: 'Stripe is not configured.' });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: config.cleanExportPriceCents,
            product_data: {
              name: 'Clean polished MP4 export'
            }
          },
          quantity: 1
        }
      ],
      customer_email: job.email || undefined,
      metadata: { jobId: job.id },
      success_url: `${config.baseUrl}/?job=${job.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.baseUrl}/?job=${job.id}&checkout=cancelled`
    });

    await updateJob(job.id, (current) => ({
      ...current,
      state: 'checkout_started',
      stripeSessionId: session.id,
      updatedAt: new Date().toISOString()
    }));
    await trackEvent('checkout_started', eventPayload(job));
    res.json({ checkoutUrl: session.url });
  });

  app.post('/api/checkout/confirm', async (req, res) => {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe is not configured.' });
      return;
    }
    const job = await getJob(req.body.jobId);
    if (!job || job.stripeSessionId !== req.body.sessionId) {
      res.status(404).json({ error: 'Checkout session not found for this job.' });
      return;
    }
    const session = await stripe.checkout.sessions.retrieve(req.body.sessionId);
    if (session.payment_status !== 'paid') {
      res.status(409).json({ error: 'Payment is not complete yet.' });
      return;
    }
    await markPaid(job.id, session.id);
    res.json({ job: publicJob(await getJob(job.id)) });
  });

  app.post('/api/dev/mark-paid', async (req, res) => {
    if (!config.allowMockPayments) {
      res.status(403).json({ error: 'Mock payments are disabled.' });
      return;
    }
    const job = await getJob(req.body.jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    await markPaid(job.id, 'dev_mock');
    res.json({ job: publicJob(await getJob(job.id)) });
  });

  app.get('/api/download/:token', async (req, res) => {
    const jobs = await listJobs();
    const job = jobs.find((candidate) => candidate.downloadToken === req.params.token);
    if (!job || job.state !== 'export_ready' || !job.paths || !job.paths.export) {
      res.status(404).send('Export not found.');
      return;
    }
    await trackEvent('export_downloaded', eventPayload(job, { paidStatus: 'paid' }));
    res.download(job.paths.export, `${safeFilename(job.title || job.productName || 'polished-demo')}.mp4`);
  });

  app.get('/api/admin/jobs', async (req, res) => {
    if (config.adminKey && req.query.key !== config.adminKey && req.get('x-admin-key') !== config.adminKey) {
      res.status(401).json({ error: 'Admin key required.' });
      return;
    }
    const jobs = await listJobs();
    const analytics = await listAnalytics();
    res.json({
      jobs: jobs.map(adminJob),
      analytics: analytics.slice(-250)
    });
  });

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(config.publicDir, 'admin.html'));
  });

  app.get(['/', ...seoPaths()], sendLandingPage);
  app.use(sendLandingPage);

  await requeuePendingJobs();
  await cleanupExpiredFiles(config, listJobs, updateJob);
  setInterval(() => {
    cleanupExpiredFiles(config, listJobs, updateJob).catch((error) => {
      console.error('Cleanup failed:', error);
    });
  }, 60 * 60 * 1000);

  app.listen(config.port, () => {
    console.log(`${config.appName} MVP listening on ${config.baseUrl}`);
  });
}

async function parseUpload(req) {
  const form = formidable({
    uploadDir: config.tmpDir,
    keepExtensions: true,
    maxFileSize: config.maxFreeBytes,
    multiples: false,
    filter: (part) => part.name === 'recording'
  });

  const { fields, files } = await new Promise((resolve, reject) => {
    form.parse(req, (error, parsedFields, parsedFiles) => {
      if (error) {
        error.statusCode = error.httpCode || 400;
        reject(error);
        return;
      }
      resolve({ fields: parsedFields, files: parsedFiles });
    });
  });

  const file = first(files.recording);
  if (!file) {
    throw httpError(400, 'Upload an MP4, WebM, or MOV screen recording.');
  }
  const originalFilename = file.originalFilename || 'recording.mp4';
  const extension = path.extname(originalFilename).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    await unlinkIfExists(file.filepath);
    throw httpError(400, 'Only MP4, WebM, and MOV uploads are accepted.');
  }

  const metadata = await probeMedia(file.filepath);
  if (!metadata.duration || metadata.duration > config.maxFreeDurationSeconds) {
    await unlinkIfExists(file.filepath);
    throw httpError(400, `Free previews are limited to ${config.maxFreeDurationSeconds} seconds.`);
  }

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const email = value(fields.email);
  try {
    await enforceEmailCap(email);
  } catch (error) {
    await unlinkIfExists(file.filepath);
    throw error;
  }

  const jobId = crypto.randomUUID();
  const inputPath = path.join(config.uploadDir, `${jobId}${extension}`);
  const previewPath = path.join(config.previewDir, `${jobId}-preview.mp4`);
  const exportPath = path.join(config.exportDir, `${jobId}-clean.mp4`);
  await fs.rename(file.filepath, inputPath);

  const job = {
    id: jobId,
    state: 'uploaded',
    processingKind: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    visitorId: value(fields.visitorId) || 'anonymous',
    sourcePage: value(fields.sourcePage) || '/',
    ip,
    email,
    productName: value(fields.productName),
    title: value(fields.title),
    steps: parseSteps(value(fields.steps)),
    source: {
      originalFilename,
      size: file.size,
      extension
    },
    metadata,
    paths: {
      input: inputPath,
      preview: previewPath,
      export: exportPath
    },
    paidAt: null,
    stripeSessionId: null,
    downloadToken: null,
    error: null
  };

  await saveJob(job);
  await trackEvent('upload_success', {
    visitorId: job.visitorId,
    jobId: job.id,
    sourcePage: job.sourcePage,
    fileSizeBucket: bucketFileSize(job.source.size),
    durationBucket: bucketDuration(job.metadata.duration)
  });
  queue.add(job.id, 'preview');
  return { job };
}

async function enforceUploadCaps(req) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const jobs = await listJobs();
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const today = jobs.filter((job) => Date.parse(job.createdAt) > dayAgo);
  const previewsToday = today.filter((job) => job.state !== 'failed').length;
  if (previewsToday >= config.maxDailyPreviews) {
    throw httpError(429, 'Daily preview cap reached. Try again tomorrow.');
  }
  const ipUploads = today.filter((job) => job.ip === ip).length;
  if (ipUploads >= config.maxUploadsPerIpPerDay) {
    throw httpError(429, 'Upload limit reached for this connection today.');
  }
}

async function enforceEmailCap(email) {
  if (!email) return;
  const jobs = await listJobs();
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const emailUploads = jobs.filter((job) => job.email === email && Date.parse(job.createdAt) > dayAgo).length;
  if (emailUploads >= config.maxUploadsPerEmailPerDay) {
    throw httpError(429, 'Upload limit reached for this email today.');
  }
}

async function markPaid(jobId, paymentRef) {
  const updated = await updateJob(jobId, (current) => ({
    ...current,
    state: current.state === 'export_ready' ? 'export_ready' : 'paid',
    paidAt: current.paidAt || new Date().toISOString(),
    paymentRef,
    updatedAt: new Date().toISOString()
  }));
  if (!updated) return;
  await trackEvent('payment_completed', eventPayload(updated, { paidStatus: 'paid' }));
  queue.add(jobId, 'export');
}

async function handleStripeWebhook(req, res) {
  if (!stripe || !config.stripeWebhookSecret) {
    res.status(204).end();
    return;
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      config.stripeWebhookSecret
    );
  } catch (error) {
    res.status(400).send(`Webhook Error: ${error.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const jobId = session.metadata && session.metadata.jobId;
    if (jobId && session.payment_status === 'paid') {
      await markPaid(jobId, session.id);
    }
  }
  res.json({ received: true });
}

async function requeuePendingJobs() {
  const jobs = await listJobs();
  jobs.forEach((job) => {
    if (job.state === 'uploaded' || job.state === 'processing') queue.add(job.id, 'preview');
    if (job.state === 'paid') queue.add(job.id, 'export');
  });
}

function publicJob(job) {
  const previewReady = job.state === 'preview_ready' || job.state === 'checkout_started' || job.state === 'paid' || job.state === 'export_ready';
  return {
    id: job.id,
    state: job.state,
    processingKind: job.processingKind,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    productName: job.productName,
    title: job.title,
    steps: job.steps || [],
    metadata: job.metadata,
    previewMetadata: job.previewMetadata || null,
    exportMetadata: job.exportMetadata || null,
    renderDurationMs: job.renderDurationMs || null,
    exportRenderDurationMs: job.exportRenderDurationMs || null,
    error: job.error,
    paid: Boolean(job.paidAt),
    previewUrl: previewReady && job.paths && job.paths.preview ? `/media/previews/${path.basename(job.paths.preview)}` : null,
    downloadUrl: job.state === 'export_ready' && job.downloadToken ? `/api/download/${job.downloadToken}` : null
  };
}

function adminJob(job) {
  return {
    ...publicJob(job),
    email: job.email,
    source: job.source,
    paymentRef: job.paymentRef || null
  };
}

async function sendLandingPage(req, res) {
  const html = await fs.readFile(path.join(config.publicDir, 'index.html'), 'utf8');
  const page = landingPageForPath(req.path);
  res.type('html').send(
    html
      .replace(
        '<title>PolishMP4 - rough screen recording to polished demo MP4</title>',
        `<title>${escapeHtml(page.title)}</title>`
      )
      .replace(
        'Turn a rough screen recording into a polished SaaS demo MP4.',
        escapeHtml(page.h1)
      )
      .replace(
        'Upload a short product walkthrough. Get a watermarked preview with clean framing, focus highlights, chapter callouts, and a paid clean export.',
        escapeHtml(page.lede)
      )
  );
}

function parseSteps(input) {
  if (!input) return [];
  return String(input)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function first(valueToRead) {
  return Array.isArray(valueToRead) ? valueToRead[0] : valueToRead;
}

function value(valueToRead) {
  const item = first(valueToRead);
  return typeof item === 'string' ? item.trim() : '';
}

function safeFilename(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'polished-demo';
}

function escapeHtml(input) {
  return String(input).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
