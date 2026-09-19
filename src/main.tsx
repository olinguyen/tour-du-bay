import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted fonts: only the faces guide.css uses, latin subset only (the
// content is English; the unsubsetted files would add ~70 unused woff/woff2 to
// dist). The family names these register ('Spectral', 'IBM Plex Mono') must
// match the --display/--sans stacks.
import '@fontsource/spectral/latin-300.css';
import '@fontsource/spectral/latin-300-italic.css';
import '@fontsource/spectral/latin-400.css';
import '@fontsource/spectral/latin-400-italic.css';
import '@fontsource/spectral/latin-500.css';
import '@fontsource/spectral/latin-500-italic.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/guide.css';
import './styles/variants.css';
import './styles/app.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
