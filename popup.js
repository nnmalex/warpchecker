const dot = document.getElementById("dot");
const headline = document.getElementById("headline");
const detail = document.getElementById("detail");
const checked = document.getElementById("checked");
const footer = document.getElementById("footer");
const recheck = document.getElementById("recheck");
const diagnostics = document.getElementById("diagnostics");
const diagText = document.getElementById("diag-text");
const copyButton = document.getElementById("copy");

const COPY = {
  connected: {
    headline: "WARP is connected",
    detail: "Your traffic is going through Cloudflare WARP.",
  },
  disconnected: {
    headline: "WARP is not connected",
    detail: "Open the Cloudflare WARP app and connect.",
  },
  // Readings stored before reasons were recorded carry none.
  unknown: {
    headline: "Status unknown",
    detail:
      "Cloudflare could not be reached, so WARP status could not be checked. This usually means you are offline.",
  },
};

// Why the status is unknown decides what the user should try, so each reason
// the worker records gets its own advice.
const UNKNOWN_COPY = {
  offline: {
    headline: "You're offline",
    detail: () =>
      "Your device has no network connection, so WARP status can't be checked. " +
      "Connect to Wi-Fi or a network cable; this will update by itself.",
  },
  timeout: {
    headline: "Cloudflare didn't answer in time",
    detail: () =>
      "Your connection may be slow or unstable. Try Re-check now. If this keeps " +
      "happening, something on your network may be holding up the request.",
  },
  http: {
    headline: "The status check was refused",
    detail: (state) =>
      `The network answered with ${state.detail || "an error"} instead of your ` +
      "WARP status. A firewall or proxy may be blocking cloudflare.com. " +
      "Contact your IT team and include the details below.",
  },
  unreachable: {
    headline: "Cloudflare could not be reached",
    detail: () =>
      "Check that you're online, then try Re-check now. On hotel or airport " +
      "Wi-Fi, open any website to sign in first. If other sites load fine, a " +
      "firewall, proxy or DNS filter may be blocking cloudflare.com.",
  },
  intercepted: {
    headline: "Your network answered instead of Cloudflare",
    detail: () =>
      "A web page came back in place of the status check. This is usually a " +
      "Wi-Fi sign-in page (open any website to sign in) or a block page from " +
      "a firewall.",
  },
  unrecognised: {
    headline: "Unexpected answer from Cloudflare",
    detail: () =>
      "Cloudflare answered, but without a WARP status. Try Re-check now. If " +
      "it persists, contact your IT team and include the details below.",
  },
};

function copyFor(state) {
  if (state?.status !== "unknown") return COPY[state?.status];
  const specific = UNKNOWN_COPY[state.reason];
  if (!specific) return COPY.unknown;
  return { headline: specific.headline, detail: specific.detail(state) };
}

// Plain text so it can be pasted into a help-desk ticket as-is.
function diagnosticsText(state, policy) {
  const browser = navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? navigator.userAgent;
  const lines = [
    `WARP Checker ${chrome.runtime.getManifest().version}`,
    `Status: ${state.status}`,
    state.reason && `Reason: ${state.reason}`,
    state.detail && `Detail: ${state.detail}`,
    state.attempts && `Attempts: ${state.attempts}`,
    state.lastChecked && `Checked: ${new Date(state.lastChecked).toISOString()}`,
    `Browser online: ${navigator.onLine}`,
    `OS: ${policy?.os ?? "unknown"}`,
    `Browser: ${browser}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function disconnectedDetail(policy) {
  if (policy?.customMessage) return policy.message;
  return `${COPY.disconnected.detail} A warning banner is showing on your open tabs until you do.`;
}

function render(state, policy) {
  const status = state?.status;
  const copy = copyFor(state);

  dot.className = `dot ${status || ""}`;
  diagnostics.hidden = !copy || policy?.enabled === false;
  if (!diagnostics.hidden) diagText.textContent = diagnosticsText(state, policy);

  // On an operating system the administrator left out, the popup is the only
  // part of the extension that says anything at all — and what it has to say
  // is that there is nothing to report, not that the status is unknown.
  if (policy?.enabled === false) {
    headline.textContent = "Not enabled on your OS";
    detail.textContent =
      "Your administrator has set WARP Checker to run on other operating " +
      "systems only, so it is not checking this device.";
    checked.textContent = "";
    footer.hidden = true;
    return;
  }
  footer.hidden = false;

  if (!copy) {
    headline.textContent = "Checking…";
    detail.textContent = "Contacting Cloudflare to read your connection status.";
    checked.textContent = "";
    return;
  }

  headline.textContent = copy.headline;
  detail.textContent =
    status === "disconnected" ? disconnectedDetail(policy) : copy.detail;
  checked.textContent = state.lastChecked
    ? `Checked ${new Date(state.lastChecked).toLocaleTimeString()}`
    : "";
}

let state = null;
let policy = null;

function apply(response) {
  state = response?.state ?? state;
  policy = response?.policy ?? policy;
  render(state, policy);
}

recheck.addEventListener("click", async () => {
  recheck.disabled = true;
  recheck.textContent = "Checking…";
  try {
    apply(await chrome.runtime.sendMessage({ type: "recheck" }));
  } finally {
    recheck.disabled = false;
    recheck.textContent = "Re-check now";
  }
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(diagText.textContent);
    copyButton.textContent = "Copied";
  } catch {
    // Clipboard access can be refused; selecting the text still lets the user
    // copy it by hand.
    getSelection().selectAllChildren(diagText);
    copyButton.textContent = "Press ⌘/Ctrl+C";
  }
  setTimeout(() => (copyButton.textContent = "Copy details"), 1500);
});

// Asked through the worker rather than read from storage, so that policy is
// resolved by the time the popup paints even on the very first open.
chrome.runtime
  .sendMessage({ type: "getState" })
  .then(apply)
  .catch(() => {});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session") return;
  if (changes.warpState) state = changes.warpState.newValue;
  if (changes.warpPolicy) policy = changes.warpPolicy.newValue;
  if (changes.warpState || changes.warpPolicy) render(state, policy);
});
