"use client";

import ExplorerSidebar from "./ExplorerSidebar";

export default function ExplorerShell({ children }) {
  return (
    <div className="agrimetry-explorer-shell">
      <ExplorerSidebar />
      <main className="agrimetry-explorer-main">{children}</main>
    </div>
  );
}

