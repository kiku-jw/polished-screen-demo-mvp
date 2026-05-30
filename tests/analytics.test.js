const test = require('node:test');
const assert = require('node:assert/strict');
const { bucketDuration, bucketFileSize, allowedEvents } = require('../src/analytics');

test('analytics buckets the required upload dimensions', () => {
  assert.equal(bucketDuration(12), '<30s');
  assert.equal(bucketDuration(90), '30-90s');
  assert.equal(bucketDuration(120), '90-180s');
  assert.equal(bucketFileSize(10 * 1024 * 1024), '<25MB');
  assert.equal(bucketFileSize(250 * 1024 * 1024), '100-250MB');
});

test('required MVP events are present', () => {
  [
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
  ].forEach((eventName) => assert.equal(allowedEvents.has(eventName), true));
});
