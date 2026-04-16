/**
 * Generate a simple 16x32 pixel art sprite for the todo board plugin.
 * Run: node generate-sprite.js
 * Requires: pngjs (npm install pngjs)
 */

const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const WIDTH = 16;
const HEIGHT = 32;
const png = new PNG({ width: WIDTH, height: HEIGHT });

// Color palette
const COLORS = {
  bg:     [49, 50, 68, 255],     // #313244 dark board
  border: [69, 71, 90, 255],     // #45475a border
  green:  [166, 227, 161, 255],  // #a6e3a1 accent
  white:  [205, 214, 244, 255],  // #cdd6f4 text lines
  dark:   [30, 30, 46, 255],     // #1e1e2e background
  pin:    [243, 139, 168, 255],  // #f38ba8 pin
};

function setPixel(x, y, color) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const idx = (y * WIDTH + x) * 4;
  png.data[idx]     = color[0];
  png.data[idx + 1] = color[1];
  png.data[idx + 2] = color[2];
  png.data[idx + 3] = color[3];
}

function fillRect(x, y, w, h, color) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setPixel(x + dx, y + dy, color);
    }
  }
}

// Fill transparent background
fillRect(0, 0, WIDTH, HEIGHT, [0, 0, 0, 0]);

// Board background (2,2) to (13,29)
fillRect(2, 2, 12, 26, COLORS.bg);

// Board border
// Top and bottom
for (let x = 2; x < 14; x++) {
  setPixel(x, 1, COLORS.border);
  setPixel(x, 28, COLORS.border);
}
// Left and right
for (let y = 1; y < 29; y++) {
  setPixel(1, y, COLORS.border);
  setPixel(14, y, COLORS.border);
}

// Pin at top center
setPixel(7, 2, COLORS.pin);
setPixel(8, 2, COLORS.pin);
setPixel(7, 3, COLORS.pin);
setPixel(8, 3, COLORS.pin);

// Title line (green)
fillRect(4, 5, 8, 1, COLORS.green);

// Separator line
fillRect(3, 7, 10, 1, COLORS.border);

// Todo items (horizontal lines representing text)
// Item 1 - checked (green dot + line)
setPixel(4, 10, COLORS.green);
fillRect(6, 10, 7, 1, COLORS.white);

// Item 2 - checked (green dot + line)
setPixel(4, 13, COLORS.green);
fillRect(6, 13, 6, 1, COLORS.white);

// Item 3 - unchecked (border dot + line)
setPixel(4, 16, COLORS.border);
fillRect(6, 16, 7, 1, COLORS.white);

// Item 4 - unchecked (border dot + line)
setPixel(4, 19, COLORS.border);
fillRect(6, 19, 5, 1, COLORS.white);

// Item 5 - unchecked
setPixel(4, 22, COLORS.border);
fillRect(6, 22, 6, 1, COLORS.white);

// Write PNG
const outPath = path.join(__dirname, 'sprite.png');
const buffer = PNG.sync.write(png);
fs.writeFileSync(outPath, buffer);
console.log(`Sprite written to ${outPath} (${WIDTH}x${HEIGHT})`);
