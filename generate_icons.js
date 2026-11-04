const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createFishPNG(size) {
    // Generate RGBA buffer
    const width = size;
    const height = size;
    const rowSize = width * 4;
    const rawData = Buffer.alloc((rowSize + 1) * height);

    const cx = width / 2;
    const cy = height / 2;
    const r = width * 0.44;

    for (let y = 0; y < height; y++) {
        const rowOffset = y * (rowSize + 1);
        rawData[rowOffset] = 0; // Filter byte: 0 (None)

        for (let x = 0; x < width; x++) {
            const pixelOffset = rowOffset + 1 + x * 4;
            const dx = (x - cx) / r;
            const dy = (y - cy) / r;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= 1.0) {
                // Background bubble bowl / circle: deep cyan blue gradient
                const grad = (y / height);
                let red = Math.round(15 + 20 * grad);
                let green = Math.round(90 + 90 * (1 - grad));
                let blue = Math.round(160 + 80 * (1 - grad));
                let alpha = 255;

                // Fish body (orange ellipse in center)
                const fdx = (x - (cx - size * 0.05)) / (size * 0.28);
                const fdy = (y - cy) / (size * 0.18);
                if (fdx * fdx + fdy * fdy <= 1.0) {
                    red = 255;
                    green = 120 + Math.round(fdx * 30);
                    blue = 30;

                    // White stripe on fish body
                    if (Math.abs(fdx + 0.1) < 0.2) {
                        red = 255; green = 255; blue = 255;
                    }
                    // Eye
                    const edx = x - (cx - size * 0.2);
                    const edy = y - (cy - size * 0.04);
                    if (edx * edx + edy * edy < (size * 0.04) * (size * 0.04)) {
                        red = 30; green = 30; blue = 40;
                    }
                }

                // Fish tail
                const tdx = (x - (cx + size * 0.25));
                const tdy = (y - cy);
                if (tdx > 0 && tdx < size * 0.2 && Math.abs(tdy) < tdx * 0.8) {
                    red = 255; green = 110; blue = 20;
                }

                // Bubble highlight near top-left
                const bdx = (x - (cx - r * 0.45));
                const bdy = (y - (cy - r * 0.45));
                if (bdx * bdx + bdy * bdy < (r * 0.25) * (r * 0.25)) {
                    red = Math.min(255, red + 90);
                    green = Math.min(255, green + 90);
                    blue = Math.min(255, blue + 90);
                }

                rawData[pixelOffset] = red;
                rawData[pixelOffset + 1] = green;
                rawData[pixelOffset + 2] = blue;
                rawData[pixelOffset + 3] = alpha;
            } else {
                // Transparent
                rawData[pixelOffset] = 0;
                rawData[pixelOffset + 1] = 0;
                rawData[pixelOffset + 2] = 0;
                rawData[pixelOffset + 3] = 0;
            }
        }
    }

    const compressed = zlib.deflateSync(rawData);

    // Build PNG chunks
    function makeChunk(type, data) {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);

        const typeBuf = Buffer.from(type, 'ascii');
        const crcBuf = Buffer.alloc(4);

        const crcTable = [];
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            }
            crcTable[n] = c >>> 0;
        }

        let crc = 0xffffffff;
        for (let i = 0; i < typeBuf.length; i++) {
            crc = crcTable[(crc ^ typeBuf[i]) & 0xff] ^ (crc >>> 8);
        }
        for (let i = 0; i < data.length; i++) {
            crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
        }
        crc = (crc ^ 0xffffffff) >>> 0;
        crcBuf.writeUInt32BE(crc, 0);

        return Buffer.concat([len, typeBuf, data, crcBuf]);
    }

    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // Bit depth: 8
    ihdr[9] = 6; // Color type: 6 (RGBA)
    ihdr[10] = 0; // Compression
    ihdr[11] = 0; // Filter
    ihdr[12] = 0; // Interlace

    const ihdrChunk = makeChunk('IHDR', ihdr);
    const idatChunk = makeChunk('IDAT', compressed);
    const iendChunk = makeChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.join(__dirname, 'icons');
[16, 48, 128].forEach(size => {
    const png = createFishPNG(size);
    fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
    console.log(`Generated icon${size}.png`);
});
