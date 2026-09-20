// The Content-Security-Policy the build stamps into index.html, kept here rather than in vite.config.ts
// so it can be asserted on without a test having to load the app's build config (and with it the react
// plugin). vite.config.ts is the only caller; csp.test.ts guards the two directives MapLibre depends on.
export const DEM_HOST = 'https://s3.amazonaws.com';

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // MapLibre builds its tile worker from a blob URL. Naming worker-src explicitly keeps blob: out of
  // script-src; child-src repeats it for browsers that predate worker-src.
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  // React sets inline styles and the CSS carries a data: SVG grain.
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${DEM_HOST}`,
  "font-src 'self'",
  // MapLibre reads the DEM tiles with fetch(), not as <img>, so the host is needed here as well as
  // in img-src. Leaflet's canvas hillshade only ever needed img-src, which is how this was missed.
  `connect-src 'self' ${DEM_HOST}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');
