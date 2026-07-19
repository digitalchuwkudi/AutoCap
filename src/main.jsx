import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("React Error Boundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "40px 20px", color: "#ff6b6b", background: "#0f0505", minHeight: "100vh", fontFamily: "sans-serif" }}>
          <h1 style={{ fontSize: 24, marginBottom: 10 }}>Application Error</h1>
          <p style={{ marginBottom: 20 }}>The application encountered an unexpected error. Refreshing the page may resolve this.</p>
          <pre style={{ background: "#200808", padding: 20, borderRadius: 8, overflowX: "auto", fontSize: 13, border: "1px solid #4a1010" }}>
            {this.state.error?.stack || this.state.error?.message || "Unknown error"}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
