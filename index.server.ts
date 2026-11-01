import type { PluginServerContext } from "@getpaseo/plugin/server";
import { renderLatex } from "./server/render";
import { renderLatexRpc, renderNativeLatexRpc } from "./shared/ratex";
import { renderNativeFormula } from "./server/native-render";

export default function contribute(server: PluginServerContext) {
  server.handle(renderLatexRpc, renderLatex);
  server.handle(renderNativeLatexRpc, renderNativeFormula);
  return () => {};
}
