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

// ── Administrator policy ────────────────────────────────────────────────────
// An admin force-installing the extension from the Google Admin console can
// attach settings to it; Chrome delivers them through chrome.storage.managed,
// shaped by managed-schema.json. Both settings are resolved here, in the one
// context that can read the platform, and the answer is published to session
// storage so the banner and the popup never have to work it out themselves.

const DEFAULT_MESSAGE =
  "Cloudflare WARP is not connected — please connect before continuing.";

// A banner is a fixed strip across the top of every page, so an over-long
// message would swallow the page rather than warn about it.
const MAX_MESSAGE_LENGTH = 300;

// Admins write the names they know; chrome.runtime.getPlatformInfo() answers in
// Chrome's own vocabulary. Keys are lower-cased with separators collapsed to a
// single space, so "Chrome_OS" and "chrome os" both land here.
const PLATFORM_ALIASES = {
  windows: "win",
  win: "win",
  macos: "mac",
  "mac os": "mac",
  "mac os x": "mac",
  osx: "mac",
  mac: "mac",
  chromeos: "cros",
  "chrome os": "cros",
  cros: "cros",
  linux: "linux",
  android: "android",
  fuchsia: "fuchsia",
  openbsd: "openbsd",
};

function normalisePlatform(value) {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return PLATFORM_ALIASES[key] ?? null;
}

// Being left off the list silences the extension completely, so a policy this
// cannot make sense of fails open rather than switching the extension off on a
// platform that was meant to have it. Anything unreadable — not a list, empty,
// or naming an operating system that is not recognised — is treated as no
// restriction at all, because a half-filled or mistyped form is a far likelier
// explanation than a deliberate request for silence, and an admin who wants
// that can simply not install the extension.
function enabledOn(platforms, os) {
  if (!Array.isArray(platforms) || platforms.length === 0) return true;

  const wanted = platforms.map(normalisePlatform);
  if (wanted.includes(null)) return true;

  return wanted.includes(os);
}

function sanitiseMessage(value) {
  if (typeof value !== "string") return null;

  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return null;

  return text.length > MAX_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
    : text;
}

// getPlatformInfo cannot change while the browser is running, so ask once.
let platformPromise;
function currentPlatform() {
  platformPromise ??= chrome.runtime
    .getPlatformInfo()
    .then((info) => info.os)
    .catch(() => null);
  return platformPromise;
}

async function resolvePolicy() {
  // Unmanaged installs have no managed store at all on some platforms, where
  // the read rejects rather than returning nothing.
  const managed = await chrome.storage.managed
    .get(["enabledPlatforms", "bannerMessage"])
    .catch(() => ({}));

  const os = await currentPlatform();
  const custom = sanitiseMessage(managed?.bannerMessage);
  const policy = {
    os,
    enabled: enabledOn(managed?.enabledPlatforms, os),
    message: custom ?? DEFAULT_MESSAGE,
    customMessage: custom !== null,
  };

  // This runs on every worker wake-up, and a write fires the change listeners
  // even when the value is identical — which would tear the banner down and
  // rebuild it for nothing. Only publish an actual change.
  const { warpPolicy: previous } = await chrome.storage.session.get("warpPolicy");
  if (previous && JSON.stringify(previous) === JSON.stringify(policy)) return previous;

  await chrome.storage.session.set({ warpPolicy: policy });
  return policy;
}

async function getPolicy() {
  const { warpPolicy } = await chrome.storage.session.get("warpPolicy");
  return warpPolicy ?? (await resolvePolicy());
}

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
  // The admin can change policy while the browser is open; Chrome pushes it
  // here, and republishing reaches open tabs through the session store. A
  // platform added to the list has to start checking again from a standing
  // start, which is what activate() is for.
  if (areaName === "managed") resolvePolicy().then(activate);
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

// On a platform the administrator left out, "off" means off: no polling, no
// badge, no banner. Only the popup speaks, to say why nothing is happening.
async function applyPolicy(policy) {
  if (policy.enabled) return ensureAlarm();

  await chrome.alarms.clear(ALARM_NAME);
  // Dropping the reading rather than keeping it stale clears the badge through
  // the change listener and empties the banner in every open tab.
  await chrome.storage.session.remove("warpState");
  await applyBadge(null);
}

// Bring the extension into line with a policy: stop where it does not apply,
// and make sure a reading exists where it does.
async function activate(policy) {
  await applyPolicy(policy);
  if (!policy.enabled) return;

  const { warpState } = await chrome.storage.session.get("warpState");
  // A restarted worker inherits the stored state but not the badge, so repaint
  // it from what is already known rather than waiting on the next check.
  if (warpState) await applyBadge(warpState);
  else await checkWarp();
}

// Install and browser startup both begin with session storage empty, so this
// one path covers them and a worker revived mid-session alike.
async function start() {
  allowContentScriptReads();
  await activate(await resolvePolicy());
}

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  // The alarm is cleared when policy turns the extension off, but one already
  // in flight can still arrive after that.
  if ((await getPolicy()).enabled) checkWarp();
});

async function currentState() {
  const { warpState } = await chrome.storage.session.get("warpState");
  if (!warpState) return checkWarp();

  // Answer from what is known so the banner appears without waiting on the
  // network; a stale reading is refreshed in the background and reaches the
  // page through the storage listener.
  if (Date.now() - warpState.lastChecked > STALE_MS) checkWarp();
  return warpState;
}

// State and policy travel together: a banner needs both, and a page that
// learned only one of them would draw the wrong thing until the other arrived.
// Where policy excludes the platform there is no state to send, and asking for
// one must not start the network traffic the policy exists to prevent.
async function answer(fresh) {
  const policy = await getPolicy();
  const state = policy.enabled ? await (fresh ? checkWarp() : currentState()) : null;
  return { state, policy };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "recheck") {
    answer(true).then(sendResponse);
    return true;
  }
  if (message?.type === "getState") {
    // Content scripts ask through here rather than reading session storage
    // directly, because on the very first page load they can race the
    // setAccessLevel call above. Messaging also wakes the worker if it is idle.
    answer(false).then(sendResponse);
    return true;
  }
});

// The worker can be revived without onInstalled/onStartup firing (e.g. after an
// idle unload), so make sure the access level, policy, alarm and a reading
// always exist.
start();
