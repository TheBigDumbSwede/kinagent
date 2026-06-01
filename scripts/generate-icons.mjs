import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const projectRoot = process.cwd();
const assetsDir = path.join(projectRoot, "assets");
const sizes = [16, 24, 32, 48, 64, 128, 256];
const scale = 4;

fs.mkdirSync(assetsDir, { recursive: true });

const pngs = sizes.map((size) => {
  const png = renderPng(size);
  fs.writeFileSync(path.join(assetsDir, `icon-${size}.png`), png);
  return { size, png };
});

fs.copyFileSync(path.join(assetsDir, "icon-256.png"), path.join(assetsDir, "icon.png"));
fs.writeFileSync(path.join(assetsDir, "icon.ico"), buildIco(pngs));

function renderPng(size) {
  const highSize = size * scale;
  const high = new Uint8ClampedArray(highSize * highSize * 4);
  drawIcon(high, highSize);

  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const sourceIndex = ((y * scale + sy) * highSize + x * scale + sx) * 4;
          sums[0] += high[sourceIndex] ?? 0;
          sums[1] += high[sourceIndex + 1] ?? 0;
          sums[2] += high[sourceIndex + 2] ?? 0;
          sums[3] += high[sourceIndex + 3] ?? 0;
        }
      }

      const targetIndex = (y * size + x) * 4;
      const samples = scale * scale;
      pixels[targetIndex] = Math.round(sums[0] / samples);
      pixels[targetIndex + 1] = Math.round(sums[1] / samples);
      pixels[targetIndex + 2] = Math.round(sums[2] / samples);
      pixels[targetIndex + 3] = Math.round(sums[3] / samples);
    }
  }

  return encodePng(size, size, pixels);
}

function drawIcon(pixels, size) {
  const factor = size / 256;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = (x + 0.5) / factor;
      const py = (y + 0.5) / factor;
      if (!insideRoundedRect(px, py, 0, 0, 256, 256, 54)) {
        continue;
      }

      const t = Math.max(0, Math.min(1, (px * 0.48 + py * 0.52 - 34) / 196));
      setPixel(pixels, size, x, y, mix([24, 52, 74], [49, 83, 107], t), 255);
    }
  }

  fillPolygon(pixels, size, scalePoints(kShape(), factor), [248, 251, 253], 255);
  fillPolygon(pixels, size, scalePoints(slashShape(), factor), [127, 215, 200], 255, [231, 195, 111]);
  fillPolygon(pixels, size, scalePoints(crossbarShape(), factor), [248, 251, 253], 242);
  fillPolygon(pixels, size, scalePoints(apexShape(), factor), [127, 215, 200], 255, [231, 195, 111]);
}

function kShape() {
  return [
    [65, 190],
    [65, 66],
    [94, 66],
    [94, 115],
    [137, 66],
    [174, 66],
    [122, 124],
    [177, 190],
    [139, 190],
    [102, 145],
    [94, 154],
    [94, 190]
  ];
}

function slashShape() {
  return [
    [148, 190],
    [191, 66],
    [218, 66],
    [176, 190]
  ];
}

function crossbarShape() {
  return [
    [171, 152],
    [225, 152],
    [234, 177],
    [162, 177]
  ];
}

function apexShape() {
  return [
    [196, 88],
    [216, 152],
    [176, 152]
  ];
}

function scalePoints(points, factor) {
  return points.map(([x, y]) => [x * factor, y * factor]);
}

function fillPolygon(pixels, size, points, color, alpha, gradientEnd) {
  const minX = Math.max(0, Math.floor(Math.min(...points.map(([x]) => x))));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(...points.map(([x]) => x))));
  const minY = Math.max(0, Math.floor(Math.min(...points.map(([, y]) => y))));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(...points.map(([, y]) => y))));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!insidePolygon(x + 0.5, y + 0.5, points)) {
        continue;
      }

      const t = Math.max(0, Math.min(1, (x + y - minX - minY) / Math.max(1, maxX + maxY - minX - minY)));
      setPixel(pixels, size, x, y, gradientEnd ? mix(color, gradientEnd, t) : color, alpha);
    }
  }
}

function insideRoundedRect(px, py, x, y, width, height, radius) {
  const nearestX = Math.max(x + radius, Math.min(px, x + width - radius));
  const nearestY = Math.max(y + radius, Math.min(py, y + height - radius));
  const dx = px - nearestX;
  const dy = py - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

function setPixel(pixels, size, x, y, color, alpha) {
  const index = (y * size + x) * 4;
  const existingAlpha = (pixels[index + 3] ?? 0) / 255;
  const sourceAlpha = alpha / 255;
  const outAlpha = sourceAlpha + existingAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) {
    return;
  }

  pixels[index] = Math.round(
    (color[0] * sourceAlpha + (pixels[index] ?? 0) * existingAlpha * (1 - sourceAlpha)) / outAlpha
  );
  pixels[index + 1] = Math.round(
    (color[1] * sourceAlpha + (pixels[index + 1] ?? 0) * existingAlpha * (1 - sourceAlpha)) / outAlpha
  );
  pixels[index + 2] = Math.round(
    (color[2] * sourceAlpha + (pixels[index + 2] ?? 0) * existingAlpha * (1 - sourceAlpha)) / outAlpha
  );
  pixels[index + 3] = Math.round(outAlpha * 255);
}

function mix(start, end, t) {
  return start.map((value, index) => Math.round(value + ((end[index] ?? value) - value) * t));
}

function encodePng(width, height, pixels) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width * 4; x += 1) {
      raw[y * stride + 1 + x] = pixels[y * width * 4 + x] ?? 0;
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", uint32(width), uint32(height), Buffer.from([8, 6, 0, 0, 0])),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND")
  ]);
}

function pngChunk(type, ...parts) {
  const data = Buffer.concat(parts);
  const typeBuffer = Buffer.from(type, "ascii");
  return Buffer.concat([uint32(data.length), typeBuffer, data, uint32(crc32(Buffer.concat([typeBuffer, data])))]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function uint16le(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function uint32le(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildIco(entries) {
  const header = Buffer.concat([uint16le(0), uint16le(1), uint16le(entries.length)]);
  const directorySize = header.length + entries.length * 16;
  let offset = directorySize;
  const directory = [];

  for (const entry of entries) {
    directory.push(
      Buffer.concat([
        Buffer.from([entry.size === 256 ? 0 : entry.size, entry.size === 256 ? 0 : entry.size, 0, 0]),
        uint16le(1),
        uint16le(32),
        uint32le(entry.png.length),
        uint32le(offset)
      ])
    );
    offset += entry.png.length;
  }

  return Buffer.concat([header, ...directory, ...entries.map((entry) => entry.png)]);
}
