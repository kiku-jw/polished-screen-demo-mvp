const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { config } = require('../config');

const fontCandidates = [
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
];

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`${command} exited with ${code}: ${stderr.slice(-1200)}`);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function probeMedia(filePath) {
  const { stdout } = await runProcess('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath
  ]);
  const data = JSON.parse(stdout);
  const videoStream = (data.streams || []).find((stream) => stream.codec_type === 'video');
  const audioStream = (data.streams || []).find((stream) => stream.codec_type === 'audio');
  const duration = Number(data.format && data.format.duration) || Number(videoStream && videoStream.duration) || 0;
  const size = Number(data.format && data.format.size) || 0;
  return {
    duration,
    size,
    width: Number(videoStream && videoStream.width) || 0,
    height: Number(videoStream && videoStream.height) || 0,
    fps: parseFps(videoStream && videoStream.avg_frame_rate),
    videoCodec: (videoStream && videoStream.codec_name) || 'unknown',
    audioCodec: (audioStream && audioStream.codec_name) || null,
    hasAudio: Boolean(audioStream)
  };
}

function parseFps(value) {
  if (!value || value === '0/0') return 0;
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return Number((num / den).toFixed(2));
}

function normalizeSteps(job, duration) {
  const rawSteps = Array.isArray(job.steps) ? job.steps.filter(Boolean).slice(0, 5) : [];
  const count = rawSteps.length || Math.min(3, Math.max(1, Math.floor(duration / 20)));
  const labels = rawSteps.length ? rawSteps : [];
  const safeDuration = Math.max(duration || 12, 6);
  const spacing = safeDuration / (count + 1);

  return Array.from({ length: count }, (_, index) => {
    const start = Number(Math.max(1.2, spacing * (index + 1) - 0.8).toFixed(2));
    const end = Number(Math.min(safeDuration - 0.2, start + 2.4).toFixed(2));
    return {
      label: labels[index] || '',
      start,
      end,
      x: index % 2 === 0 ? 0.62 : 0.28,
      y: index % 3 === 0 ? 0.54 : 0.34
    };
  });
}

function escapeDrawtext(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function exprBetween(start, end) {
  return `between(t\\,${start}\\,${end})`;
}

function findFont() {
  return fontCandidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function buildFilter({ job, watermark, duration }) {
  const width = config.outputWidth;
  const height = config.outputHeight;
  const fps = config.outputFps;
  const steps = normalizeSteps(job, duration);
  const fontPath = findFont();
  const fontPart = fontPath ? `fontfile='${fontPath}'` : 'font=Arial';
  const zoomWindows = steps.map((step) => exprBetween(step.start, step.end));
  const zoomExpr = zoomWindows.length ? `1+0.10*(${zoomWindows.join('+')})` : '1';

  const filters = [
    `[0:v]setpts=PTS-STARTPTS,fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=18:2,eq=brightness=-0.055:saturation=0.78[bg]`,
    `[0:v]setpts=PTS-STARTPTS,fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x101419[fg]`,
    `[bg][fg]overlay=0:0[base]`,
    `[base]scale=w='${width}*(${zoomExpr})':h='${height}*(${zoomExpr})':eval=frame,crop=${width}:${height}:x='(iw-ow)/2':y='(ih-oh)/2'[polished]`
  ];

  let current = 'polished';
  steps.forEach((step, index) => {
    const next = `step${index}`;
    const boxWidth = Math.round(width * 0.18);
    const boxHeight = Math.round(height * 0.12);
    const x = Math.round(width * step.x - boxWidth / 2);
    const y = Math.round(height * step.y - boxHeight / 2);
    const enable = exprBetween(Number((step.start - 0.35).toFixed(2)), step.end);
    filters.push(
      `[${current}]drawbox=x=${x}:y=${y}:w=${boxWidth}:h=${boxHeight}:color=0xFFD84D@0.22:t=fill:enable='${enable}',drawbox=x=${x}:y=${y}:w=${boxWidth}:h=${boxHeight}:color=0xFFD84D@0.92:t=5:enable='${enable}'[${next}]`
    );
    current = next;

    if (step.label) {
      const textNext = `label${index}`;
      const label = escapeDrawtext(step.label);
      const textY = index % 2 === 0 ? 'h-154' : '70';
      filters.push(
        `[${current}]drawtext=${fontPart}:text='${label}':x=64:y=${textY}:fontsize=42:fontcolor=white:box=1:boxcolor=0x101419@0.84:boxborderw=24:enable='${exprBetween(step.start, step.end)}'[${textNext}]`
      );
      current = textNext;
    }
  });

  const title = escapeDrawtext(job.title || job.productName || 'Polished demo');
  filters.push(
    `[${current}]drawtext=${fontPart}:text='${title}':x=54:y=44:fontsize=32:fontcolor=white@0.92:box=1:boxcolor=0x101419@0.55:boxborderw=18[title]`
  );
  current = 'title';

  if (watermark) {
    filters.push(
      `[${current}]drawtext=${fontPart}:text='WATERMARK PREVIEW':x=w-tw-54:y=h-th-44:fontsize=34:fontcolor=white@0.86:box=1:boxcolor=0xC44A28@0.84:boxborderw=18[vout]`
    );
  } else {
    filters.push(`[${current}]copy[vout]`);
  }

  return filters.join(';');
}

async function renderVideo({ inputPath, outputPath, job, watermark }) {
  await fsPromises.mkdir(config.previewDir, { recursive: true });
  await fsPromises.mkdir(config.exportDir, { recursive: true });
  const metadata = job.metadata || (await probeMedia(inputPath));
  const filter = buildFilter({ job, watermark, duration: metadata.duration });
  const crf = watermark ? '18' : '16';

  await runProcess('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-filter_complex',
    filter,
    '-map',
    '[vout]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    crf,
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(config.outputFps),
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    '-shortest',
    outputPath
  ]);

  return probeMedia(outputPath);
}

module.exports = {
  runProcess,
  probeMedia,
  buildFilter,
  renderVideo,
  normalizeSteps,
  parseFps
};
