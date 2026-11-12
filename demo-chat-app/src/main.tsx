import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FLAGS } from './config';
import 'highlight.js/styles/github-dark.css';
import './styles.css';
import './tailwind.css';

// StrictMode is off by default: it double-invokes renders in dev and would
// double every counter. ?strict=1 turns it on, in the dev build only.
const app = FLAGS.strict ? (
  <StrictMode>
    <App />
  </StrictMode>
) : (
  <App />
);

createRoot(document.getElementById('root')!).render(app);
