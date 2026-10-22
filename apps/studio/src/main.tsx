import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import ManagementApp from "./ManagementApp";
import "./style.css";
import "./workspace.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./replica.css";
import "./dashboard.css";
import "./management.css";

// Existing token-based shared previews stay read-only. All account routes use
// the management dashboard; creation remains in the host Agent through MCP.
const SharedPreview = lazy(() => import("./legacy"));
createRoot(document.getElementById("root")!).render(
  location.pathname === "/preview" && location.hash.length > 1 ? (
    <Suspense fallback={<p>正在读取预览…</p>}>
      <SharedPreview />
    </Suspense>
  ) : (
    <ManagementApp />
  ),
);
