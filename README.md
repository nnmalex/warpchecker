# WARP Checker

A Chrome extension that checks whether your traffic is going through
[Cloudflare WARP](https://one.one.one.one/) and, when it is not, shows a
persistent banner at the top of every page telling you to connect.

## How it works

A background service worker fetches `https://www.cloudflare.com/cdn-cgi/trace`
once a minute. That endpoint reports how Cloudflare sees the connection,
including a `warp=` field:

| `warp=` value | Meaning              | Extension status |
| ------------- | -------------------- | ---------------- |
| `on`          | WARP connected       | Connected        |
| `plus`        | WARP+ connected      | Connected        |
| `off`         | Not going through WARP | Disconnected   |

If the request fails (offline, captive portal, DNS failure) the status is
**unknown**, never "disconnected" — the extension does not nag you when it
simply could not check.

Loading a page also triggers a check when the last reading is more than 30
seconds old, so browsing surfaces a drop rather than waiting on the next
alarm. The page is answered from the stored reading immediately and the
refresh arrives separately, so nothing blocks on the network.

The result is written to `chrome.storage.session`. Content scripts and the
popup read it and subscribe to changes, so every open tab and every newly
opened tab reflects the current state without any message passing.

### Detection latency

When the tunnel drops, Chrome puts its network stack into a change-backoff and
fails every request instantly for a while — measured on macOS at about 7
seconds with no tab open, and about 27 seconds with one open. `checkWarp()`
therefore retries for 20 seconds before concluding anything, and that window is
bounded by elapsed time rather than a number of attempts, because instant
failures would otherwise burn every attempt in a second or two.

The practical result is that a real disconnect surfaces in roughly 30–90
seconds unprompted, depending on where in the alarm period it lands, and
faster than that if you load a page or open the popup. This is a deliberate
trade: the alternative is treating a failed check as "disconnected", which
would show a false warning every time a laptop wakes or changes network.

- **Disconnected** → red `!` badge on the toolbar icon and a banner on every page.
- **Unknown** → grey `?` badge, no banner.
- **Connected** → no badge, no banner.

The banner lives in a closed shadow root, so page CSS cannot restyle or hide
it, and it overlays rather than reflows the page. It is built with DOM APIs
rather than `innerHTML` so that sites enforcing Trusted Types cannot block it.
Dismissing it hides it for that tab until the page reloads or WARP drops again.

## Troubleshooting an unknown status

When a check is inconclusive the worker records *why*, and the popup words its
advice to match. **Troubleshooting details** in the popup shows the raw facts,
and **Copy details** puts them on the clipboard for a help-desk ticket.

| Popup headline                              | Reason         | What happened / what to try |
| ------------------------------------------- | -------------- | --------------------------- |
| You're offline                              | `offline`      | Chrome reports no network. Reconnect; it updates by itself. |
| Cloudflare didn't answer in time            | `timeout`      | No response within 6s on every attempt. Slow or lossy link, or something stalling the request. |
| The status check was refused                | `http`         | A non-2xx answer, typically a proxy or firewall's 403. Check that `www.cloudflare.com/cdn-cgi/trace` is allowed. |
| Cloudflare could not be reached             | `unreachable`  | The request never completed: DNS failure, refused connection, untrusted TLS certificate (SSL inspection), or a Wi-Fi sign-in page. |
| Your network answered instead of Cloudflare | `intercepted`  | A web page came back instead of the trace: a sign-in page or a block page served with a trusted certificate. |
| Unexpected answer from Cloudflare           | `unrecognised` | The trace arrived but had no `warp=` line. |

For the next steps, in order:

1. **Open Cloudflare's check** (link in the popup) to load the trace endpoint
   in a tab. Whatever page that shows is what the extension saw. If it loads and
   includes `warp=on`, the network is fine and **Re-check now** should agree.
2. If it does not load, the problem is the network rather than the extension:
   try another site, sign in to any Wi-Fi portal, or check the WARP app.
3. For a closer look, open `chrome://extensions`, enable Developer mode, and
   click **service worker** on the WARP Checker card. Each inconclusive check
   logs one line there (`[WARP Checker] status unknown after N attempt(s): …`),
   and `chrome.storage.session.get("warpState")` in that console shows the
   stored reading.

`fetch()` reports nearly every network failure as the same bare
`Failed to fetch`, so `unreachable` cannot be split further from inside the
extension. DNS, TLS and connection failures look identical to it.

## Administrator settings

The extension can be force-installed from the Google Admin console with
settings attached. Chrome delivers them through managed storage, shaped by
[`managed-schema.json`](managed-schema.json).

| Setting            | Type             | Effect                                       |
| ------------------ | ---------------- | -------------------------------------------- |
| `enabledPlatforms` | array of strings | Run only on these operating systems          |
| `bannerMessage`    | string           | Replace the wording shown in the banner      |

Accepted platform names are `Windows`, `macOS`, `ChromeOS`, `Linux` and
`Android`. Matching ignores case and separators, so `chrome_os` and `ChromeOS`
are the same thing.

Neither setting is required. With no policy at all — the ordinary Web Store
install — the extension runs everywhere with its default wording.

### Setting them in the Admin console

**Admin console → Devices → Chrome → Apps & extensions → Users & browsers**,
select WARP Checker, set **Installation policy** to *Force install*, and paste
into **Policy for extensions**:

```json
{
  "enabledPlatforms": { "Value": ["Windows", "ChromeOS"] },
  "bannerMessage": {
    "Value": "WARP is off — reconnect, or call the IT help desk on 1234."
  }
}
```

Each setting is wrapped in `{"Value": …}`; that is the Admin console's own
format, not something this extension asks for. Either key can be left out.
Policy applies at the organisational unit the setting is made on, so a
platform-specific OU can be given its own list.

To confirm what actually arrived on a device, open `chrome://policy` there and
press **Reload policies**; the extension's settings appear under its ID, with
an error against anything Chrome rejected.

### `enabledPlatforms` silences the extension, not just the banner

On an operating system left off the list, WARP Checker does nothing at all: no
connection checks, no network requests, no toolbar badge, no banner. The popup
is the only part that still speaks, and only to say **"Not enabled on your
OS"** — so a user who wonders why their colleague has a banner and they do not
gets an answer instead of a silent, apparently broken extension.

Adding a platform to the list later starts it checking again without a browser
restart, and removing one stops it just as promptly.

### An unreadable list means "no restriction"

`enabledPlatforms` is ignored — and the extension runs everywhere — when it is
empty, is not a list, or names **any** operating system that is not one of the
accepted values. One mistyped entry therefore drops the whole restriction
rather than applying the rest of it.

This is deliberate, and it is the trade worth understanding: `["Windows",
"Widnows"]` leaves macOS users with a banner they were not meant to see, where
the alternative would leave Windows users silently unprotected. A half-filled
or mistyped policy form is a far likelier explanation than a deliberate request
for silence, and an admin who wants the extension off everywhere can simply not
install it. Chrome validates against the schema before the extension sees
anything, so a rejected value usually shows up in `chrome://policy` first.

### `bannerMessage`

Inserted as plain text, never as markup, and truncated at 300 characters — the
banner is a fixed strip across the top of every page, and a longer message
would swallow the page rather than warn about it. Leading, trailing and
repeated whitespace is collapsed; a blank string falls back to the default.

It also replaces the explanatory line in the popup, so the admin's wording is
what the user reads in both places.

## Layout

```
manifest.json       Manifest V3 definition
managed-schema.json Settings an administrator can push from Google Admin
background.js       Service worker: polling, parsing, state, policy, badge
content.js          Banner injection (all pages, top frame only)
popup.html/.js      Status card with a "Re-check now" button
icons/              16/32/48/128 px PNGs
store/              Chrome Web Store listing copy (not shipped)
```

There is no build step. The repository root is the extension.

## Development

Load it unpacked:

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this directory.
3. Toggle the Cloudflare WARP app on and off to watch the state change.

After editing `background.js`, hit the reload icon on the extension card.
After editing `content.js`, also reload any tab you are testing on.

To regenerate the icons: `python3 tools/make_icons.py` (writes into `icons/`).

## Tests

```sh
./tools/test.sh
```

Starts a throwaway headless Chrome, loads the extension over the DevTools
Protocol, and exercises it end to end — banner injection, live status
transitions, the dismiss button, badge state, the popup, and a Trusted-Types
site. Your own Chrome profile is never touched. Requires Chrome 137+ and
`deno`; screenshots land in `dist/screenshots/`.

The extension is loaded over CDP rather than with `--load-extension` because
Chrome ignores that flag as of version 137. It stays loaded only while the
connection that loaded it is open, so the suite loads and tests in one session.

Status transitions are driven by writing to `chrome.storage.session` directly,
which covers every state regardless of whether WARP is installed on the
machine running the tests. The live detection path is still exercised once,
against the real endpoint.

Administrator settings are covered the same way. Chrome fills `storage.managed`
from the platform's own policy store — the Windows registry, a macOS
configuration profile — which a throwaway profile cannot populate, so the suite
asserts on the rules themselves (`enabledOn`, `sanitiseMessage`) in the worker
directly, and drives the rest from a resolved policy: that an excluded platform
loses its banner, its badge, its stored reading and its periodic check, that
including it again restarts the check, that a reworded policy reaches a banner
already on screen, and that the popup says "Not enabled on your OS" and hides
its button.

What is not machine-checked is Chrome's own delivery of the values. That is
worth one manual pass before shipping a change to `managed-schema.json`: load
the extension unpacked, apply a policy for its ID by hand, and confirm at
`chrome://policy` that the values arrive unrejected. On Linux that is a file in
`/etc/opt/chrome/policies/managed/`:

```json
{
  "3rdparty": {
    "extensions": {
      "<extension-id>": { "enabledPlatforms": ["Windows"] }
    }
  }
}
```

On Windows the equivalent lives under
`HKLM\Software\Policies\Google\Chrome\3rdparty\extensions\<extension-id>`,
and on macOS it takes a configuration profile — note that the `{"Value": …}`
wrapper is an Admin console convention and does **not** appear in any of these.

For the real thing:

```sh
./tools/test-live.sh
```

This toggles the actual tunnel with `warp-cli` and checks that the extension
follows: connected reads clean, a real disconnect raises the banner unprompted,
a stale reading is refreshed by loading a page, and reconnecting clears
everything. It needs the Cloudflare WARP app, and it **will disconnect your
tunnel for a minute or two** before reconnecting it. It reconnects on the way
out even if an assertion fails.

## Packaging for the Chrome Web Store

```sh
./tools/package.sh
```

This produces `dist/warp-checker-<version>.zip` containing only the files the
extension actually ships. Upload that to the developer dashboard.

## Privacy

The extension makes exactly one kind of network request: a `GET` to
Cloudflare's own trace endpoint, with credentials omitted. It collects no
data, stores nothing remotely, and has no analytics. See [PRIVACY.md](PRIVACY.md).
