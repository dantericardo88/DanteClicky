import { Component } from "react";
import type React from "react";

export class SettingsErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: "#FF453A", fontSize: 12, fontFamily: "monospace", wordBreak: "break-word" }}>
          Settings error: {this.state.error.message}
          <br />
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 8, padding: "4px 8px", cursor: "pointer" }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
