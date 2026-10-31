import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import contribute from "../../index.client.tsx";

import { installSelectionBar } from "quote-under-test";
import { installMarkdownCopy, selectedMarkdown } from "../../client/selection.ts";
import { sourceMarkdown } from "../../shared/source-markdown.ts";
import { drawFormula } from "../../client/canvas.ts";
import { renderToCanvas } from "../../node_modules/ratex-wasm/dist/renderer.js";

const colors = { foreground: "#e6e6e6", foregroundMuted: "#9aa0a6", border: "#333", surface0: "#111", surface1: "#181818", surface2: "#222", accent: "#4c8dff" };
window.calls = [];
const parent = {
  refresh: async () => ({ agent: { id: "agent", workspaceId: "workspace", provider: "test", model: "model", status: "idle" } }),
  current: () => null,
  timeline: { refetch: async () => ({ entries: [] }) },
  send: async (text, options) => window.calls.push({ type: "send", text, options }),
};
const host = {
  paseo: { agents: { ref: () => parent }, workspaces: { ref: () => ({ agents: {
    create: async (input) => { window.calls.push({ type: "side", input }); return { id: "side" }; },
  } }) } },
  openPanel: (...args) => window.calls.push({ type: "panel", args }),
};
const registrations = [];
contribute(new Proxy({}, { get: (_target, key) => (...args) => { registrations.push({ key, args }); return () => {}; } }));
const RatexMessage = registrations.find(entry => entry.key === 'addTimelineRenderer').args[0].Component;
window.transformers = registrations.filter((entry) => entry.key === "addTimelineTransformer").map((entry) => entry.args[0].query.itemType);
window.drawFormula = drawFormula;
window.referenceCanvas = renderToCanvas;
window.selectedMarkdown = selectedMarkdown;
window.installMarkdownCopy = installMarkdownCopy;
window.sourceMarkdown = sourceMarkdown;
window.copyWrites = [];
// A fixture-owned observer, not a production global handler: proves one copy handling per mount.
let stopQuote;
window.toggleQuote = (enabled) => { stopQuote?.(); stopQuote = enabled ? installSelectionBar(host) : undefined; };
window.toggleQuote(true);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Fixture() {
  const [state, set] = useState({ text: "Known $x^2$ value", key: 0, light: false, mounted: true });
  window.setMessage = (changes) => set((previous) => ({ ...previous, ...changes }));
  useEffect(() => { document.body.style.background = state.light ? "#fff" : "#111"; }, [state.light]);
  return <div data-testid="workspace-pane-main" style={{ maxWidth: 850, margin: "80px auto 0" }}>
    <button data-testid="workspace-tab-agent_agent" aria-selected="true">Agent</button>
    <div data-testid="agent-chat-scroll">
      <div id="native-user" style={{ display: "flex", justifyContent: "flex-end" }}><div>Native user $x$</div></div>
      <div id="message" data-source={state.text} key={state.key}>{state.mounted && <RatexMessage agentId="agent" item={{ id: "message", data: { text: state.text } }}
        theme={{ colors: state.light ? { ...colors, foreground: "#111", foregroundMuted: "#555" } : colors }} layout={{ compact: false, platform: "web" }} />}</div>
      <div id="other-message">Other message</div>
    </div>
    <textarea data-composer-input style={{ width: "95%", height: 90, marginTop: 24 }} />
  </div>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>);
