import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { IdentityProvider } from './state/identity';
import { PromptAssistProvider } from './state/promptAssist';
import { App } from './App';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <IdentityProvider>
        <PromptAssistProvider>
          <App />
        </PromptAssistProvider>
      </IdentityProvider>
    </BrowserRouter>
  </StrictMode>
);
