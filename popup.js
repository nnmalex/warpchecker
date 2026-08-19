const dot = document.getElementById("dot");
const headline = document.getElementById("headline");
const detail = document.getElementById("detail");
const checked = document.getElementById("checked");
const recheck = document.getElementById("recheck");

const COPY = {
  connected: {
    headline: "WARP is connected",
    detail: "Your traffic is going through Cloudflare WARP.",
  },
  disconnected: {
    headline: "WARP is not connected",
    detail:
      "Open the Cloudflare WARP app and connect. A warning banner is showing on your open tabs until you do.",
  },
  unknown: {
    headline: "Status unknown",
    detail:
      "Cloudflare could not be reached, so WARP status could not be checked. This usually means you are offline.",
  },
};

function render(state) {
  const status = state?.status;
  const copy = COPY[status];

  dot.className = `dot ${status || ""}`;

  if (!copy) {
    headline.textContent = "Checking…";
    detail.textContent = "Contacting Cloudflare to read your connection status.";
    checked.textContent = "";
    return;
  }

  headline.textContent = copy.headline;
  detail.textContent = copy.detail;
  checked.textContent = state.lastChecked
    ? `Checked ${new Date(state.lastChecked).toLocaleTimeString()}`
    : "";
}

recheck.addEventListener("click", async () => {
  recheck.disabled = true;
  recheck.textContent = "Checking…";
  try {
    render(await chrome.runtime.sendMessage({ type: "recheck" }));
  } finally {
    recheck.disabled = false;
    recheck.textContent = "Re-check now";
  }
});

chrome.storage.session.get("warpState").then(({ warpState }) => {
  render(warpState);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && changes.warpState) {
    render(changes.warpState.newValue);
  }
});
