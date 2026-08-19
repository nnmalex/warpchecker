const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
const ALARM_NAME = "warp-check";
const CHECK_PERIOD_MINUTES = 1;
const FETCH_TIMEOUT_MS = 6000;

// A dropping tunnel takes the network down with it for a few seconds, so the
// first request after a disconnect fails and would read as "unknown" — leaving
// the user unwarned at the one moment they most need it. Measured on macOS,
// the endpoint becomes reachable again about 7s after the tunnel goes down, so
// keep retrying past that. The window is bounded by elapsed time rather than a
// number of attempts because a torn-down network rejects connections instantly,
// which would otherwise burn every attempt in a second or two.
// A genuinely offline machine fails the whole window and still lands on
// "unknown", which is the behaviour that keeps it from crying wolf.
const RETRY_WINDOW_MS = 20000;
const RETRY_GAP_MS = 2500;

// Polling alone means up to a full period of silence after a drop. Loading a
// page is the moment the warning actually matters, so a content script asking
// for state with a reading older than this triggers a refresh behind the
// answer it gets back.
const STALE_MS = 30000;

const STATUS = {
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  UNKNOWN: "unknown",
};

const BADGE = {
  [STATUS.CONNECTED]: { text: "", color: "#0b8043" },
  [STATUS.DISCONNECTED]: { text: "!", color: "#c5221f" },
  [STATUS.UNKNOWN]: { text: "?", color: "#8a8a8a" },
};

function parseTrace(body) {
  const values = {};
  for (const line of body.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) values[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return values;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchTrace() {
  const response = await fetch(TRACE_URL, {
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseTrace(await response.text());
}

function classify(trace) {
  const warp = trace.warp;
  if (warp === "on" || warp === "plus") {
    return { status: STATUS.CONNECTED, detail: warp };
  }
  if (warp === "off") {
    return { status: STATUS.DISCONNECTED, detail: warp };
  }
  // Reachable but no recognisable warp field: don't accuse.
  return { status: STATUS.UNKNOWN, detail: "unrecognised response" };
}

async function checkWarp() {
  let state;
  let lastError;
  const deadline = Date.now() + RETRY_WINDOW_MS;

  do {
    try {
      state = classify(await fetchTrace());
      break;
    } catch (error) {
      lastError = error;
      await sleep(RETRY_GAP_MS);
    }
  } while (Date.now() < deadline);

  // Every attempt failed: offline, captive portal, DNS still down. Unknown,
  // never "disconnected".
  state ??= { status: STATUS.UNKNOWN, detail: String(lastError?.message || lastError) };

  state.lastChecked = Date.now();
  await chrome.storage.session.set({ warpState: state });
  return state;
}

// The badge is derived from stored state rather than set alongside it, so the
// toolbar and the page banner always read from the same source of truth.
async function applyBadge(state) {
  const badge = BADGE[state?.status] ?? { text: "", color: "#8a8a8a" };
  await chrome.action.setBadgeText({ text: badge.text });
  await chrome.action.setBadgeBackgroundColor({ color: badge.color });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && changes.warpState) {
    applyBadge(changes.warpState.newValue);
  }
});

// Content scripts are untrusted contexts and cannot read session storage
// unless the access level is widened.
function allowContentScriptReads() {
  return chrome.storage.session
    .setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
    .catch(() => {});
}

// Creating an alarm that already exists restarts its countdown, so anything
// that wakes the worker often (opening the popup, say) could otherwise keep
// pushing the next check out of reach.
async function ensureAlarm() {
  if (await chrome.alarms.get(ALARM_NAME)) return;
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: CHECK_PERIOD_MINUTES,
    delayInMinutes: CHECK_PERIOD_MINUTES,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  allowContentScriptReads();
  ensureAlarm();
  checkWarp();
});

chrome.runtime.onStartup.addListener(() => {
  allowContentScriptReads();
  ensureAlarm();
  checkWarp();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkWarp();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "recheck") {
    checkWarp().then(sendResponse);
    return true;
  }
  if (message?.type === "getState") {
    // Content scripts ask through here rather than reading session storage
    // directly, because on the very first page load they can race the
    // setAccessLevel call above. Messaging also wakes the worker if it is idle.
    chrome.storage.session
      .get("warpState")
      .then(({ warpState }) => {
        if (!warpState) return checkWarp();
        // Answer from what is known so the banner appears without waiting on
        // the network; a stale reading is refreshed in the background and
        // reaches the page through the storage listener.
        if (Date.now() - warpState.lastChecked > STALE_MS) checkWarp();
        return warpState;
      })
      .then(sendResponse);
    return true;
  }
});

// The worker can be revived without onInstalled/onStartup firing (e.g. after an
// idle unload), so make sure the access level, alarm and a reading always exist.
allowContentScriptReads();
ensureAlarm();
chrome.storage.session.get("warpState").then(({ warpState }) => {
  // A restarted worker inherits the stored state but not the badge, so repaint
  // it from what is already known rather than waiting on the next check.
  if (warpState) applyBadge(warpState);
  else checkWarp();
});
