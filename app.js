const connectBtn = document.getElementById('print-btn');
const statusInd = document.getElementById('status-indicator');
const textArea = document.getElementById('receipt-text');
const emojiInput = document.getElementById('emoji-input');

// Mode & State
let currentMode = 'label'; // label, printer, sticker
let dateOffsetDays = 0;
let printQuantity = 1;

// UI Elements
const modeBtns = document.querySelectorAll('.mode-btn');
const dateBtn = document.getElementById('date-btn');
const addDayBtn = document.getElementById('add-day-btn');
const quantityBtn = document.getElementById('quantity-btn');
const dateLabel = document.getElementById('date-label');
const previewDateToggle = document.getElementById('preview-date-toggle');
const imageControls = document.getElementById('image-controls');
const imageUpload = document.getElementById('image-upload');
const imageUploadBtn = document.getElementById('image-upload-btn');
const imageName = document.getElementById('image-name');
const imageClearBtn = document.getElementById('image-clear-btn');
let selectedImage = null;

const SERVICE_UUID = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
const WRITE_CHAR_UUID = "49535343-8841-43f4-a8d4-ecbe34729bb3";
const PRINTER_IMAGE_MAX_HEIGHT = 2000;

function getPrinterImageSize(image, maxWidth) {
    const scale = Math.min(1, maxWidth / image.width, PRINTER_IMAGE_MAX_HEIGHT / image.height);
    return {
        width: Math.max(1, Math.round(image.width * scale)),
        height: Math.max(1, Math.round(image.height * scale))
    };
}

let bluetoothDevice = null;
let writeCharacteristic = null;

// Initialization & Events
updateDateText();
quantityBtn.textContent = `x${printQuantity}`;
dateBtn.classList.remove('toggle-active'); // Ensure it's not looking like a toggle

modeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        modeBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentMode = e.target.dataset.mode;

        // Disconnect if we swap mode families
        if (bluetoothDevice) {
            let activePrefix = currentMode === 'label' ? 'AL' : 'YHK';
            if (!bluetoothDevice.name.startsWith(activePrefix)) onDisconnected();
        }
        updatePreview();
        // Show/hide label-only UI elements
        const isLabel = currentMode === 'label';
        document.getElementById('label-controls').style.display = isLabel ? 'flex' : 'none';
        document.getElementById('label-emoji').style.display = isLabel ? 'block' : 'none';
        imageControls.style.display = currentMode === 'printer' ? 'flex' : 'none';
    });
});

function updatePreview(dateTriggered = previewDateToggle.checked) {
    const text = textArea.value.trim();
    createPrintBuffer(text, dateTriggered);
}

textArea.addEventListener('input', () => updatePreview());
previewDateToggle.addEventListener('change', () => updatePreview());

imageUploadBtn.addEventListener('click', () => imageUpload.click());
imageUpload.addEventListener('change', () => {
    const file = imageUpload.files && imageUpload.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        imageUpload.value = '';
        imageName.textContent = 'Please choose an image file';
        return;
    }
    const image = new Image();
    image.onload = () => {
        selectedImage = image;
        imageName.textContent = file.name;
        imageClearBtn.style.display = 'inline-block';
        updatePreview();
        URL.revokeObjectURL(image.src);
    };
    image.onerror = () => {
        imageUpload.value = '';
        imageName.textContent = 'Could not load image';
        URL.revokeObjectURL(image.src);
    };
    image.src = URL.createObjectURL(file);
});
imageClearBtn.addEventListener('click', () => {
    selectedImage = null;
    imageUpload.value = '';
    imageName.textContent = 'No image selected';
    imageClearBtn.style.display = 'none';
    updatePreview();
});

const emojiBtn = document.getElementById('emoji-trigger-btn');
const emojiContainer = document.getElementById('emoji-picker-container');
const emojiClearBtn = document.getElementById('emoji-clear-btn');

// Picker is loaded eagerly via <script type="module"> so it's ready immediately on open.
// Wire up emoji-click once the custom element is defined.
customElements.whenDefined('emoji-picker').then(() => {
    const picker = emojiContainer.querySelector('emoji-picker');
    picker.addEventListener('emoji-click', event => {
        emojiInput.value = event.detail.unicode;
        emojiBtn.textContent = event.detail.unicode;
        emojiContainer.style.display = 'none';
        updatePreview();
    });
});

attachLongPress(emojiBtn,
    () => {
        const isOpen = emojiContainer.style.display === 'flex';
        emojiContainer.style.display = isOpen ? 'none' : 'flex';
    },
    () => {
        emojiInput.value = '';
        emojiBtn.textContent = '◌';
        updatePreview();
    }
);

emojiClearBtn.addEventListener('click', () => {
    emojiInput.value = '';
    emojiBtn.textContent = '◌';
    emojiContainer.style.display = 'none';
    updatePreview();
});

document.addEventListener('mousedown', (e) => {
    if (!emojiBtn.contains(e.target) && !emojiContainer.contains(e.target)) {
        emojiContainer.style.display = 'none';
    }
});
document.addEventListener('touchstart', (e) => {
    if (!emojiBtn.contains(e.target) && !emojiContainer.contains(e.target)) {
        emojiContainer.style.display = 'none';
    }
});

function attachLongPress(el, onClick, onLongPress, onPreviewActive) {
    let timer;
    let isLong = false;
    const start = (e) => {
        if (e.type === 'touchstart' && e.cancelable) e.preventDefault();
        isLong = false;
        timer = setTimeout(() => {
            isLong = true;
            el.classList.add('reset-triggered');
            onLongPress();
            if (navigator.vibrate) navigator.vibrate(50);
        }, 600);
    };
    const end = (e) => {
        if (e.type === 'touchend' && e.cancelable) e.preventDefault();
        clearTimeout(timer);
        if (!isLong && onClick) onClick();
        if (isLong) el.classList.remove('reset-triggered');
        if (onPreviewActive) updatePreview(false);
    };
    el.addEventListener('mousedown', (e) => { if(onPreviewActive) updatePreview(true); start(e); });
    el.addEventListener('touchstart', (e) => { if(onPreviewActive) updatePreview(true); start(e); }, { passive: false });
    el.addEventListener('mouseup', end);
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('mouseleave', () => { 
        clearTimeout(timer); 
        el.classList.remove('reset-triggered'); 
        if(onPreviewActive) updatePreview(false);
    });
}

attachLongPress(dateBtn,
    () => {
        const text = textArea.value.trim();
        printText(text, true); // True meaning include date
    },
    () => { dateOffsetDays = 0; printQuantity = 1; updateDateText(); quantityBtn.textContent = `x1`; updatePreview(true); },
    true // trigger preview layout when pressed
);
attachLongPress(addDayBtn,
    () => { dateOffsetDays++; updateDateText(); },
    () => { dateOffsetDays = 0; updateDateText(); updatePreview(false); }
);
attachLongPress(quantityBtn,
    () => { printQuantity++; if (printQuantity > 10) printQuantity = 1; quantityBtn.textContent = `x${printQuantity}`; },
    () => { printQuantity = 1; quantityBtn.textContent = `x1`; }
);

function updateDateText() {
    const d = new Date();
    d.setDate(d.getDate() + dateOffsetDays);
    dateLabel.textContent = d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Initial Call to setup layout
updatePreview();

// Bluetooth Handling
async function connectToPrinter() {
    try {
        let prefix = currentMode === 'label' ? 'AL' : 'YHK';

        if (navigator.bluetooth.getDevices && !bluetoothDevice) {
            const devices = await navigator.bluetooth.getDevices();
            for (const device of devices) {
                if (device.name && device.name.startsWith(prefix)) {
                    bluetoothDevice = device;
                    break;
                }
            }
        }

        if (!bluetoothDevice || !bluetoothDevice.name.startsWith(prefix)) {
            bluetoothDevice = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: prefix }, { services: [SERVICE_UUID] }],
                optionalServices: [SERVICE_UUID]
            });
        }

        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
        statusInd.textContent = 'Connecting...';

        const server = await bluetoothDevice.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        writeCharacteristic = await service.getCharacteristic(WRITE_CHAR_UUID);

        statusInd.textContent = 'Connected';
        statusInd.className = 'status-connected';
        connectBtn.querySelector('.btn-text').textContent = 'Print';

        if (currentMode === 'label') {
            await writeCharacteristic.writeValue(new Uint8Array([0x1e, 0x47, 0x03]));
            await new Promise(r => setTimeout(r, 100));
            await writeCharacteristic.writeValue(new Uint8Array([0x1d, 0x67, 0x53]));
            await writeCharacteristic.writeValue(new Uint8Array([0x1b, 0x40]));
            await writeCharacteristic.writeValue(new Uint8Array([0x1d, 0x49, 0xf0, 0x50]));
        } else {
            await writeCharacteristic.writeValue(new Uint8Array([0x1b, 0x40])); // Standard ESC @
        }
        await new Promise(r => setTimeout(r, 100));
        return true;
    } catch (err) {
        console.error(err);
        statusInd.textContent = 'Failed';
        statusInd.className = 'status-disconnected';
        bluetoothDevice = null;
        return false;
    }
}

function onDisconnected() {
    statusInd.textContent = 'Disconnected';
    statusInd.className = 'status-disconnected';
    writeCharacteristic = null;
    bluetoothDevice = null;
}

function drawTextInBounds(ctx, text, x, y, width, height) {
    if (!text) return;

    // Add minor padding to prevent physical bleeding
    x += 5;
    y += 5;
    width -= 10;
    height -= 10;

    let maxFont = 45; // Capped to 45 per user request to force wrapping on longer text
    let minFont = 10;
    let bestFont = 20;
    let bestLines = [];

    // Binary search font size
    for (let i = 0; i < 9; i++) {
        let f = Math.floor((maxFont + minFont) / 2);
        ctx.font = `${f}px Arial`;

        let lines = [];
        let horizontalOverflow = false;
        const rawLines = text.split('\n');
        for (let k = 0; k < rawLines.length; k++) {
            if (!rawLines[k]) { lines.push(""); continue; }
            const words = rawLines[k].split(' ');
            let cur = words[0] || '';
            if (ctx.measureText(cur).width > width - 10) horizontalOverflow = true;
            for (let j = 1; j < words.length; j++) {
                if (ctx.measureText(words[j]).width > width - 10) horizontalOverflow = true;

                if (ctx.measureText(cur + " " + words[j]).width < width - 10) cur += " " + words[j];
                else { lines.push(cur); cur = words[j]; }
            }
            lines.push(cur);
        }

        if (!horizontalOverflow && (lines.length * (f * 1.2) <= height - 4)) {
            bestFont = f;
            bestLines = [...lines];
            minFont = f + 1;
        } else {
            maxFont = f - 1;
        }
    }

    if (bestLines.length === 0) bestLines = [text];

    ctx.font = `${bestFont}px Arial`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    let lh = bestFont * 1.2;
    let startY = y + (height - (bestLines.length * lh)) / 2 + (lh / 2);
    for (let i = 0; i < bestLines.length; i++) {
        ctx.fillText(bestLines[i], x + width / 2, startY + (i * lh));
    }
}

// ─── Markdown canvas renderer ────────────────────────────────────────────────

function parseInlineMarkdown(text) {
    const segs = [];
    let i = 0, bold = false, italic = false, cur = '';
    while (i < text.length) {
        if (text.slice(i, i + 2) === '**') {
            if (cur) segs.push({ text: cur, bold, italic });
            cur = ''; bold = !bold; i += 2;
        } else if (text[i] === '*') {
            if (cur) segs.push({ text: cur, bold, italic });
            cur = ''; italic = !italic; i++;
        } else { cur += text[i++]; }
    }
    if (cur) segs.push({ text: cur, bold, italic });
    return segs.length ? segs : [{ text, bold: false, italic: false }];
}

function segFont(seg, blockBold, size) {
    const b = seg.bold || blockBold;
    return `${b ? 'bold ' : ''}${seg.italic ? 'italic ' : ''}${size}px Arial`;
}

function wrapInlineSegments(ctx, segs, maxW, size, blockBold) {
    const lines = [[]];
    let lineW = 0;
    for (const seg of segs) {
        const font = segFont(seg, blockBold, size);
        ctx.font = font;
        const parts = seg.text.split(/(\s+)/);
        for (const part of parts) {
            if (!part) continue;
            const w = ctx.measureText(part).width;
            const isSpace = /^\s+$/.test(part);
            if (isSpace) {
                if (lineW > 0) { lines[lines.length - 1].push({ text: part, font, w }); lineW += w; }
            } else {
                if (lineW + w > maxW && lineW > 0) {
                    // Trim trailing spaces from last line
                    const ll = lines[lines.length - 1];
                    while (ll.length && /^\s+$/.test(ll[ll.length - 1].text)) ll.pop();
                    lines.push([]); lineW = 0;
                }
                lines[lines.length - 1].push({ text: part, font, w });
                lineW += w;
            }
        }
        lineW = lines[lines.length - 1].reduce((s, t) => s + t.w, 0);
    }
    return lines;
}

// dryRun=true measures height without drawing, for binary-search scaling
function drawMarkdown(ctx, text, x, y, maxW, maxH, baseSize, leftAlign, dryRun = false) {
    const rawLines = text.split('\n');
    let cy = y;

    for (const raw of rawLines) {
        if (cy >= y + maxH) break;

        let size = baseSize, blockBold = false, content = raw, indent = 0;
        if (/^### /.test(raw))      { size = Math.round(baseSize * 1.1); blockBold = true; content = raw.slice(4); }
        else if (/^## /.test(raw))  { size = Math.round(baseSize * 1.35); blockBold = true; content = raw.slice(3); }
        else if (/^# /.test(raw))   { size = Math.round(baseSize * 1.6); blockBold = true; content = raw.slice(2); }
        else if (/^[*-] /.test(raw)){ content = '• ' + raw.slice(2); indent = Math.round(baseSize * 0.8); }
        else if (!raw.trim())       { cy += Math.round(baseSize * 0.6); continue; }

        const segs = parseInlineMarkdown(content);
        const wrappedLines = wrapInlineSegments(ctx, segs, maxW - indent, size, blockBold);
        const lh = Math.round(size * 1.4);

        for (const wLine of wrappedLines) {
            if (cy >= y + maxH) break;
            if (!dryRun) {
                ctx.textBaseline = 'top';
                ctx.textAlign = 'left';
                let cx = leftAlign ? x + indent : x + (maxW - wLine.reduce((s, t) => s + t.w, 0)) / 2;
                for (const seg of wLine) {
                    ctx.font = seg.font;
                    ctx.fillText(seg.text, cx, cy);
                    cx += seg.w;
                }
            }
            cy += lh;
        }
    }
    return cy - y;
}

// ─────────────────────────────────────────────────────────────────────────────

function createPrintBuffer(textRaw, includeDate) {
    const emoji = emojiInput.value.trim();
    const dateStr = includeDate ? document.getElementById('date-label').textContent : null;

    let primaryText = includeDate ? dateStr : textRaw;
    let topLeftText = includeDate ? textRaw : "";

    // Default fallback if entirely empty removed per user request

    const canvas = document.getElementById('render-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let canvasW, canvasH;
    let logW, logH; // logical space

    if (currentMode === 'label') {
        // Reverted to 320 dots length 
        canvasW = 96; canvasH = 320;
        logW = 320; logH = 96;
    }
    else if (currentMode === 'sticker') {
        canvasW = 384; canvasH = 384;
        logW = 384; logH = 384;
    }
    else {
        // Printer (Variable Height) — markdown at h1-equivalent size, left-aligned, dynamic height
        const PRINTER_FONT = 22; // = 14 * 1.6 (h1 scale factor)
        const measuredH = drawMarkdown(ctx, primaryText || '', 0, 0, 374, 999999, PRINTER_FONT, true, true);
        const imageHeight = selectedImage ? getPrinterImageSize(selectedImage, 374).height : 0;
        canvasH = Math.max(imageHeight + (imageHeight && measuredH ? 10 : 0) + measuredH + 20, 40);
        canvasW = 384;
        logW = canvasW; logH = canvasH;
    }

    canvas.width = canvasW;
    canvas.height = canvasH;
    
    // Apply CSS orientation trick so the preview reads horizontally on screen!
    if (currentMode === 'label') {
        canvas.style.transform = 'rotate(-90deg)';
        canvas.style.margin = '-112px 112px'; // Maps 96x320 flow to 320x96 flow!
    } else {
        canvas.style.transform = 'none';
        canvas.style.margin = '0';
    }
    
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = '#000000';

    ctx.save();
    if (currentMode === 'label') {
        // Rotate layout +90 (Clockwise) so X=0 prints at the Leading Edge (Y=0)!
        ctx.translate(96, 0);
        ctx.rotate(Math.PI / 2);
    }

    let rx = 0, ry = 0, rw = logW, rh = logH;

    if (currentMode === 'label') {
        // Hardware Calibration Results (30x12 label): 
        // Gap sensor expects 320 payload, but physical tape only supports 233 printable dots!
        // We restrict rendering perfectly cleanly inside the 22-box (220 dot) safe zone.
        rx = 10;  // 1 box (~10 dots) leading edge margin
        rw = 210; // 21 boxes of printable width (ends cleanly at box 22)
        ry = 10;  // 1 box top margin to counter off-center tape
        rh = 76;  // 96 total height - 20 (top and bottom margin)
    } else if (currentMode === 'sticker') {
        rx += 20; rw -= 40;
        ry += 20; rh -= 40;
    }

    // Process Emoji on the left
    if (emoji) {
        let ew = (currentMode === 'printer') ? 100 : Math.floor(rh * 0.75);
        ctx.font = `${Math.floor(ew * 0.9)}px 'Noto Emoji', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, rx + ew / 2, ry + rh / 2); // Centered precisely inside its bounding box
        rx += ew; rw -= ew;
    }

    // Process Top Left Auxiliary Text
    if (topLeftText) {
        ctx.font = '22px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const words = topLeftText.split(' ');
        let auxLines = []; let cur = words[0] || '';
        for (let i = 1; i < words.length; i++) {
            if (ctx.measureText(cur + " " + words[i]).width < rw - 10) cur += " " + words[i];
            else { auxLines.push(cur); cur = words[i]; }
        }
        auxLines.push(cur);
        for (let i = 0; i < auxLines.length; i++) {
            ctx.fillText(auxLines[i], rx + 5, ry + 5 + (i * 26));
        }
        let consumed = (auxLines.length * 26) + 10;
        ry += consumed; rh -= consumed;
    }

    if (currentMode === 'printer') {
        // Images are scaled to the printable width and placed above any accompanying text.
        let textY = ry + 5;
        if (selectedImage) {
            const size = getPrinterImageSize(selectedImage, rw);
            ctx.drawImage(selectedImage, rx + (rw - size.width) / 2, textY, size.width, size.height);
            textY += size.height + (primaryText ? 10 : 0);
        }
        // Left-aligned markdown at h1-equivalent base size (22px), no side margins
        drawMarkdown(ctx, primaryText || '', rx, textY, rw, Math.max(0, ry + rh - textY), 22, true, false);
    } else if (currentMode === 'sticker') {
        // Binary-search base font size so content fills the sticker, then draw left-aligned
        let lo = 8, hi = 60, bestSize = 14;
        for (let iter = 0; iter < 10; iter++) {
            const mid = Math.floor((lo + hi) / 2);
            const h = drawMarkdown(ctx, primaryText || '', 0, 0, rw, rh * 100, mid, true, true);
            if (h <= rh) { bestSize = mid; lo = mid + 1; } else { hi = mid - 1; }
        }
        drawMarkdown(ctx, primaryText || '', rx, ry, rw, rh, bestSize, true, false);
    } else {
        // Label mode — existing centered drawTextInBounds
        drawTextInBounds(ctx, primaryText, rx, ry, rw, rh);
    }
    ctx.restore();

    const imgData = ctx.getImageData(0, 0, canvasW, canvasH).data;
    
    // === Draw Hardware Guide Previews ===
    ctx.save();
    if (currentMode === 'label') {
        ctx.translate(96, 0);
        ctx.rotate(Math.PI / 2);
    }
    
    // Grey Printable Area
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(rx, ry, rw, rh);
    
    if (currentMode === 'label') {
        // Grey Leading Margin
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.fillRect(0, 0, rx, logH);
        
        // Dark Grey Tail Deadzone Margin
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(rx + rw, 0, logW - (rx + rw), logH);
    }
    ctx.restore();

    const xL = (canvasW / 8) & 0xFF; const xH = ((canvasW / 8) >> 8) & 0xFF;
    const yL = canvasH & 0xFF; const yH = (canvasH >> 8) & 0xFF;

    let buffer = [0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH];

    // Grayscale extraction mapping directly from RGBA
    for (let y = 0; y < canvasH; y++) {
        for (let xByte = 0; xByte < (canvasW / 8); xByte++) {
            let byteVal = 0;
            for (let bit = 0; bit < 8; bit++) {
                const x = (xByte * 8) + bit;
                const idx = (y * canvasW + x) * 4;
                // If it's fully transparent, it's white. Otherwise check Luma
                if (imgData[idx + 3] > 128) {
                    const luma = (imgData[idx] * 0.299 + imgData[idx + 1] * 0.587 + imgData[idx + 2] * 0.114);
                    if (luma < 160) byteVal |= (1 << (7 - bit)); // true = black ink
                }
            }
            buffer.push(byteVal);
        }
    }

    if (currentMode === 'label') {
        buffer.push(0x1B, 0x4A, 0xFF, 0x1B, 0x4A, 0x19); // Clear gap
    } else {
        buffer.push(0x0A, 0x0A, 0x0A); // feed 3 lines 
    }
    return new Uint8Array(buffer);
}

// Main sequence
async function printText(text, includeDate) {
    if (!writeCharacteristic) {
        if (!(await connectToPrinter())) return;
    }

    connectBtn.disabled = true;
    connectBtn.querySelector('.btn-text').textContent = 'Printing...';
    try {
        const printData = createPrintBuffer(text, includeDate);

        for (let q = 0; q < printQuantity; q++) {
            // BLE Max chunk constraint ~ 256 bytes per payload write
            for (let i = 0; i < printData.length; i += 256) {
                await writeCharacteristic.writeValue(printData.slice(i, i + 256));
                await new Promise(r => setTimeout(r, 20));
            }
            if (q < printQuantity - 1) await new Promise(r => setTimeout(r, 500));
        }
    } catch (err) {
        console.error(err);
        onDisconnected();
    } finally {
        connectBtn.disabled = false;
        connectBtn.querySelector('.btn-text').textContent = 'Connect & Print';
    }
}

connectBtn.addEventListener('click', () => {
    const text = textArea.value.trim();
    printText(text, false); // Print without date
});
