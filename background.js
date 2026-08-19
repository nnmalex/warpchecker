const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
const ALARM_NAME = "warp-check";
const CHECK_PERIOD_MINUTES = 1;
const FETCH_TIMEOUT_MS = 8000;

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

async function checkWarp() {
  let state;
  try {
    const response = await fetch(TRACE_URL, {
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const trace = parseTrace(await response.text());
    const warp = trace.warp;

    if (warp === "on" || warp === "plus") {
      state = { status: STATUS.CONNECTED, detail: warp };
    } else if (warp === "off") {
      state = { status: STATUS.DISCONNECTED, detail: warp };
    } else {
      // Endpoint reachable but no recognisable warp field: don't accuse.
      state = { status: STATUS.UNKNOWN, detail: "unrecognised response" };
    }
  } catch (error) {
    // Offline, captive portal, DNS failure: unknown, never "disconnected".
    state = { status: STATUS.UNKNOWN, detail: String(error.message || error) };
  }

  state.lastChecked = Date.now();
  await chrome.storage.session.set({ warpState: state });

  const badge = BADGE[state.status];
  await chrome.action.setBadgeText({ text: badge.text });
  await chrome.action.setBadgeBackgroundColor({ color: badge.color });

  return state;
}

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
      .then(({ warpState }) => warpState || checkWarp())
      .then(sendResponse);
    return true;
  }
});

// The worker can be revived without onInstalled/onStartup firing (e.g. after an
// idle unload), so make sure the access level, alarm and a reading always exist.
allowContentScriptReads();
ensureAlarm();
chrome.storage.session.get("warpState").then(({ warpState }) => {
  if (!warpState) checkWarp();
});
