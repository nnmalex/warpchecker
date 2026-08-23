const HOST_ID = "warp-checker-banner-host";

// The banner's wording, and whether this platform gets one at all, are both
// decided by the service worker — the only context that can read managed
// policy and the platform. Until it answers, assume the unmanaged defaults.
const DEFAULT_POLICY = {
  enabled: true,
  message: "Cloudflare WARP is not connected — please connect before continuing.",
};

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
    gap: 14px;
    box-sizing: border-box;
    padding: 12px 19px;
    background: #b3261e;
    color: #ffffff;
    font: 500 17px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  .icon { flex: none; font-size: 19px; }
  .text { flex: 1 1 auto; }
  .close {
    flex: none;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 22px;
    line-height: 1;
    padding: 2px 7px;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0.85;
  }
  .close:hover { background: rgba(255, 255, 255, 0.18); opacity: 1; }
`;

let host = null;
let dismissed = false;
let policy = DEFAULT_POLICY;
let state = null;
// What the visible banner actually says, so a policy change that rewords it is
// noticed even though the rest of the banner is unchanged.
let rendered = null;

function removeBanner() {
  host?.remove();
  host = null;
  rendered = null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function showBanner() {
  if (!document.documentElement) return;
  if (host && rendered === policy.message) return;
  // Rewording is rare enough that rebuilding beats keeping a handle on the
  // text node alive across renders.
  removeBanner();

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

  bar.append(icon, el("span", "text", policy.message), close);
  root.appendChild(bar);
  document.documentElement.appendChild(host);
  rendered = policy.message;
}

function render() {
  const disconnected = state?.status === "disconnected";

  // Leaving the disconnected state clears a dismissal, so the banner comes
  // back if WARP drops again without a page reload.
  if (!disconnected) dismissed = false;

  // An administrator can limit the extension to certain operating systems; on
  // the others it is silent, and no state ever arrives to draw from anyway.
  if (disconnected && !dismissed && policy.enabled) showBanner();
  else removeBanner();
}

chrome.runtime
  .sendMessage({ type: "getState" })
  .then((response) => {
    state = response?.state ?? null;
    policy = response?.policy ?? policy;
    render();
  })
  .catch(() => {
    // Worker not reachable yet (e.g. during an extension reload); the storage
    // listener below will deliver the state as soon as the next check lands.
  });

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session") return;

  if (changes.warpState) state = changes.warpState.newValue;
  if (changes.warpPolicy) policy = changes.warpPolicy.newValue ?? DEFAULT_POLICY;
  if (changes.warpState || changes.warpPolicy) render();
});
