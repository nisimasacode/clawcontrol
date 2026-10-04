# Lean headless Chromium sidecar for OpenClaw agents.
# Replaces the linuxserver/chromium + Selkies webUI stack (~1.3 GB) with
# headless Chromium + the CDP proxy (~300 MB). Interactive logins happen via
# the CDP screencast client (cdp-screencast.html), so no X11/webUI is needed.
FROM zenika/alpine-chrome:latest

USER root
RUN apk add --no-cache python3 tzdata
USER chrome

COPY --chmod=755 cdp-proxy.py /usr/local/bin/cdp-proxy.py
COPY --chmod=755 start.sh /usr/local/bin/start.sh

# Base image ENTRYPOINT is ["chromium-browser", "--headless"]; replace it.
ENTRYPOINT ["/usr/local/bin/start.sh"]
