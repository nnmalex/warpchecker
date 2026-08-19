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

The result is written to `chrome.storage.session`. Content scripts and the
popup read it and subscribe to changes, so every open tab and every newly
opened tab reflects the current state without any message passing.

- **Disconnected** → red `!` badge on the toolbar icon and a banner on every page.
- **Unknown** → grey `?` badge, no banner.
- **Connected** → no badge, no banner.

The banner lives in a closed shadow root, so page CSS cannot restyle or hide
it, and it overlays rather than reflows the page. It is built with DOM APIs
rather than `innerHTML` so that sites enforcing Trusted Types cannot block it.
Dismissing it hides it for that tab until the page reloads or WARP drops again.

## Layout

```
manifest.json     Manifest V3 definition
background.js     Service worker: polling, parsing, state, badge
content.js        Banner injection (all pages, top frame only)
popup.html/.js    Status card with a "Re-check now" button
icons/            16/32/48/128 px PNGs
store/            Chrome Web Store listing copy (not shipped)
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
