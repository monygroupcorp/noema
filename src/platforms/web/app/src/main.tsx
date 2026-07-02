import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SessionProvider } from './state/session';
import { IdentityProvider } from './state/identity';
import { ProjectProvider } from './state/project';
import { PromptAssistProvider } from './state/promptAssist';
import { App } from './App';
import './styles/app.css';

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
