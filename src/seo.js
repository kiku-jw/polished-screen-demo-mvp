const defaultPage = {
  path: '/',
  title: 'PolishMP4 - rough screen recording to polished demo MP4',
  h1: 'Turn a rough screen recording into a polished SaaS demo MP4.',
  lede: 'Upload a short product walkthrough. Get a watermarked preview with clean framing, focus highlights, chapter callouts, and a paid clean export.'
};

const seoPages = [
  ['screen-recording-to-tutorial', 'Screen recording to tutorial video', 'Turn a raw screen recording into a polished tutorial video.'],
  ['product-demo-from-screen-recording', 'Product demo from screen recording', 'Turn a rough product walkthrough into a clean SaaS demo MP4.'],
  ['loom-to-tutorial-video', 'Loom to tutorial video', 'Upload a Loom-style recording and generate a more polished tutorial preview.'],
  ['saas-onboarding-video-from-recording', 'SaaS onboarding video from recording', 'Create a clean onboarding MP4 from a short product screen recording.'],
  ['training-video-from-screen-recording', 'Training video from screen recording', 'Polish a screen capture into a useful software training video.'],
  ['screen-recording-with-zoom-and-clicks', 'Screen recording with zoom and clicks', 'Add cleaner framing, focus highlights, and chapter callouts to a screen recording.'],
  ['how-to-make-a-polished-product-demo', 'How to make a polished product demo', 'Skip timeline editing and turn a rough walkthrough into a clean product demo.'],
  ['turn-rough-demo-into-mp4', 'Turn rough demo into MP4', 'Generate a watermarked polished preview and pay only when the clean MP4 is useful.'],
  ['startup-launch-demo-video', 'Startup launch demo video', 'Create a launch-ready product demo MP4 from a quick screen recording.'],
  ['changelog-video-from-screen-recording', 'Changelog video from screen recording', 'Convert a feature walkthrough into a clean changelog video.'],
  ['help-center-video-from-screen-recording', 'Help center video from screen recording', 'Make a short support tutorial MP4 from a rough screen recording.'],
  ['feature-demo-video-maker', 'Feature demo video maker', 'Upload a feature walkthrough and get a polished MP4 preview in minutes.'],
  ['product-hunt-demo-video', 'Product Hunt demo video', 'Prepare a clean Product Hunt demo video from a simple screen recording.'],
  ['screen-recording-to-video-documentation', 'Screen recording to video documentation', 'Turn short product recordings into cleaner video documentation.'],
  ['cursor-zoom-screen-recording', 'Cursor zoom screen recording', 'Improve a product screen recording with zoom-style focus moments.'],
  ['click-highlight-screen-recording', 'Click highlight screen recording', 'Add visible focus highlights and step callouts to a screen recording.'],
  ['quick-saas-demo-video', 'Quick SaaS demo video', 'Create a polished SaaS demo MP4 without opening a timeline editor.'],
  ['mp4-tutorial-from-loom', 'MP4 tutorial from Loom', 'Transform a Loom export into a cleaner tutorial MP4 preview.'],
  ['software-tutorial-video-from-screen-recording', 'Software tutorial video from screen recording', 'Polish a software screen capture into a tutorial video.'],
  ['founder-demo-video-tool', 'Founder demo video tool', 'A no-call founder tool for turning rough product recordings into clean demo MP4s.']
].map(([slug, title, h1]) => ({
  path: `/${slug}`,
  title: `${title} - PolishMP4`,
  h1,
  lede: defaultPage.lede
}));

function landingPageForPath(requestPath) {
  return seoPages.find((page) => page.path === requestPath) || defaultPage;
}

function seoPaths() {
  return seoPages.map((page) => page.path);
}

module.exports = {
  defaultPage,
  landingPageForPath,
  seoPaths
};
