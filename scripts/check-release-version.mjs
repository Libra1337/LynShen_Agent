import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json')).version;
const tauri = JSON.parse(readFileSync('src-tauri/tauri.conf.json')).version;
const cargo = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync('src-tauri/Cargo.toml', 'utf8'))?.[1];
const tag = process.argv[2];
if (pkg !== tauri || pkg !== cargo || (tag && tag !== `v${pkg}` && tag !== pkg)) {
  throw new Error(`Version mismatch: package=${pkg}, tauri=${tauri}, cargo=${cargo}, tag=${tag}`);
}
console.log(`Release versions agree: ${pkg}`);
