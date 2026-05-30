const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSteps, parseFps, buildFilter } = require('../src/render/ffmpeg');

test('render step callouts stay bounded for the MVP', () => {
  const steps = normalizeSteps({ steps: ['Open', 'Filter', 'Export', 'Share', 'Done', 'Ignored'] }, 80);
  assert.equal(steps.length, 5);
  assert.equal(steps[0].label, 'Open');
  assert.equal(steps[4].label, 'Done');
});

test('fps parser accepts ffprobe fractions', () => {
  assert.equal(parseFps('30000/1001'), 29.97);
  assert.equal(parseFps('0/0'), 0);
});

test('ffmpeg filter includes preview watermark and stable output label', () => {
  const filter = buildFilter({
    job: { title: 'Demo', steps: ['One'] },
    watermark: true,
    duration: 12
  });
  assert.match(filter, /WATERMARK PREVIEW/);
  assert.match(filter, /\[vout\]/);
});
