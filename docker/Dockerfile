# Everything needed to BUILD and TEST this plugin, in one place, so several
# runs can go at once without fighting over the same files.
#
# Two agents (or a suite and a screenshot) both running `trmnlp build` in
# plugin/ write the same _build/ and patch the same .trmnlp.yml. That has
# left a test fixture in a tracked file and served boards with an alert
# banner nobody asked for, three times in one day. The layout suite already
# copies the plugin to a temp dir per build; this covers everything that
# does not, and costs nothing to reason about: one container, one
# filesystem, no lock.
#
# FROM the official trmnlp image so the Ruby side is exactly what the
# project already runs, and on the same Debian release as this machine,
# because the layout suite MEASURES TEXT and freetype is what measures it.
FROM trmnl/trmnlp:latest

# What headless Chromium needs to start. The browser itself is not baked in:
# the Playwright build on the host is mounted read only at /pw, so the
# container and the host render with the SAME binary and a measurement taken
# in one means the same thing in the other.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
      libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libpango-1.0-0 libcairo2 libasound2t64 libatspi2.0-0t64 \
      libx11-6 libxcb1 libxext6 libxi6 libglib2.0-0t64 \
      fonts-liberation curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The SAME Node the host runs. The image ships one already, but a suite that
# passes on one runtime and not the other is a suite that cannot be trusted
# from either, and the whole point of the box is that a result means the
# same thing inside it as outside.
RUN curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/node.sh \
  && bash /tmp/node.sh \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/* /tmp/node.sh

# trmnlp's own entrypoint serves a preview; here the image is a toolbox.
ENTRYPOINT ["/bin/bash", "-lc"]
