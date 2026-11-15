#!/usr/bin/env node
// Builds the Minha TV .ipk (app + root service) with no dependencies: the
// webOS package is an `ar` archive of debian-binary, control.tar.gz and
// data.tar.gz, the same layout `ares-package` produces.
//
//   node lgtv/build.mjs            -> lgtv/dist/<id>_<version>_all.ipk

import { readFileSync, readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));

// ---- Archive formats -------------------------------------------------------

function octal(value, width) {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

// One ustar header (+ padded data). Directory names end with '/'.
function tarEntry(name, data, mode, mtime) {
  const isDir = name.endsWith('/');
  if (Buffer.byteLength(name) > 100) throw new Error(`tar path too long: ${name}`);
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, 'utf8');
  header.write(octal(mode, 8), 100, 'ascii');
  header.write(octal(0, 8), 108, 'ascii'); // uid root
  header.write(octal(0, 8), 116, 'ascii'); // gid root
  header.write(octal(isDir ? 0 : data.length, 12), 124, 'ascii');
  header.write(octal(mtime, 12), 136, 'ascii');
  header.write('        ', 148, 'ascii'); // checksum placeholder
  header.write(isDir ? '5' : '0', 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  header.write('root', 265, 'ascii');
  header.write('root', 297, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  if (isDir) return [header];
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return [header, data, padding];
}

// files: Map of path (no leading "./") -> { data, mode }. Parent directories
// are emitted before their contents, as opkg expects.
export function tarGz(files, mtime) {
  const parts = [];
  const seenDirs = new Set();
  const paths = [...files.keys()].sort();
  for (const path of paths) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const dir = segments.slice(0, i).join('/') + '/';
      if (!seenDirs.has(dir)) {
        seenDirs.add(dir);
        parts.push(...tarEntry('./' + dir, null, 0o755, mtime));
      }
    }
    const { data, mode } = files.get(path);
    parts.push(...tarEntry('./' + path, data, mode, mtime));
  }
  parts.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

export function ar(members, mtime) {
  const parts = [Buffer.from('!<arch>\n', 'ascii')];
  for (const { name, data } of members) {
    const header =
      name.padEnd(16) +
      String(mtime).padEnd(12) +
      '0'.padEnd(6) +
      '0'.padEnd(6) +
      '100644'.padEnd(8) +
      String(data.length).padEnd(10) +
      '`\n';
    parts.push(Buffer.from(header, 'ascii'), data);
    if (data.length % 2) parts.push(Buffer.from('\n'));
  }
  return Buffer.concat(parts);
}

// ---- Icons (generated, so no binary lives in git) --------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function hexColor(hex) {
  const value = parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// Coverage of a rounded rectangle at pixel (x, y), 4x4 supersampled.
function roundedRectCoverage(x, y, left, top, right, bottom, radius) {
  let inside = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4;
      const py = y + (sy + 0.5) / 4;
      if (px < left || px > right || py < top || py > bottom) continue;
      const cx = Math.min(Math.max(px, left + radius), right - radius);
      const cy = Math.min(Math.max(py, top + radius), bottom - radius);
      if ((px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2) inside++;
    }
  }
  return inside / 16;
}

// A TV glyph (screen outline + stand) on a rounded square in the accent color.
export function iconPng(size, accent = '#4f8cff') {
  const [r, g, b] = hexColor(accent);
  const s = size / 80;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const bg = roundedRectCoverage(x, y, 2 * s, 2 * s, 78 * s, 78 * s, 18 * s);
      const outer = roundedRectCoverage(x, y, 16 * s, 20 * s, 64 * s, 52 * s, 5 * s);
      const inner = roundedRectCoverage(x, y, 20.5 * s, 24.5 * s, 59.5 * s, 47.5 * s, 2 * s);
      const stand = roundedRectCoverage(x, y, 28 * s, 57 * s, 52 * s, 61 * s, 2 * s);
      const white = Math.min(1, Math.max(0, outer - inner) + stand);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(r + (255 - r) * white);
      raw[o + 1] = Math.round(g + (255 - g) * white);
      raw[o + 2] = Math.round(b + (255 - b) * white);
      raw[o + 3] = Math.round(255 * bg);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Package ---------------------------------------------------------------

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

export function buildIpk({ outDir = join(here, 'dist'), mtime = Math.floor(Date.now() / 1000) } = {}) {
  const appDir = join(here, 'app');
  const serviceDir = join(here, 'service');
  const appinfo = JSON.parse(readFileSync(join(appDir, 'appinfo.json'), 'utf8'));
  const services = JSON.parse(readFileSync(join(serviceDir, 'services.json'), 'utf8'));
  const appId = appinfo.id;
  const serviceId = services.id;
  const version = appinfo.version;

  // webOS only lets an app own services whose id starts with the app id.
  if (!serviceId.startsWith(appId + '.')) {
    throw new Error(`service id ${serviceId} must start with ${appId}.`);
  }

  const data = new Map();
  const appRoot = `usr/palm/applications/${appId}`;
  for (const file of listFiles(appDir)) {
    data.set(`${appRoot}/${relative(appDir, file).split('\\').join('/')}`, {
      data: readFileSync(file),
      mode: 0o644,
    });
  }
  data.set(`${appRoot}/${appinfo.icon}`, { data: iconPng(80), mode: 0o644 });
  data.set(`${appRoot}/${appinfo.largeIcon}`, { data: iconPng(130), mode: 0o644 });

  const serviceRoot = `usr/palm/services/${serviceId}`;
  for (const file of listFiles(serviceDir)) {
    data.set(`${serviceRoot}/${relative(serviceDir, file).split('\\').join('/')}`, {
      data: readFileSync(file),
      mode: 0o644,
    });
  }

  const packageinfo = {
    app: appId,
    id: appId,
    loc_name: appinfo.title,
    package_format_version: 2,
    services: [serviceId],
    vendor: appinfo.vendor,
    version,
  };
  data.set(`usr/palm/packages/${appId}/packageinfo.json`, {
    data: Buffer.from(JSON.stringify(packageinfo, null, 2) + '\n'),
    mode: 0o644,
  });

  const installedSize = [...data.values()].reduce((sum, f) => sum + f.data.length, 0);
  const control = [
    `Package: ${appId}`,
    `Version: ${version}`,
    'Section: misc',
    'Priority: optional',
    'Architecture: all',
    `Installed-Size: ${installedSize}`,
    `Maintainer: ${appinfo.vendor}`,
    `Description: ${appinfo.title}`,
    'webOS-Package-Format-Version: 2',
    'webOS-Packager-Version: x.y.x',
    '',
  ].join('\n');

  const ipk = ar(
    [
      { name: 'debian-binary', data: Buffer.from('2.0\n') },
      {
        name: 'control.tar.gz',
        data: tarGz(new Map([['control', { data: Buffer.from(control), mode: 0o644 }]]), mtime),
      },
      { name: 'data.tar.gz', data: tarGz(data, mtime) },
    ],
    mtime,
  );

  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${appId}_${version}_all.ipk`);
  writeFileSync(path, ipk);
  return { path, appId, serviceId, version, files: [...data.keys()] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { path, files } = buildIpk();
  console.log(`${relative(process.cwd(), path)} (${files.length} arquivos, ${statSync(path).size} bytes)`);
}
