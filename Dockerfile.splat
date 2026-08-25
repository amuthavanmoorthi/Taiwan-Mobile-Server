# Backend image WITH the splat converter.
#
# Named Dockerfile.splat, not Dockerfile, on purpose: Zeabur auto-detects a
# root Dockerfile and would switch the service off nixpacks the moment this
# lands. That build works today, and swapping it days before a demo is not a
# risk worth taking silently. To adopt this, point the Zeabur service at
# `Dockerfile.splat` explicitly, or rename it.
#
# Without it the API still runs, but both the .ply upload slot and multi-photo
# carving are unavailable - /api/health reports splat:false and carving:false,
# and generation falls back to extruding a single photo.
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
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/server.js"]
