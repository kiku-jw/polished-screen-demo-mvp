# PolishMP4 MVP

> **Status:** Parked validation MVP. Kept as a public reference; no active development is planned.

Validation MVP for turning a rough screen recording into a polished SaaS demo/tutorial MP4.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:4321`.

`npm run dev` enables local mock payments so the full preview -> checkout -> clean export path can be tested without Stripe keys. For real payments, set:

```bash
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
BASE_URL=https://your-domain.example
ALLOW_MOCK_PAYMENTS=0
```

## MVP Limits

- Free preview: 90 seconds / 250MB.
- Clean export: $19 via Stripe Checkout.
- One in-process render worker.
- Raw uploads expire after 7 days.
- Unpaid previews expire after 30 days.

## Verification

```bash
npm test
```

Smoke-test render locally:

```bash
ffmpeg -y -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=880:sample_rate=48000 -t 4 -c:v libx264 -pix_fmt yuv420p -c:a aac data/tmp/sample-upload.mp4
curl -F recording=@data/tmp/sample-upload.mp4 -F productName='Demo CRM' -F title='Pipeline walkthrough' -F $'steps=Open dashboard\nFilter deals\nExport report' -F visitorId='cli-smoke' -F sourcePage='/' http://localhost:4321/api/uploads/complete
```

## License

MIT.