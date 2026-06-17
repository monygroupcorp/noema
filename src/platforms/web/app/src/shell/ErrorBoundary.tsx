import { Component, type ReactNode } from 'react';

// Catches render/commit errors in a subtree (e.g. a WebGL Canvas failing) and shows a fallback
// instead of tearing down the whole app.
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* swallow — fallback is shown */ }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
