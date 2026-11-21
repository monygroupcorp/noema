import { Component, type ReactNode } from 'react';
import { api } from '../lib/api';

// Catches render/commit errors in a subtree (e.g. a WebGL Canvas failing) and shows a fallback
// instead of tearing down the whole app. The caught error is also reported (noema/
// user-behaviour-corpus clause 4) — a render failure used to just show the fallback and
// vanish; now it reaches the server the same way an uncaught error elsewhere does.
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { api.reportClientError(`ErrorBoundary: ${error.message}`); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
