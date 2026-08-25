# Backend image.
#
# This replaces the nixpacks build. Zeabur uses a root Dockerfile when it finds
# one, which is what switching this file's name did. The API needs Python
# beside Node now and nixpacks was not giving it; without this image
# /api/health reports splat:false and carving:false, and 3D generation falls
# back to extruding a single photo.
#
# Node alone would be enough for the API. Python and Open3D are here for two
# reasons: converting a Gaussian splat .ply into the GLB and USDZ that AR
# needs, and carving a mesh out of several photographs taken around an item.
# AR Quick Look on iOS cannot render splats, and the 3D team's pipeline stops
# at the .ply, so the conversion happens on this box or nowhere.
#
# Open3D is a large wheel. If splat conversion is not wanted on a given
# deployment, drop the two apt/pip layers below - the API detects the missing
# converter and hides the upload slot rather than failing at runtime.
FROM node:20-bookworm-slim

# libgl and libgomp are Open3D's runtime dependencies; without them the import
# fails at first use rather than at build time, which is far harder to debug.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      libgl1 libgomp1 libx11-6 \
 && rm -rf /var/lib/apt/lists/*

# A venv keeps pip away from Debian's system Python (PEP 668).
ENV SPLAT_VENV=/opt/splat
RUN python3 -m venv "$SPLAT_VENV" \
 && "$SPLAT_VENV/bin/pip" install --no-cache-dir --upgrade pip \
 && "$SPLAT_VENV/bin/pip" install --no-cache-dir "open3d==0.18.0" "numpy<2" "pillow"

# Both photos-to-3d.mjs and splat-to-3d.mjs shell out to this interpreter.
ENV SPLAT_PYTHON="/opt/splat/bin/python"

WORKDIR /src

# Dependencies first so a source-only change does not reinstall them.
# The schema comes along because postinstall runs `prisma generate`, which
# reads it - without this npm ci fails before any source is copied.
# .npmrc carries the fetch retry settings. Without it in the image the build
# gets npm's default two retries, and a single dropped connection to the
# registry fails the whole deploy - which is exactly what kept happening.
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma

# Retried around as well: the registry drops connections often enough on this
# builder that even npm's own retries are not always enough, and a failed
# deploy costs far more than three attempts.
RUN for attempt in 1 2 3; do \
      npm ci --no-audit --no-fund && break; \
      echo "npm ci attempt $attempt failed; retrying"; \
      sleep 10; \
    done; \
    test -d node_modules

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/server.js"]
