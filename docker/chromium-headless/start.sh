#!/bin/sh
# Start the CDP proxy (0.0.0.0:9223 -> 127.0.0.1:9222), then run headless
# Chromium in the foreground. In headless=new mode Chrome's
# --remote-debugging-address=0.0.0.0 is unreliable (upstream Chromium issue),
# which is why the proxy handles external access.
set -eu

python3 /usr/local/bin/cdp-proxy.py &

# shellcheck disable=SC2086
exec chromium-browser \
  --headless=new \
  --no-sandbox \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --remote-allow-origins=* \
  --user-data-dir=/config/headless-profile \
  --window-size=1280,720 \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=TranslateUI \
  ${CHROME_EXTRA_FLAGS:-} \
  about:blank
