#!/bin/bash
set -euo pipefail

python3 /usr/local/bin/cdp-proxy.py &

exec /init
