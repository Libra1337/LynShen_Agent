#!/bin/sh
# Installs a runtime tool for the current user without sudo or Homebrew
# (macOS): downloads the official build, checks its SHA-256 against the
# vendor's published checksum, and unpacks it under ~/.lynshen/tools, linking
# the binaries into ~/.local/bin. Used by installer::Plan for `node`, `ffmpeg`
# and `gh` when Homebrew is absent.
set -eu
tool="$1"
case "$(uname -m)" in
	arm64|aarch64) arch=arm64 ;;
	x86_64) arch=x64 ;;
	*) echo "unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac
root="$HOME/.lynshen/tools"
bin="$HOME/.local/bin"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$root" "$bin"

fetch() { echo "downloading $1"; curl -fSL --retry 3 --connect-timeout 20 -o "$2" "$1"; }
verify() {
	actual="$(shasum -a 256 "$1" | cut -d' ' -f1)"
	[ "$actual" = "$2" ] || { echo "checksum mismatch for $1" >&2; exit 1; }
	echo "checksum ok ($actual)"
}
link() {
	for name in "$@"; do
		ln -sf "$target/$name" "$bin/$(basename "$name")"
		echo "linked $bin/$(basename "$name")"
	done
}

case "$tool" in
node)
	base="https://nodejs.org/dist/latest-v24.x"
	fetch "$base/SHASUMS256.txt" "$work/sums"
	file="$(grep -o "node-v[0-9.]*-darwin-$arch\.tar\.gz" "$work/sums" | head -1)"
	[ -n "$file" ] || { echo "no Node build for darwin-$arch" >&2; exit 1; }
	fetch "$base/$file" "$work/$file"
	verify "$work/$file" "$(grep " $file\$" "$work/sums" | cut -d' ' -f1)"
	target="$root/${file%.tar.gz}"
	rm -rf "$target" && tar -xzf "$work/$file" -C "$root"
	target="$target/bin"
	link node npm npx
	;;
ffmpeg)
	[ "$arch" = arm64 ] && platform=arm64 || platform=amd64
	page="https://ffmpeg.martin-riedl.de/redirect/latest/macos/$platform/release/ffmpeg.zip"
	# The service redirects GET requests only; read the target without following it.
	url="$(curl -fsS -o /dev/null -w '%{redirect_url}' "$page")"
	[ -n "$url" ] || { echo "no ffmpeg build found" >&2; exit 1; }
	fetch "$url" "$work/ffmpeg.zip"
	fetch "$url.sha256" "$work/ffmpeg.sha256"
	verify "$work/ffmpeg.zip" "$(cut -d' ' -f1 "$work/ffmpeg.sha256")"
	target="$root/ffmpeg"
	rm -rf "$target" && mkdir -p "$target" && unzip -q -o "$work/ffmpeg.zip" -d "$target"
	chmod +x "$target/ffmpeg"
	link ffmpeg
	;;
gh)
	[ "$arch" = arm64 ] && platform=arm64 || platform=amd64
	api="https://api.github.com/repos/cli/cli/releases/latest"
	fetch "$api" "$work/release.json"
	asset="$(grep -o "https://[^\"]*gh_[0-9.]*_macOS_$platform\.zip" "$work/release.json" | head -1)"
	sums="$(grep -o 'https://[^"]*gh_[0-9.]*_checksums\.txt' "$work/release.json" | head -1)"
	[ -n "$asset" ] && [ -n "$sums" ] || { echo "no gh build for macOS $platform" >&2; exit 1; }
	file="$(basename "$asset")"
	fetch "$asset" "$work/$file"
	fetch "$sums" "$work/sums"
	verify "$work/$file" "$(grep " $file\$" "$work/sums" | cut -d' ' -f1)"
	rm -rf "$root/${file%.zip}" && unzip -q -o "$work/$file" -d "$root"
	target="$root/${file%.zip}/bin"
	link gh
	;;
*)
	echo "unknown tool: $tool" >&2
	exit 2
	;;
esac
echo "installed $tool"
