const HOST_ID = "warp-checker-banner-host";
const MESSAGE =
  "Cloudflare WARP is not connected — please connect before continuing.";

const STYLES = `
  :host { all: initial; }
  .bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
    padding: 10px 16px;
    background: #b3261e;
    color: #ffffff;
    font: 500 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  .icon { flex: none; font-size: 16px; }
  .text { flex: 1 1 auto; }
  .close {
    flex: none;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 18px;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0.85;
  }
  .close:hover { background: rgba(255, 255, 255, 0.18); opacity: 1; }
`;

let host = null;
let dismissed = false;

function removeBanner() {
  host?.remove();
  host = null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function showBanner() {
  if (host || !document.documentElement) return;

  host = document.createElement("div");
  host.id = HOST_ID;

  // The banner is built with DOM APIs rather than innerHTML so that pages
  // enforcing Trusted Types cannot block it.
  const root = host.attachShadow({ mode: "closed" });
  root.appendChild(el("style", null, STYLES));

  const bar = el("div", "bar");
  bar.setAttribute("role", "alert");

  const icon = el("span", "icon", "⚠");
  icon.setAttribute("aria-hidden", "true");

  const close = el("button", "close", "✕");
  close.type = "button";
  close.title = "Dismiss";
  close.setAttribute("aria-label", "Dismiss");
  close.addEventListener("click", () => {
    dismissed = true;
    removeBanner();
  });

  bar.append(icon, el("span", "text", MESSAGE), close);
  root.appendChild(bar);
  document.documentElement.appendChild(host);
}

function render(state) {
  const disconnected = state?.status === "disconnected";

  // Leaving the disconnected state clears a dismissal, so the banner comes
  // back if WARP drops again without a page reload.
  if (!disconnected) dismissed = false;

  if (disconnected && !dismissed) showBanner();
  else removeBanner();
}

chrome.runtime
  .sendMessage({ type: "getState" })
  .then(render)
  .catch(() => {
    // Worker not reachable yet (e.g. during an extension reload); the storage
    // listener below will deliver the state as soon as the next check lands.
  });

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && changes.warpState) {
    render(changes.warpState.newValue);
  }
});
