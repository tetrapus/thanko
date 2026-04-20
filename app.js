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

const SERVICE_UUID = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
const WRITE_CHAR_UUID = "49535343-8841-43f4-a8d4-ecbe34729bb3";

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
    });
});

function updatePreview(dateTriggered = previewDateToggle.checked) {
    const text = textArea.value.trim();
    createPrintBuffer(text, dateTriggered);
}

textArea.addEventListener('input', () => updatePreview());
previewDateToggle.addEventListener('change', () => updatePreview());

const emojiBtn = document.getElementById('emoji-trigger-btn');
const emojiContainer = document.getElementById('emoji-picker-container');
const picker = document.querySelector('emoji-picker');

attachLongPress(emojiBtn,
    () => { 
        emojiContainer.style.display = emojiContainer.style.display === 'none' ? 'block' : 'none'; 
    },
    () => { 
        emojiInput.value = ''; 
        emojiBtn.innerHTML = '🍔'; 
        updatePreview(); 
    }
);

picker.addEventListener('emoji-click', event => {
    emojiInput.value = event.detail.unicode;
    emojiBtn.innerHTML = event.detail.unicode;
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
        // Printer (Variable Height)
        ctx.font = `36px Arial`;
        let linesP = [];
        const rawLines = primaryText.split('\n');
        let availW = 384 - (emoji ? 100 : 0);

        for (let k = 0; k < rawLines.length; k++) {
            if (!rawLines[k]) { linesP.push(""); continue; }
            const words = rawLines[k].split(' ');
            let cur = words[0] || '';
            for (let i = 1; i < words.length; i++) {
                if (ctx.measureText(cur + " " + words[i]).width < availW - 20) cur += " " + words[i];
                else { linesP.push(cur); cur = words[i]; }
            }
            linesP.push(cur);
        }

        // Calculate auxiliary text height if any
        let topH = 0;
        if (topLeftText) {
            ctx.font = '22px Arial';
            const auxWords = topLeftText.split(' ');
            let auxLines = 1; let cAux = auxWords[0] || '';
            for (let i = 1; i < auxWords.length; i++) {
                if (ctx.measureText(cAux + " " + auxWords[i]).width < availW - 20) cAux += " " + auxWords[i];
                else { auxLines++; cAux = auxWords[i]; }
            }
            topH = (auxLines * 26) + 10;
        }

        canvasH = topH + (linesP.length * 45) + 30;
        if (emoji && canvasH < 120) canvasH = 120;
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
        let ew = (currentMode === 'printer') ? 100 : rh;
        ctx.font = `${Math.floor(ew * 0.8)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
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
        ctx.font = `36px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        let cLines = [];
        const cRaw = primaryText.split('\n');
        for (let k = 0; k < cRaw.length; k++) {
            if (!cRaw[k]) { cLines.push(""); continue; }
            const words = cRaw[k].split(' ');
            let cur = words[0] || '';
            for (let i = 1; i < words.length; i++) {
                if (ctx.measureText(cur + " " + words[i]).width < rw - 20) cur += " " + words[i];
                else { cLines.push(cur); cur = words[i]; }
            }
            cLines.push(cur);
        }
        for (let i = 0; i < cLines.length; i++) {
            ctx.fillText(cLines[i], rx + rw / 2, ry + (i * 45));
        }
    } else {
        // Render Primary text inside the remaining box bounds
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
