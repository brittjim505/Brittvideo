import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '../shared/styles.css';
import { App } from './App';
import { applySize } from '../shared/textsize';
applySize();

// Report unexpected browser errors so the owner never has to open developer tools (Q25).
const report = (message: string, where?: string) => {
  fetch('/api/diagnostics/client-error', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-BrittVideo': '1' },
    body: JSON.stringify({ message, where, route: location.pathname }) }).catch(() => {});
};
window.addEventListener('error', (e) => report(e.message, `${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => report(String((e.reason && e.reason.message) || e.reason)));

createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter basename="/app"><App /></BrowserRouter></React.StrictMode>);
