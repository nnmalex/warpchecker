// End-to-end tests driven over the Chrome DevTools Protocol.
// Run via tools/test.sh, which starts a throwaway Chrome first.
//
// The extension is loaded through CDP rather than --load-extension because
// Chrome 137+ ignores that flag. It stays loaded only for the lifetime of the
// connection that loaded it, so loading and testing share one session.

const EXT_PATH = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const PORT = Deno.env.get("CDP_PORT") || "9222";
const HOST_SEL = "#warp-checker-banner-host";
const SHOTS = Deno.env.get("SHOT_DIR");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  #ws; #id = 0; #pending = new Map(); #listeners = [];

  static async connect() {
    const { webSocketDebuggerUrl } = await (
      await fetch(`http://127.0.0.1:${PORT}/json/version`)
    ).json();
    const c = new CDP();
    c.#ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      c.#ws.onopen = res;
      c.#ws.onerror = () => rej(new Error("cannot reach Chrome on port " + PORT));
    });
    c.#ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = c.#pending.get(msg.id);
        if (!p) return;
        c.#pending.delete(msg.id);
        msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
      } else {
        for (const fn of c.#listeners) fn(msg);
      }
    };
    return c;
  }

  on(fn) { this.#listeners.push(fn); }

  send(method, params = {}, sessionId) {
    const id = ++this.#id;
    return new Promise((res, rej) => {
      this.#pending.set(id, { res, rej });
      this.#ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => {
        if (this.#pending.delete(id)) rej(new Error(`timeout: ${method}`));
      }, 30000);
    });
  }

  async targets() {
    return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  }

  async attach(targetId) {
    const { sessionId } = await this.send("Target.attachToTarget", {
      targetId, flatten: true,
    });
    await this.send("Runtime.enable", {}, sessionId);
    return sessionId;
  }

  async eval(sessionId, expression) {
    const r = await this.send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    }, sessionId);
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || "eval threw");
    }
    return r.result.value;
  }

  async openPage(url, width = 1280, height = 800) {
    const { targetId } = await this.send("Target.createTarget", { url });
    const s = await this.attach(targetId);
    await this.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: false,
    }, s);
    return s;
  }

  async shoot(sessionId, name) {
    if (!SHOTS) return;
    await this.send("Page.enable", {}, sessionId);
    const { data } = await this.send("Page.captureScreenshot", { format: "png" }, sessionId);
    await Deno.writeFile(
      `${SHOTS}/${name}.png`,
      Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)),
    );
  }

  close() { this.#ws.close(); }
}

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? `  — ${detail}` : ""}`);
}

const c = await CDP.connect();
const swLogs = [];

// ── Load the extension ──────────────────────────────────────────────────────
const { id: EXT } = await c.send("Extensions.loadUnpacked", { path: EXT_PATH });
check("extension loads unpacked", !!EXT, EXT);
await sleep(1500);

// ── Service worker ──────────────────────────────────────────────────────────
let swTarget = null;
for (let i = 0; i < 20 && !swTarget; i++) {
  swTarget = (await c.targets()).find(
    (t) => t.type === "service_worker" && t.url.includes(EXT),
  );
  if (!swTarget) await sleep(500);
}
check("service worker registered", !!swTarget);
if (!swTarget) Deno.exit(1);

const sw = await c.attach(swTarget.id);
await c.send("Log.enable", {}, sw);
c.on((msg) => {
  if (msg.sessionId !== sw) return;
  if (msg.method === "Runtime.consoleAPICalled" || msg.method === "Log.entryAdded") {
    const e = msg.params.entry;
    swLogs.push(`[${e?.level || msg.params.type}] ${e?.text ||
      (msg.params.args || []).map((a) => a.value ?? a.description).join(" ")}`);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    swLogs.push(`[exception] ${msg.params.exceptionDetails.exception?.description}`);
  }
});

// ── Detection against the live endpoint ─────────────────────────────────────
const live = await c.eval(sw, `checkWarp()`);
check("live check returns a valid status",
  ["connected", "disconnected", "unknown"].includes(live.status),
  `status=${live.status} warp=${live.detail}`);

if (live.status !== "disconnected") {
  console.log(
    `\n  NOTE  WARP is currently ${live.status} on this machine. The banner tests\n` +
    `        below drive the state directly, so they still run — but disconnect\n` +
    `        WARP and re-run to exercise the real detection path end to end.\n`,
  );
}

check("periodic alarm scheduled",
  (await c.eval(sw, `chrome.alarms.get("warp-check").then(a => a?.periodInMinutes)`)) === 1);

check("session storage opened to content scripts",
  (await c.eval(sw,
    `chrome.storage.session.setAccessLevel({accessLevel:"TRUSTED_AND_UNTRUSTED_CONTEXTS"})
       .then(() => true).catch(String)`)) === true);

async function setState(status) {
  await c.eval(sw,
    `chrome.storage.session.set({warpState:{status:"${status}",detail:"test",lastChecked:Date.now()}})`);
  await sleep(700);
}

async function badge() {
  return await c.eval(sw, `chrome.action.getBadgeText({})`);
}

// ── Banner behaviour ────────────────────────────────────────────────────────
await setState("disconnected");
const page = await c.openPage("https://example.com");
await sleep(3000);

const banner = () => c.eval(page, `!!document.querySelector("${HOST_SEL}")`);

check("banner injected on a tab opened while disconnected", await banner(),
  "exercises the getState message path");
check("shadow root is closed to the page",
  (await c.eval(page, `document.querySelector("${HOST_SEL}").shadowRoot === null`)) === true);
await c.shoot(page, "banner-disconnected");

// Compare layout with and without the banner: absolute offsets say nothing,
// since the page has margins of its own.
const MEASURE = `(() => {
  const h1 = document.querySelector("h1");
  return {
    h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
    scrollH: document.documentElement.scrollHeight,
  };
})()`;
const withBanner = await c.eval(page, MEASURE);
await setState("connected");
check("banner removed when WARP reconnects, without a reload", (await banner()) === false);
const withoutBanner = await c.eval(page, MEASURE);
check("banner overlays rather than reflowing the page",
  withBanner.h1Top === withoutBanner.h1Top && withBanner.scrollH === withoutBanner.scrollH,
  `h1 top ${withoutBanner.h1Top} → ${withBanner.h1Top}`);

await setState("unknown");
check("no banner while status is unknown", (await banner()) === false,
  "being offline must not read as disconnected");
check("badge shows ? when unknown", (await badge()) === "?");

await setState("disconnected");
check("banner returns when WARP drops again", (await banner()) === true);
check("badge shows ! when disconnected", (await badge()) === "!");

await setState("connected");
check("badge clears when connected", (await badge()) === "");
await setState("disconnected");

// Dismiss: the root is closed, so click the ✕ by coordinate.
const w = await c.eval(page, `innerWidth`);
for (const type of ["mousePressed", "mouseReleased"]) {
  await c.send("Input.dispatchMouseEvent",
    { type, x: w - 24, y: 20, button: "left", clickCount: 1 }, page);
}
await sleep(400);
check("dismiss button hides the banner", (await banner()) === false);

await c.send("Page.reload", {}, page);
await sleep(3000);
check("banner returns after a reload despite dismissal", (await banner()) === true);

// ── A site enforcing Trusted Types ──────────────────────────────────────────
const gh = await c.openPage("https://github.com");
await sleep(5000);
check("banner survives a Trusted-Types site (github.com)",
  (await c.eval(gh, `!!document.querySelector("${HOST_SEL}")`)) === true,
  "this is why the banner avoids innerHTML");
await c.shoot(gh, "banner-github");

// ── Popup ───────────────────────────────────────────────────────────────────
const popup = await c.openPage(`chrome-extension://${EXT}/popup.html`, 320, 190);
await sleep(1200);
check("popup shows the disconnected copy",
  /not connected/i.test(await c.eval(popup, `document.body.innerText`)));
await c.shoot(popup, "popup-disconnected");

const stamp = () => c.eval(popup, `document.getElementById("checked").textContent`);
const before = await stamp();
await c.eval(popup, `document.getElementById("recheck").click()`);
await sleep(2500);
check("popup Re-check now runs a fresh check", /Checked/.test(await stamp()),
  `"${before}" → "${await stamp()}"`);

// ── Console hygiene ─────────────────────────────────────────────────────────
const errors = swLogs.filter((l) => /error|exception|unhandled/i.test(l));
check("service worker console is clean", errors.length === 0, errors.join(" ;; "));

console.log(`\n${pass} passed, ${fail} failed`);
if (swLogs.length) console.log(`\nservice worker log:\n${swLogs.join("\n")}`);
c.close();
Deno.exit(fail ? 1 : 0);
