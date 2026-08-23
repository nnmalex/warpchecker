# Privacy Policy — WARP Checker

_Last updated: 19 August 2026_

## Summary

WARP Checker does not collect, store, transmit, or sell any personal data.

## What the extension does

To determine whether your connection is going through Cloudflare WARP, the
extension sends a `GET` request to Cloudflare's public diagnostic endpoint:

```
https://www.cloudflare.com/cdn-cgi/trace
```

This request is made roughly once a minute while your browser is running, and
when you press "Re-check now" in the extension popup. It is sent with browser
credentials omitted, so no cookies or authentication data are attached. It is
not made at all if an administrator has limited the extension to other
operating systems (see below).

The response is a short plain-text summary of how Cloudflare sees the
connection. The extension reads a single field from it — `warp` — and discards
the rest. Cloudflare's handling of that request is governed by
[Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

## What is stored

The current status (`connected`, `disconnected`, or `unknown`) and the time of
the last check are held in Chrome's session storage on your own device. This is
cleared when you close the browser. Nothing is written to a remote server.

If your organisation installed the extension for you, your administrator can
attach settings to it — which operating systems it runs on, and the wording of
the banner. Chrome delivers these to the extension from your device's own
policy store. They are read on your device and never sent anywhere, and the
extension reports nothing back to your administrator.

If your administrator has limited the extension to other operating systems, it
does nothing on your device: it makes **no** network requests, shows no banner
and no badge, and the popup simply says it is not enabled on your operating
system.

## What is not done

- No personal or identifying information is collected.
- No browsing history, page content, form data, or URLs are read, recorded, or
  transmitted. The content script only inserts a warning banner into the page;
  it does not inspect the page.
- No analytics, telemetry, tracking, or advertising.
- No data is sold or shared with third parties.
- No remote code is loaded or executed.

## Permissions and why they are needed

- **Access to all websites** — required to display the warning banner on the
  page you are currently viewing. The extension only adds its own banner
  element; it does not read or modify page content.
- **`https://www.cloudflare.com/cdn-cgi/trace`** — the connection-status check
  described above.
- **`alarms`** — to schedule the periodic check.
- **`storage`** — to share the current status between the background worker,
  the banner, and the popup on your device, and to read any settings your
  administrator attached to a managed installation.

## Contact

Questions about this policy can be sent to the support email address listed on
the extension's Chrome Web Store page.
