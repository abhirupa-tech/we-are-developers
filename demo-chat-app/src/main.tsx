import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { RoomScreen } from './room/RoomScreen';
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

// ?view=room: the projector screen for a live room.
const view = new URLSearchParams(window.location.search).get('view');

createRoot(document.getElementById('root')!).render(view === 'room' ? <RoomScreen /> : app);
