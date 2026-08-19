// Live end-to-end test: toggles the real WARP tunnel with warp-cli and checks
// that the extension follows. Run via tools/test-live.sh.
//
// This is separate from e2e-test.js because it needs the WARP app installed and
// it genuinely disconnects your tunnel for about a minute. The default suite
// drives state directly instead, so it runs anywhere.

const EXT_PATH = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const PORT = Deno.env.get("CDP_PORT") || "9222";
const HOST_SEL = "#warp-checker-banner-host";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function warp(cmd) {
  const { code, stdout } = await new Deno.Command("warp-cli", {
    args: [cmd],
  }).output();
  if (code !== 0) throw new Error(`warp-cli ${cmd} failed`);
  return new TextDecoder().decode(stdout).trim();
}

async function warpConnected() {
  const { stdout } = await new Deno.Command("warp-cli", { args: ["status"] }).output();
  return /Connected/.test(new TextDecoder().decode(stdout));
}

// Wait for the tunnel to actually reach the requested state.
async function settle(wantConnected, tries = 20) {
  for (let i = 0; i < tries; i++) {
    if ((await warpConnected()) === wantConnected) return true;
    await sleep(1000);
  }
  return false;
}

class CDP {
  #ws; #id = 0; #pending = new Map();
  static async connect() {
    const { webSocketDebuggerUrl } = await (
      await fetch(`http://127.0.0.1:${PORT}/json/version`)
    ).json();
    const c = new CDP();
    c.#ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      c.#ws.onopen = res;
      c.#ws.onerror = () => rej(new Error("cannot reach Chrome"));
    });
    c.#ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      const p = m.id !== undefined && c.#pending.get(m.id);
      if (!p) return;
      c.#pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    };
    return c;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.#id;
    return new Promise((res, rej) => {
      this.#pending.set(id, { res, rej });
      this.#ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => { if (this.#pending.delete(id)) rej(new Error(`timeout: ${method}`)); }, 40000);
    });
  }
  async targets() { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); }
  async attach(targetId) {
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    await this.send("Runtime.enable", {}, sessionId);
    return sessionId;
  }
  async eval(s, expression) {
    const r = await this.send("Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true }, s);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
    return r.result.value;
  }
  close() { this.#ws.close(); }
}

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? `  — ${detail}` : ""}`);
}

const startedConnected = await warpConnected();
console.log(`WARP starts ${startedConnected ? "connected" : "disconnected"}\n`);

const c = await CDP.connect();
const { id: EXT } = await c.send("Extensions.loadUnpacked", { path: EXT_PATH });
await sleep(1500);

let swT = null;
for (let i = 0; i < 20 && !swT; i++) {
  swT = (await c.targets()).find((t) => t.type === "service_worker" && t.url.includes(EXT));
  if (!swT) await sleep(500);
}
if (!swT) { console.log("service worker never started"); Deno.exit(1); }
const sw = await c.attach(swT.id);

const recheck = () => c.eval(sw, `checkWarp()`);
const badge = () => c.eval(sw, `chrome.action.getBadgeText({})`);

try {
  // ── Connected ───────────────────────────────────────────────────────────
  if (!startedConnected) await warp("connect");
  await settle(true);
  await sleep(2000);

  const onState = await recheck();
  check("live warp=on reads as connected", onState.status === "connected",
    `warp=${onState.detail}`);
  check("badge is clear while connected", (await badge()) === "");

  const page = await c.attach((await c.send("Target.createTarget", {
    url: "https://example.com",
  })).targetId);
  await c.send("Emulation.setDeviceMetricsOverride",
    { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, page);
  await sleep(3000);
  const banner = () => c.eval(page, `!!document.querySelector("${HOST_SEL}")`);
  check("no banner on a page loaded while WARP is up", (await banner()) === false);

  // ── Disconnect for real ─────────────────────────────────────────────────
  // When the tunnel drops, Chrome puts its network stack into a change-backoff
  // and fails every request instantly for roughly half a minute — measured at
  // ~27s with a tab open, ~7s without. No amount of retrying beats that, so the
  // guarantee worth asserting is that the warning lands within one alarm
  // period, not that it lands immediately.
  await warp("disconnect");
  await settle(false);
  const droppedAt = Date.now();

  // Worst case is a whole alarm period plus the backoff, so allow for both.
  let noticed = 0;
  while (Date.now() - droppedAt < 100000) {
    await sleep(3000);
    if (await banner()) { noticed = Math.round((Date.now() - droppedAt) / 1000); break; }
  }
  check("a real disconnect raises the banner unprompted", noticed > 0,
    noticed ? `banner appeared ${noticed}s after the tunnel dropped` : "nothing within 100s");
  check("badge shows ! after a real disconnect", (await badge()) === "!");
  check("state reads disconnected from the live endpoint",
    (await recheck()).status === "disconnected");

  // Opening a page with a stale reading should trigger a refresh, so that
  // browsing surfaces a drop rather than waiting on the next alarm.
  await c.eval(sw, `chrome.storage.session.set({warpState:
    {status:"connected",detail:"stale",lastChecked: Date.now() - 120000}})`);
  await sleep(500);
  const fresh = await c.attach((await c.send("Target.createTarget", {
    url: "https://example.com/?stale",
  })).targetId);
  await sleep(12000);
  const refreshed = await c.eval(sw,
    `chrome.storage.session.get("warpState").then(s => s.warpState.status)`);
  check("loading a page refreshes a stale reading", refreshed === "disconnected",
    `stale "connected" → "${refreshed}"`);
  check("the banner follows that refresh",
    (await c.eval(fresh, `!!document.querySelector("${HOST_SEL}")`)) === true);

  // ── Reconnect for real ──────────────────────────────────────────────────
  await warp("connect");
  await settle(true);
  await sleep(2500);
  const backState = await recheck();
  check("live reconnect reads as connected", backState.status === "connected");
  await sleep(800);
  check("banner clears itself on reconnect", (await banner()) === false);
  check("badge clears on reconnect", (await badge()) === "");

} finally {
  // Leave the tunnel up: that is the state this extension exists to encourage.
  await warp("connect").catch(() => {});
  await settle(true);
  console.log(`\nWARP left ${(await warpConnected()) ? "connected" : "DISCONNECTED"}`);
  c.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
Deno.exit(fail ? 1 : 0);
