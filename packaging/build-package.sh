#!/bin/sh
# Builds the native Linux packages of one architecture from the built project (run `npm run build` first):
#   party-game-<version>-linux-<arch>.tar.gz   unpack anywhere, run bin/party-game-server
#   party-game_<version>_<arch>.deb            installs under /opt/party-game with a systemd service
#   party-game-<version>-1.<rpm arch>.rpm  (x86_64, aarch64, armv7hl, armv6hl)      same, for rpm distributions
# FLAVOR=bare builds the same packages without games and plugins (core only), named party-game-bare...: install the
# .pgpack files of the release with party-game-games / party-game-plugins.
# PRODUCT=bot builds the same three formats of the standalone bot server instead (party-game-bot[-bare]...; files in
# packaging/bot/, DIST_DIR must hold bot-main.js, bot-worker.js and games.js; FLAVOR=bare is the bundle built with
# BOT_GAMES=none, which has no built-in game AI: install the game packs with party-game-bot-games).
# Each one carries its own Node.js, so no system Node is needed. See docs/development/packaging.md.
#
# Usage: packaging/build-package.sh <amd64|arm64|armv7|armv6> [tar] [deb] [rpm]   (default: all three)
# Environment:
#   BUNDLED_NODE_VERSION       Node.js to bundle (default below)
#   NODE_MODULES_FROM  directory with production node_modules built for the target (see below)
#   FLAVOR             full (default: the dist has every game and plugin) or bare (core only dist, see above)
#   DIST_DIR           the built project to package (default: dist)
#   PRODUCT            server (default) or bot, see above
#   OUT                output directory (default: build/packages)
#   NFPM               the nfpm command that makes deb/rpm (default: nfpm)
#   PACKAGE_HOMEPAGE / PACKAGE_MAINTAINER / PACKAGE_LICENSE   package metadata (default: the author and license of
#                      package.json; CI sets the homepage to the repository)
# node_modules holds a native module (better-sqlite3), so it must be installed for the target architecture.
# Without NODE_MODULES_FROM it is installed here when the target is this machine's architecture; otherwise it is
# installed without the native module and the server uses the json profile store.
set -eu
cd "$(dirname "$0")/.."

BUNDLED_NODE_VERSION=${BUNDLED_NODE_VERSION:-22.23.3}
OUT=${OUT:-build/packages}
NFPM=${NFPM:-nfpm}
FLAVOR=${FLAVOR:-full}
DIST_DIR=${DIST_DIR:-dist}
PRODUCT=${PRODUCT:-server}
case "$PRODUCT" in
  server)
    pkg=party-game; pdir=packaging; main=server; docdir=party-game
    TOOLS="server:server admin:admin config-check:config-check loadtest:loadtest migrate-profiles:migrate-profiles games:games plugins:plugins"
    title="Bonk Arena Party: a multiplayer party game server for browsers."
    example=config.example.yaml; conf=config.yaml; confdst=/etc/party-game/config.yaml ;;
  bot)
    pkg=party-game-bot; pdir=packaging/bot; main=bot-main; docdir=party-game-bot
    # party-game-bot runs the bot server, party-game-bot-games installs game packs for its AI
    TOOLS="bot:bot-main bot-games:games"
    title="Bonk Arena Party bot server: plays AI players in the lobbies of a party game server."
    example=bot/server/config.example.yaml; conf=config.yaml; confdst=/etc/party-game/bot-server.yaml ;;
  *) echo "unknown PRODUCT: $PRODUCT (server or bot)" >&2; exit 2 ;;
esac
case "$FLAVOR" in
  full) suffix=""; other=$pkg-bare ;;
  bare) suffix="-bare"; other=$pkg ;;
  *) echo "unknown FLAVOR: $FLAVOR (full or bare)" >&2; exit 2 ;;
esac

arch=${1:?usage: packaging/build-package.sh <amd64|arm64|armv7|armv6> [tar] [deb] [rpm]}
shift
formats=${*:-tar deb rpm}

case "$arch" in
  amd64) node_arch=x64;    host=x86_64;  deb_arch=amd64; rpm_arch=amd64; rpm_name=x86_64 ;;
  arm64) node_arch=arm64;  host=aarch64; deb_arch=arm64; rpm_arch=arm64; rpm_name=aarch64 ;;
  armv7) node_arch=armv7l; host=armv7l;  deb_arch=arm7;  rpm_arch=arm7;  rpm_name=armv7hl ;;
  # Raspberry Pi OS (armhf) runs on armv6 boards: the deb of the Pi Zero W uses the armhf architecture too
  armv6) node_arch=armv6l; host=armv6l;  deb_arch=arm7;  rpm_arch=arm6;  rpm_name=armv6hl ;;
  *) echo "unknown architecture: $arch" >&2; exit 2 ;;
esac

[ -f "$DIST_DIR/$main.js" ] || { echo "$DIST_DIR/$main.js is not built: run npm run build$([ "$PRODUCT" = bot ] && echo ' and npm run build:bot')" >&2; exit 1; }
version=$(node -p "require('./package.json').version")
maintainer=${PACKAGE_MAINTAINER:-$(node -p "require('./package.json').author")}
license=${PACKAGE_LICENSE:-$(node -p "require('./package.json').license")}
name="$pkg-$version-linux-$arch$suffix"
work="build/work/$PRODUCT-$arch-$FLAVOR"
stage="$work/$name"
mkdir -p "$OUT" build/cache
rm -rf "$work"
mkdir -p "$stage/bin"

echo "[package] $FLAVOR flavor, Node.js v$BUNDLED_NODE_VERSION for $arch"
if [ "$arch" = armv6 ]; then base="https://unofficial-builds.nodejs.org/download/release/v$BUNDLED_NODE_VERSION"; else base="https://nodejs.org/dist/v$BUNDLED_NODE_VERSION"; fi
node_tar="node-v$BUNDLED_NODE_VERSION-linux-$node_arch.tar.xz"
if [ ! -s "build/cache/$node_tar" ]; then
  curl -fsSL "$base/$node_tar" -o "build/cache/$node_tar.part"
  curl -fsSL "$base/SHASUMS256.txt" -o "build/cache/SHASUMS256-$node_arch.txt"
  want=$(grep " $node_tar\$" "build/cache/SHASUMS256-$node_arch.txt" | cut -d' ' -f1)
  have=$(sha256sum "build/cache/$node_tar.part" | cut -d' ' -f1)
  [ -n "$want" ] && [ "$want" = "$have" ] || { echo "checksum mismatch for $node_tar" >&2; exit 1; }
  mv "build/cache/$node_tar.part" "build/cache/$node_tar"
fi
tar -xJf "build/cache/$node_tar" -C "$stage/bin" --strip-components=2 "node-v$BUNDLED_NODE_VERSION-linux-$node_arch/bin/node"

echo "[package] dist and production dependencies"
if [ "$PRODUCT" = bot ]; then
  mkdir "$stage/dist"
  cp "$DIST_DIR/bot-main.js" "$DIST_DIR/bot-worker.js" "$DIST_DIR/games.js" "$stage/dist/"
else
  cp -r "$DIST_DIR" "$stage/dist"
  # the bot server entry points are not part of the game server packages
  rm -f "$stage/dist/bot-main.js" "$stage/dist/bot-worker.js"
fi
cp package.json package-lock.json "$stage/"
if [ "$PRODUCT" = bot ]; then
  # ws and yaml are pure JavaScript: no native module, so the same install works for every architecture
  (cd "$stage" && npm ci --omit=dev --omit=optional --no-audit --no-fund)
elif [ -n "${NODE_MODULES_FROM:-}" ]; then
  cp -r "$NODE_MODULES_FROM" "$stage/node_modules"
else
  if [ "$(uname -m)" = "$host" ]; then flags=""; else flags="--ignore-scripts"; echo "[package] warning: not building for $arch here: no native better-sqlite3 (json profile store only)" >&2; fi
  # shellcheck disable=SC2086
  (cd "$stage" && npm ci --omit=dev --no-audit --no-fund $flags)
fi
# the sources of the sqlite engine are only needed to compile it
rm -rf "$stage/node_modules/better-sqlite3/deps" "$stage/node_modules/better-sqlite3/src"

echo "[package] launchers"
for t in $TOOLS; do
  tool=${t%%:*}; file=${t##*:}
  sed -e "s/@TOOL@/$tool/g" -e "s/@FILE@/$file.js/g" "$pdir/launcher.sh.in" > "$stage/bin/party-game-$tool"
  chmod 755 "$stage/bin/party-game-$tool"
  [ -f "$stage/dist/$file.js" ] || { echo "missing dist/$file.js" >&2; exit 1; }
done

# readable by every user (the service runs as its own user), writable only by the owner
chmod -R u+rwX,go+rX,go-w "$stage"

sums() { (cd "$OUT" && sha256sum "$1" > "$1.sha256"); }

case " $formats " in *" tar "*)
  echo "[package] tar.gz"
  mkdir -p "$work/tar"
  cp -r "$stage" "$work/tar/"
  cp "$example" README.md LICENSE "$work/tar/$name/"
  cp -r docs "$work/tar/$name/docs"
  tar czf "$OUT/$name.tar.gz" -C "$work/tar" "$name"
  sums "$name.tar.gz"
esac

case " $formats " in *" deb "*|*" rpm "*)
  echo "[package] nfpm"
  cp "$pdir/launcher.conf" "$stage/launcher.conf"
  links=""
  for t in $TOOLS; do
    tool=${t%%:*}
    links="$links
  - src: /opt/$pkg/bin/party-game-$tool
    dst: /usr/bin/party-game-$tool
    type: symlink"
  done
  if [ "$PRODUCT" = bot ]; then
    if [ "$FLAVOR" = bare ]; then
      summary="No built-in game AI: install the game packs with party-game-bot-games."
    else
      summary="Includes the AI of every built-in game."
    fi
    provides=party-game-bot-server
    service=party-game-bot.service
  elif [ "$FLAVOR" = bare ]; then
    summary="Core only: no games or plugins. Install them with party-game-games and party-game-plugins."
    provides=party-game-server
    service=party-game.service
  else
    summary="Includes every game and plugin."
    provides=party-game-server
    service=party-game.service
  fi
  envfile=$pkg
  mk_yaml() { # $1 = nfpm architecture
    cat > "$work/nfpm-$1.yaml" <<YAML
name: $pkg$suffix
arch: $1
platform: linux
version: $version
section: games
priority: optional
maintainer: $maintainer
description: |
  $title
  Self-contained: it carries its own Node.js.
  $summary
homepage: ${PACKAGE_HOMEPAGE:-}
license: $license
conflicts:
  - $other
replaces:
  - $other
provides:
  - $provides
contents:
  - src: $PWD/$stage
    dst: /opt/$pkg
    type: tree
  - src: $PWD/$pdir/$service
    dst: /usr/lib/systemd/system/$service
  - src: $PWD/$pdir/$conf
    dst: $confdst
    type: config|noreplace
  - src: $PWD/$pdir/default.env
    dst: /etc/default/$envfile
    type: config|noreplace
  - src: $PWD/$example
    dst: /usr/share/doc/$docdir/config.example.yaml
  - src: $PWD/LICENSE
    dst: /usr/share/doc/$docdir/LICENSE$links
scripts:
  postinstall: $PWD/$pdir/postinstall.sh
  preremove: $PWD/$pdir/preremove.sh
  postremove: $PWD/$pdir/postremove.sh
YAML
  }
  case " $formats " in *" deb "*)
    mk_yaml "$deb_arch"
    deb_file="${pkg}${suffix}_${version}_$arch.deb"
    $NFPM package -f "$work/nfpm-$deb_arch.yaml" -p deb -t "$OUT/$deb_file"
    sums "$deb_file" ;;
  esac
  case " $formats " in *" rpm "*)
    mk_yaml "$rpm_arch"
    rpm_file="${pkg}${suffix}-$version-1.$rpm_name.rpm"
    $NFPM package -f "$work/nfpm-$rpm_arch.yaml" -p rpm -t "$OUT/$rpm_file"
    sums "$rpm_file" ;;
  esac
esac
echo "[package] done: $OUT"
