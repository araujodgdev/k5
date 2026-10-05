#!/usr/bin/env bash
# Cloud Agent install. Idempotent: a second run keeps Node 24.21.0 and the native pnpm binary.
# CI resolves package.json engines ">=22.13.0" to this Node via actions/setup-node
# (node-version-file: package.json). Measured on run 37295289934 as v24.21.0.
# /usr/local/cargo/bin is the first directory on the agent PATH. /exec-daemon/node
# (22.14, small ICU) sits ahead of /usr/local/bin, so a symlink there would lose.
set -euo pipefail

NODE_VERSION=24.21.0
PREFIX="/usr/local/lib/node-v${NODE_VERSION}"
LINK_DIR="/usr/local/cargo/bin"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

install_node() {
  if [[ -x "${PREFIX}/bin/node" ]] && [[ "$("${PREFIX}/bin/node" -v)" == "v${NODE_VERSION}" ]]; then
    return
  fi
  local tmp archive
  tmp="$(mktemp -d)"
  archive="node-v${NODE_VERSION}-linux-x64.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${archive}" -o "${tmp}/${archive}"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "${tmp}/SHASUMS256.txt"
  (cd "$tmp" && grep " ${archive}$" SHASUMS256.txt | sha256sum -c -)
  sudo mkdir -p /usr/local/lib
  sudo rm -rf "$PREFIX"
  sudo tar -xJf "${tmp}/${archive}" -C /usr/local/lib
  sudo mv "/usr/local/lib/node-v${NODE_VERSION}-linux-x64" "$PREFIX"
  rm -rf "$tmp"
}

link_toolchain() {
  sudo mkdir -p "$LINK_DIR"
  local bin
  for bin in node npm npx corepack; do
    sudo ln -sfn "${PREFIX}/bin/${bin}" "${LINK_DIR}/${bin}"
  done
  hash -r
  export PATH="${LINK_DIR}:${PATH}"
}

activate_pnpm() {
  local spec version
  spec="$("${PREFIX}/bin/node" -p "require('${ROOT}/package.json').packageManager")"
  case "$spec" in
    pnpm@*) version="${spec#pnpm@}" ;;
    *)
      echo "package.json packageManager must be pnpm@<version>, found ${spec}" >&2
      exit 1
      ;;
  esac
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  if [[ "$(readlink "${LINK_DIR}/pnpm" 2>/dev/null || true)" == "${LINK_DIR}/pnpm" ]]; then
    sudo rm -f "${LINK_DIR}/pnpm"
  fi
  # `corepack enable` writes shims next to the `node` on PATH. That node is
  # already ${LINK_DIR}/node, so the pnpm shim lands in LINK_DIR. Linking
  # `command -v pnpm` back onto that path replaces the shim with itself.
  corepack enable
  corepack prepare "pnpm@${version}" --activate
  if [[ ! -e "${LINK_DIR}/pnpm" ]]; then
    echo "corepack did not install ${LINK_DIR}/pnpm" >&2
    exit 1
  fi
  if [[ "$(readlink "${LINK_DIR}/pnpm" || true)" == "${LINK_DIR}/pnpm" ]]; then
    echo "${LINK_DIR}/pnpm is a symlink to itself" >&2
    exit 1
  fi
  hash -r
}

repair_pnpm_native() {
  # Corepack does not create ~/.local/share/pnpm/.tools. A standalone pnpm install
  # can leave a shebang-less placeholder there. install.js replaces it only when
  # npm_lifecycle_event is unset. postinstall only relinks Windows shims.
  # Turborepo execs that file directly (ENOEXEC, "Exec format error").
  local tools="${HOME}/.local/share/pnpm/.tools/pnpm"
  local installs install_js dir
  if [[ ! -d "$tools" ]]; then
    return 0
  fi
  installs="$(find "$tools" -path '*/node_modules/pnpm/install.js' 2>/dev/null | sort -u || true)"
  if [[ -z "$installs" ]]; then
    return 0
  fi
  while IFS= read -r install_js; do
    dir="$(dirname "$install_js")"
    env -u npm_lifecycle_event "${PREFIX}/bin/node" "$install_js"
    if ! file "${dir}/pnpm" | grep -q 'ELF'; then
      echo "pnpm at ${dir}/pnpm is not a native binary" >&2
      file "${dir}/pnpm" >&2 || true
      exit 1
    fi
  done <<< "$installs"
}

install_node
link_toolchain
activate_pnpm
cd "$ROOT"
pnpm install --frozen-lockfile
repair_pnpm_native
# Spawn one real task. A cache hit would hide an ENOEXEC from the placeholder.
pnpm exec turbo run typecheck --filter=@k5/tutorials --force --output-logs=errors-only

resolved="$(command -v node)"
version="$(node -v)"
resolved_pnpm="$(command -v pnpm)"
if [[ "$version" != "v${NODE_VERSION}" || "$resolved" != "${LINK_DIR}/node" ]]; then
  echo "node resolved to ${resolved} ${version}, expected ${LINK_DIR}/node v${NODE_VERSION}" >&2
  exit 1
fi
if [[ "$resolved_pnpm" != "${LINK_DIR}/pnpm" ]]; then
  echo "pnpm resolved to ${resolved_pnpm}, expected ${LINK_DIR}/pnpm" >&2
  exit 1
fi
echo "node ${version} at ${resolved}"
echo "pnpm $(pnpm -v) at ${resolved_pnpm}"
