import './polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SessionProvider } from './state/session';
import { IdentityProvider } from './state/identity';
import { ProjectProvider } from './state/project';
import { PromptAssistProvider } from './state/promptAssist';
import { App } from './App';
import { api } from './lib/api';
import './styles/app.css';

// noema/user-behaviour-corpus clause 4: catches what the ErrorBoundary cannot — an
// uncaught throw or a rejected promise outside any React render (e.g. a blocked
// localStorage call that still slips past the try/catch wrapping in lib/api.ts, or a
// rejection in an event handler). Without this, that class of failure had nowhere to land.
window.addEventListener('error', (event) => {
  api.reportClientError(`window.onerror: ${event.message}`);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
  api.reportClientError(`unhandledrejection: ${reason}`);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SessionProvider>
        <IdentityProvider>
          <ProjectProvider>
            <PromptAssistProvider>
              <App />
            </PromptAssistProvider>
          </ProjectProvider>
        </IdentityProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>
);
