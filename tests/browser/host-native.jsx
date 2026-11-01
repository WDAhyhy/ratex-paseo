// Source boxes and buttons use production components; only host hooks are substituted.
import { createPortal } from "react-dom";
export const Modal = Object.assign(({ open, children }) => open ? createPortal(children, document.body) : null,
  { Content: ({ children }) => <div role="dialog">{children}</div> });
export const copyText = (text) => navigator.clipboard.writeText(text);
export const useToast = () => ({
  show: (message) => window.toasts.push(message),
  error: (message) => window.toasts.push(message),
});
window.toasts = [];
