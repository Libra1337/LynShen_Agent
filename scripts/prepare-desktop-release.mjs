import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The installer the download page offers per platform, by file name.
const INSTALLERS = {
  'windows-x86_64': (name, version) => name.endsWith(`_${version}_x64-setup.exe`),
  'darwin-aarch64': (name, version) => name.endsWith(`_${version}_aarch64.dmg`),
  'darwin-x86_64': (name, version) => name.endsWith(`_${version}_x64.dmg`),
  'linux-x86_64-appimage': (name, version) => name.endsWith(`_${version}_amd64.AppImage`),
  'linux-x86_64-deb': (name, version) => name.endsWith(`_${version}_amd64.deb`),
  'linux-x86_64-rpm': (name, version) => name.endsWith(`-${version}-1.x86_64.rpm`),
};
// Linux installers join the catalog when the release carries them.
const LINUX = ['linux-x86_64-appimage', 'linux-x86_64-deb', 'linux-x86_64-rpm'];

export function prepareRelease(assets, output, origin, required = ['windows-x86_64', 'darwin-aarch64', 'darwin-x86_64'], optional = LINUX) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Public origin must be an HTTPS origin without a path or credentials');
  }
  const manifest = JSON.parse(readFileSync(path.join(assets, 'latest.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Expected a stable semantic version');
  const files = readdirSync(assets);
  const selected = new Set();
  const root = `${base.origin}/v1/public/releases/desktop/${manifest.version}`;
  const local = name => {
    if (!/^[A-Za-z0-9_.+-]+$/.test(name) || name === '.' || name === '..' || !existsSync(path.join(assets, name))) {
      throw new Error(`Missing or unsafe artifact: ${name}`);
    }
    selected.add(name);
    return `${root}/${encodeURIComponent(name)}`;
  };
  for (const key of required) {
    if (!manifest.platforms?.[key]) throw new Error(`Missing signed update platform: ${key}`);
  }
  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    const url = new URL(entry.url);
    if (url.protocol !== 'https:' || typeof entry.signature !== 'string' || !entry.signature.trim()) {
      throw new Error(`Invalid signed update: ${platform}`);
    }
    const name = decodeURIComponent(url.pathname.split('/').at(-1));
    const mirroredUrl = local(name);
    const signature = readFileSync(path.join(assets, `${name}.sig`), 'utf8').trim();
    if (signature !== entry.signature.trim()) throw new Error(`Signature mismatch: ${name}`);
    entry.url = mirroredUrl;
    local(`${name}.sig`);
  }
  const catalog = { version: manifest.version, platforms: {} };
  const offered = [...required, ...optional.filter(platform => manifest.platforms[platform])];
  for (const platform of offered) {
    const matches = files.filter(name => INSTALLERS[platform](name, manifest.version));
    if (matches.length !== 1) throw new Error(`Expected one installer for ${platform}, got ${matches.length}`);
    const name = matches[0];
    catalog.platforms[platform] = {
      url: new URL(local(name)).pathname,
      sha256: createHash('sha256').update(readFileSync(path.join(assets, name))).digest('hex'),
    };
  }
  const directory = path.join(output, manifest.version);
  mkdirSync(directory, { recursive: true });
  for (const name of selected) copyFileSync(path.join(assets, name), path.join(directory, name));
  for (const [name, value] of Object.entries({ 'latest.json': manifest, 'catalog.json': catalog })) {
    writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
  }
  return catalog;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [assets, output, origin, platform] = process.argv.slice(2);
  if (!assets || !output || !origin) throw new Error('Usage: node scripts/prepare-desktop-release.mjs <assets> <output> <https-origin>');
  if (platform && platform !== '--windows-only') throw new Error('Unknown platform option');
  console.log(JSON.stringify(platform ? prepareRelease(assets, output, origin, ['windows-x86_64'], []) : prepareRelease(assets, output, origin)));
}
