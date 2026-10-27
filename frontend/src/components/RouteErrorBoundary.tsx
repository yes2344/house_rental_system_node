import { Component, type ErrorInfo, type ReactNode } from "react";

interface RouteErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("A page failed to render.", error, errorInfo);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
