const state = {
  visitorId: localStorage.getItem('polishmp4VisitorId') || createVisitorId(),
  config: null,
  jobId: new URLSearchParams(location.search).get('job') || null,
  pollTimer: null,
  paywallTracked: false,
  previewTracked: false
};

localStorage.setItem('polishmp4VisitorId', state.visitorId);

const form = document.querySelector('#uploadForm');
const note = document.querySelector('#uploadNote');
const jobPanel = document.querySelector('#jobPanel');
const jobTitle = document.querySelector('#jobTitle');
const jobStatus = document.querySelector('#jobStatus');
const previewWrap = document.querySelector('#previewWrap');
const previewVideo = document.querySelector('#previewVideo');
const checkoutButton = document.querySelector('#checkoutButton');
const mockPayButton = document.querySelector('#mockPayButton');
const downloadWrap = document.querySelector('#downloadWrap');
const downloadLink = document.querySelector('#downloadLink');

init();

async function init() {
  state.config = await getJson('/api/config');
  note.textContent = `Free preview limit: ${formatMb(state.config.maxFreeBytes)} and ${state.config.maxFreeDurationSeconds} seconds.`;
  await track('landing_view');

  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session_id');
  if (state.jobId && sessionId) {
    await postJson('/api/checkout/confirm', { jobId: state.jobId, sessionId }).catch(() => null);
  }
  if (state.jobId) startPolling(state.jobId);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  note.textContent = 'Uploading...';

  try {
    const file = document.querySelector('#recording').files[0];
    if (!file) throw new Error('Choose a screen recording first.');
    await postJson('/api/uploads/start', {
      name: 'upload_start',
      visitorId: state.visitorId,
      sourcePage: location.pathname
    });

    const formData = new FormData(form);
    formData.append('visitorId', state.visitorId);
    formData.append('sourcePage', location.pathname);
    const response = await fetch('/api/uploads/complete', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Upload failed.');

    state.jobId = data.job.id;
    history.replaceState(null, '', `/?job=${state.jobId}`);
    note.textContent = 'Upload complete. Rendering preview...';
    startPolling(state.jobId);
  } catch (error) {
    note.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

checkoutButton.addEventListener('click', async () => {
  if (!state.jobId) return;
  checkoutButton.disabled = true;
  try {
    const response = await postJson('/api/checkout', { jobId: state.jobId });
    if (response.checkoutUrl) {
      location.href = response.checkoutUrl;
      return;
    }
    if (response.mockPaymentsAllowed) {
      mockPayButton.hidden = false;
      jobStatus.textContent = response.message;
      return;
    }
    throw new Error(response.error || 'Checkout is unavailable.');
  } catch (error) {
    jobStatus.textContent = error.message;
  } finally {
    checkoutButton.disabled = false;
  }
});

mockPayButton.addEventListener('click', async () => {
  if (!state.jobId) return;
  mockPayButton.disabled = true;
  await postJson('/api/dev/mark-paid', { jobId: state.jobId });
  startPolling(state.jobId);
});

previewVideo.addEventListener('play', () => {
  if (state.previewTracked || !state.jobId) return;
  state.previewTracked = true;
  track('preview_watched', { jobId: state.jobId });
});

document.querySelectorAll('[data-feedback]').forEach((button) => {
  button.addEventListener('click', () => {
    button.textContent = 'Saved';
    button.disabled = true;
    track('preview_watched', {
      jobId: state.jobId,
      feedback: button.dataset.feedback
    });
  });
});

function startPolling(jobId) {
  jobPanel.hidden = false;
  clearInterval(state.pollTimer);
  pollJob(jobId);
  state.pollTimer = setInterval(() => pollJob(jobId), 1600);
}

async function pollJob(jobId) {
  const { job } = await getJson(`/api/jobs/${jobId}`);
  renderJob(job);
  if (job.state === 'failed' || job.state === 'export_ready') {
    clearInterval(state.pollTimer);
  }
}

function renderJob(job) {
  jobTitle.textContent = titleForJob(job);
  jobStatus.textContent = statusForJob(job);

  if (job.previewUrl) {
    previewWrap.hidden = false;
    if (!previewVideo.src.endsWith(job.previewUrl)) previewVideo.src = job.previewUrl;
    if (!state.paywallTracked) {
      state.paywallTracked = true;
      track('paywall_view', { jobId: job.id });
    }
  }

  if (job.downloadUrl) {
    downloadWrap.hidden = false;
    downloadLink.href = job.downloadUrl;
    checkoutButton.hidden = true;
    mockPayButton.hidden = true;
  }
}

function titleForJob(job) {
  if (job.state === 'failed') return 'Render failed';
  if (job.state === 'export_ready') return 'Clean export ready';
  if (job.processingKind === 'export') return 'Rendering clean export';
  if (job.state === 'preview_ready' || job.state === 'checkout_started') return 'Preview ready';
  return 'Preparing preview';
}

function statusForJob(job) {
  if (job.error) return job.error;
  if (job.state === 'uploaded') return 'Queued for the render worker.';
  if (job.processingKind === 'preview') return 'Polishing the recording with stable 1080p output.';
  if (job.processingKind === 'export') return 'Removing watermark and preparing the paid MP4.';
  if (job.state === 'preview_ready') return 'Watermarked preview generated.';
  if (job.state === 'checkout_started') return 'Checkout started.';
  if (job.state === 'paid') return 'Payment received. Clean export queued.';
  if (job.state === 'export_ready') return 'Download link is ready.';
  return job.state;
}

async function track(name, payload = {}) {
  return postJson('/api/events', {
    name,
    payload: {
      visitorId: state.visitorId,
      sourcePage: location.pathname,
      ...payload
    }
  }).catch(() => null);
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function formatMb(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function createVisitorId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
