# Chrome Web Store listing — WARP Checker

Copy-paste source for the developer dashboard. Keep in sync with `manifest.json`.

---

## Item name

```
WARP Checker
```

## Short description (max 132 characters)

```
Shows a banner on every page when your traffic is not going through Cloudflare WARP, so you notice the moment it drops.
```

(117 characters.)

## Category

Tools (alternative: Workflow & Planning)

## Language

English (UK) — or English (US) if you Americanise the copy.

## Detailed description

```
WARP Checker tells you, at a glance, whether your browsing is actually going
through Cloudflare WARP.

If WARP disconnects — the app quit, the laptop woke from sleep, the tunnel
dropped on a new network — nothing in the browser normally tells you. Pages
keep loading and you carry on, unprotected. WARP Checker closes that gap.

HOW IT WORKS

Once a minute, the extension asks Cloudflare's own diagnostic endpoint how it
sees your connection. If WARP is not carrying your traffic, a red banner
appears at the top of every open tab, and the toolbar icon shows a red badge.
When you reconnect, the banner disappears everywhere — no reloading required.

FEATURES

• Persistent banner on every page while WARP is disconnected
• Red badge on the toolbar icon, visible even on pages the banner cannot reach
• Checks again whenever you load a page, so a drop surfaces while you browse
• Popup showing current status, last check time, and a "Re-check now" button
• Recognises both WARP and WARP+
• Stays quiet when you are simply offline — no false alarms when there is no
  network to check against
• Dismiss the banner for a tab when you need an unobstructed view; it returns
  on reload or the next time WARP drops
• For managed deployments: administrators can limit it to chosen operating
  systems — where it is excluded it goes completely silent, making no checks
  at all — and can replace the banner wording with their own

PRIVACY

WARP Checker collects nothing. It makes one kind of request — to Cloudflare's
public trace endpoint — and reads a single field from the reply. No browsing
history, no page content, no analytics, no accounts, no remote code. The
banner is inserted into pages; page content is never read.

NOT AFFILIATED WITH CLOUDFLARE

This is an independent extension. It is not made, endorsed, or supported by
Cloudflare, Inc. "Cloudflare" and "WARP" are trademarks of Cloudflare, Inc.
You need the Cloudflare WARP app installed separately for this to be useful.
```

---

## Privacy practices tab

**Single purpose description**

```
Warns the user when their browser traffic is not going through Cloudflare WARP,
by showing a banner on the page they are viewing.
```

**Permission justifications**

- `host permission (https://www.cloudflare.com/cdn-cgi/trace)`

```
The extension reads Cloudflare's public trace endpoint to determine whether
the user's connection is going through WARP. This is the only network request
the extension makes, and the permission is scoped to that single URL.
```

- `alarms`

```
Used to schedule the periodic (once per minute) connection check in the
background service worker.
```

- `storage`

```
Used to share the current WARP status between the background worker, the
banner shown on pages, and the popup. Only the status string and a timestamp
are stored, in session storage on the user's device. It also reads the
managed-storage settings an administrator may attach to a force-installed
copy (which operating systems the extension runs on, and the banner wording);
these are provided by Chrome from the device's policy store and are never
transmitted.
```

- Host permissions / access to all sites (content script on `<all_urls>`)

```
The warning must be visible wherever the user is browsing, so the content
script runs on all sites in order to insert the warning banner into the page.
The extension does not read, collect, or transmit any page content, URLs, or
user data — it only appends its own banner element inside a shadow root and
removes it again when WARP reconnects.
```

**Data usage declarations**

Tick nothing under "What user data do you plan to collect?" — the extension
collects none of the listed categories. Then certify all three:

- Not being sold to third parties
- Not being used or transferred for purposes unrelated to the item's single purpose
- Not being used or transferred to determine creditworthiness or for lending

**Privacy policy URL**

Host `PRIVACY.md` publicly and paste the URL here, e.g.
`https://<user>.github.io/warpchecker/privacy.html` or the GitHub blob URL.
This field is mandatory because the extension makes network requests.

---

## Graphical assets checklist

| Asset               | Size          | Required | Notes                                    |
| ------------------- | ------------- | -------- | ---------------------------------------- |
| Store icon          | 128×128 PNG   | Yes      | `icons/icon128.png`                      |
| Screenshot          | 1280×800 PNG  | Yes (≥1) | Up to 5; see below                       |
| Small promo tile    | 440×280 PNG   | Optional | Needed for any chance of featuring       |
| Marquee promo tile  | 1400×560 PNG  | Optional | Featured placement only                  |

Suggested screenshots, saved into `store/screenshots/`:

1. A real website with the red banner across the top — the core value, first.
2. The popup showing "WARP is not connected" with the red dot.
3. The popup showing "WARP is connected" with the green dot.

To capture: load the extension unpacked, disconnect WARP, and take a
1280×800 screenshot (`Cmd-Shift-4`, then space to grab a window, and crop, or
use Chrome DevTools device toolbar set to 1280×800 for an exact size).
