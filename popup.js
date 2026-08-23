const dot = document.getElementById("dot");
const headline = document.getElementById("headline");
const detail = document.getElementById("detail");
const checked = document.getElementById("checked");
const footer = document.getElementById("footer");
const recheck = document.getElementById("recheck");

const COPY = {
  connected: {
    headline: "WARP is connected",
    detail: "Your traffic is going through Cloudflare WARP.",
  },
  disconnected: {
    headline: "WARP is not connected",
    detail: "Open the Cloudflare WARP app and connect.",
  },
  unknown: {
    headline: "Status unknown",
    detail:
      "Cloudflare could not be reached, so WARP status could not be checked. This usually means you are offline.",
  },
};

function disconnectedDetail(policy) {
  if (policy?.customMessage) return policy.message;
  return `${COPY.disconnected.detail} A warning banner is showing on your open tabs until you do.`;
}

function render(state, policy) {
  const status = state?.status;
  const copy = COPY[status];

  dot.className = `dot ${status || ""}`;

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
