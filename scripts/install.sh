#!/usr/bin/env bash
# Release tooling replaces this token with public addresses and a source hash.
# Keep all work inside main so an incomplete download cannot execute half a script.
set -euo pipefail
vwb_main() {
  local vwb_release='__VWB_RELEASE_BASE64__'
  local vwb_home="${XDG_DATA_HOME:-$HOME/.local/share}/video-workbench"
  local vwb_client=auto vwb_tmp vwb_node vwb_os vwb_arch vwb_archive vwb_expected vwb_actual
  local vwb_official_key="${RIKOKO_OFFICIAL_KEY:-}"
  unset RIKOKO_OFFICIAL_KEY
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --client) [ "$#" -ge 2 ] || return 2; vwb_client="$2"; shift 2 ;;
      --dir) [ "$#" -ge 2 ] || return 2; vwb_home="$2"; shift 2 ;;
      *) echo "Usage: install.sh [--client codex|claude-code|claude-desktop|auto] [--dir /absolute/path]" >&2; return 2 ;;
    esac
  done
  case "$vwb_release" in __*) echo "This is an unpublished installer template. Build a release with real official addresses first." >&2; return 1 ;; esac
  case "$vwb_home" in /*) ;; *) echo "Installation directory must be absolute." >&2; return 1 ;; esac
  if [ "$vwb_home" = / ] || [ "$vwb_home" = "$HOME" ] || [ -L "$vwb_home" ]; then
    echo "Choose a dedicated installation directory." >&2; return 1
  fi
  case "$vwb_client" in auto|codex|claude-code|claude-desktop) ;; *) echo "Unsupported client." >&2; return 2 ;; esac
  vwb_os=$(uname -s); vwb_arch=$(uname -m)
  case "$vwb_os:$vwb_arch" in Darwin:arm64|Darwin:x86_64|Linux:aarch64|Linux:x86_64) ;; *) echo "Supported: macOS and Linux/WSL on arm64 or x64." >&2; return 1 ;; esac
  if [ -d "$vwb_home" ] && [ ! -f "$vwb_home/.vwb-install-root" ] && [ -n "$(ls -A "$vwb_home")" ]; then
    echo "Refusing to change an unrelated existing directory: $vwb_home" >&2; return 1
  fi
  umask 077
  mkdir -p "$vwb_home/runtime"
  touch "$vwb_home/.vwb-install-root"
  mkdir "$vwb_home/.install-lock" 2>/dev/null || { echo "Another installation is running. Inspect $vwb_home/.install-lock if a previous installer was interrupted." >&2; return 1; }
  vwb_tmp=$(mktemp -d "$vwb_home/.install-XXXXXX")
  vwb_cleanup_tmp="$vwb_tmp"
  vwb_cleanup_home="$vwb_home"
  trap 'rm -rf -- "$vwb_cleanup_tmp"; rmdir -- "$vwb_cleanup_home/.install-lock" 2>/dev/null || true' EXIT
  vwb_download() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 600 --max-filesize 268435456 "$1" -o "$2"; }
  if command -v node >/dev/null && command -v npm >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)' 2>/dev/null; then
    vwb_node=$(command -v node)
  elif [ -x "$vwb_home/runtime/node/bin/node" ]; then
    vwb_node="$vwb_home/runtime/node/bin/node"
  else
    echo "Installing an isolated Node.js runtime…"
    local vwb_platform vwb_cpu
    [ "$vwb_os" = Darwin ] && vwb_platform=darwin || vwb_platform=linux
    case "$vwb_arch" in arm64|aarch64) vwb_cpu=arm64 ;; *) vwb_cpu=x64 ;; esac
    vwb_download https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt "$vwb_tmp/node-shasums"
    vwb_archive=$(awk -v suffix="-$vwb_platform-$vwb_cpu.tar.gz" 'index($2,suffix) && substr($2,length($2)-length(suffix)+1)==suffix {print $2; exit}' "$vwb_tmp/node-shasums")
    case "$vwb_archive" in node-v22.*.tar.gz) ;; *) echo "Node runtime unavailable." >&2; return 1 ;; esac
    vwb_expected=$(awk -v name="$vwb_archive" '$2==name {print $1}' "$vwb_tmp/node-shasums")
    vwb_download "https://nodejs.org/dist/latest-v22.x/$vwb_archive" "$vwb_tmp/node.tar.gz"
    if command -v shasum >/dev/null; then vwb_actual=$(shasum -a 256 "$vwb_tmp/node.tar.gz" | awk '{print $1}'); else vwb_actual=$(sha256sum "$vwb_tmp/node.tar.gz" | awk '{print $1}'); fi
    [ "$vwb_actual" = "$vwb_expected" ] || { echo "Node checksum mismatch." >&2; return 1; }
    mkdir "$vwb_tmp/node"
    tar -xzf "$vwb_tmp/node.tar.gz" -C "$vwb_tmp/node" --strip-components=1
    mv "$vwb_tmp/node" "$vwb_home/runtime/node"
    vwb_node="$vwb_home/runtime/node/bin/node"
  fi
  export PATH="$(dirname "$vwb_node"):$vwb_home/runtime/bin:$PATH"
  "$vwb_node" --input-type=module - "$vwb_release" "$vwb_tmp" <<'JS'
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const r = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
if (!/^[a-f0-9]{64}$/.test(r.sha256)) throw Error('Invalid release hash');
for (const name of ['archiveUrl', 'apiUrl', 'templateUrl']) {
  if (name !== 'archiveUrl' && r[name] === undefined) continue;
  const u = new URL(r[name]);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw Error('Invalid release URL');
}
writeFileSync(join(process.argv[3], 'release.json'), JSON.stringify(r));
writeFileSync(join(process.argv[3], 'archive-url'), r.archiveUrl);
JS
  vwb_archive=$(cat "$vwb_tmp/archive-url")
  echo "Downloading rikoko…"
  vwb_download "$vwb_archive" "$vwb_tmp/source.tar.gz"
  "$vwb_node" --input-type=module - "$vwb_tmp" "$vwb_home" <<'JS'
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const [tmp, home] = process.argv.slice(2), r = JSON.parse(readFileSync(join(tmp, 'release.json')));
const archive = join(tmp, 'source.tar.gz');
if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== r.sha256) throw Error('Source checksum mismatch');
if (existsSync(join(home, 'app'))) {
  if (!existsSync(join(home, '.release.json')) || JSON.parse(readFileSync(join(home, '.release.json'))).sha256 !== r.sha256)
    throw Error('A different release is installed. Preserve its data; install this release in another --dir.');
} else {
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 4*1024*1024 }).trim().split('\n');
  if (!names.length || names.length > 10000 || names.some(p => !p.startsWith('video-workbench/') || p.includes('\\') || p.split('/').some(x => x === '..' || x === '.')))
    throw Error('Invalid archive paths');
  const listing = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8', maxBuffer: 4*1024*1024 }).trim().split('\n');
  if (listing.some(line => !/^[d-]/.test(line))) throw Error('Archive links or special files are forbidden');
  const staging = join(tmp, 'extracted'); mkdirSync(staging);
  execFileSync('tar', ['-xzf', archive, '-C', staging]);
  renameSync(join(staging, 'video-workbench'), join(home, 'app'));
}
writeFileSync(join(home, '.release.json'), JSON.stringify(r), { mode: 0o600 });
JS
  if ! command -v uv >/dev/null; then
    echo "Installing an isolated uv runtime…"
    vwb_download https://astral.sh/uv/0.13.0/install.sh "$vwb_tmp/uv-install.sh"
    UV_UNMANAGED_INSTALL="$vwb_home/runtime/bin" sh "$vwb_tmp/uv-install.sh"
  fi
  if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
    echo "Installing FFmpeg; the system package manager may request permission."
    if [ "$vwb_os" = Darwin ]; then
      if ! command -v brew >/dev/null; then
        vwb_download https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh "$vwb_tmp/homebrew-install.sh"
        /bin/bash "$vwb_tmp/homebrew-install.sh"
        export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
      fi
      HOMEBREW_NO_AUTO_UPDATE=1 brew install ffmpeg
    elif command -v apt-get >/dev/null; then
      if [ "$(id -u)" -eq 0 ]; then apt-get update && apt-get install -y ffmpeg fonts-noto-cjk;
      else sudo apt-get update && sudo apt-get install -y ffmpeg fonts-noto-cjk; fi
    elif command -v dnf >/dev/null; then
      sudo dnf install -y ffmpeg-free google-noto-sans-cjk-fonts
    else
      echo "No supported package manager. Install FFmpeg/ffprobe, then rerun this command." >&2; return 1
    fi
  fi
  command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null
  cd "$vwb_home/app"
  echo "Preparing rikoko and TikTok download tools…"
  npm exec --yes --package=pnpm@10.28.2 -- pnpm install --frozen-lockfile
  uv sync --project python --frozen --managed-python --python 3.12
  npm exec --yes --package=pnpm@10.28.2 -- pnpm build
  if [ -z "$vwb_official_key" ] && "$vwb_node" --input-type=module - "$vwb_home" <<'JS'
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = name => { const p = join(process.argv[2], 'config', name); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}; };
const model = read('models.json'), keys = read('credentials.json'), release = read('../.release.json');
process.exit(!release.apiUrl || model.mode === 'custom' || keys.RIKOKO_OFFICIAL_KEY ? 1 : 0);
JS
  then
    if ( : < /dev/tty ) 2>/dev/null; then
      printf '输入你的官方用户 API Key（回车跳过，仍可使用本地剪辑）：' > /dev/tty
      IFS= read -r -s vwb_official_key < /dev/tty || true
      printf '\n' > /dev/tty
    fi
  fi
  export RIKOKO_OFFICIAL_KEY="$vwb_official_key"
  "$vwb_node" --experimental-strip-types scripts/setup.ts --home "$vwb_home" --release "$vwb_home/.release.json" --client "$vwb_client"
  unset RIKOKO_OFFICIAL_KEY
}
vwb_main "$@"
