const connectBtn = document.getElementById('print-btn');
const statusInd = document.getElementById('status-indicator');
const textArea = document.getElementById('receipt-text');
const emojiInput = document.getElementById('emoji-input');

// Mode & State
let currentMode = 'label'; // label or printer
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
const generatorToggle = document.getElementById('generator-toggle');
const generatorPanel = document.getElementById('generator-panel');
const imagePrompt = document.getElementById('image-prompt');
const referenceUpload = document.getElementById('reference-upload');
const referencePreview = document.getElementById('reference-preview');
const clearReferencesBtn = document.getElementById('clear-references');
const templateButtons = document.querySelectorAll('.template-btn');
const outputDimensions = document.getElementById('output-dimensions');
const outputAspect = document.getElementById('output-aspect');
const outputSize = document.getElementById('output-size');
const apiKeyInput = document.getElementById('api-key');
const generatorStatus = document.getElementById('generator-status');
const generateImageBtn = document.getElementById('generate-image');
const generatedImagePreview = document.getElementById('generated-image-preview');
const clearGeneratedImageBtn = document.getElementById('clear-generated-image');
const cameraStartBtn = document.getElementById('camera-start');
const cameraPhotoBtn = document.getElementById('camera-photo');
const cameraRecordBtn = document.getElementById('camera-record');
const cameraStopBtn = document.getElementById('camera-stop');
const cameraPreview = document.getElementById('camera-preview');
const GEMINI_MODEL = 'gemini-2.5-flash-image';
const GEMINI_KEY_STORAGE = 'thanko_gemini_api_key';
let referenceImages = [];
let cameraStream = null;
let cameraRecorder = null;
let clipSampleTimer = null;
let clipStopTimer = null;
let clipFrames = [];
let generatedImageUrl = null;

const SERVICE_UUID = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
const WRITE_CHAR_UUID = "49535343-8841-43f4-a8d4-ecbe34729bb3";
const PRINTER_IMAGE_MAX_HEIGHT = 2000;
const KEEPALIVE_INTERVAL_MS = 20_000;

function getPrinterImageSize(image, maxWidth) {
    const scale = Math.min(1, maxWidth / image.width, PRINTER_IMAGE_MAX_HEIGHT / image.height);
    return {
        width: Math.max(1, Math.round(image.width * scale)),
        height: Math.max(1, Math.round(image.height * scale))
    };
}

let bluetoothDevice = null;
let writeCharacteristic = null;
let keepaliveTimer = null;
let isPrinting = false;

function stopKeepalive() {
    if (keepaliveTimer !== null) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
    }
}

function startKeepalive() {
    stopKeepalive();
    keepaliveTimer = setInterval(async () => {
        const characteristic = writeCharacteristic;
        if (!characteristic || isPrinting) return;

        // Query printer status without producing printed output. The label
        // printer uses this device ID query during setup as well.
        const command = currentMode === 'label'
            ? new Uint8Array([0x1d, 0x49, 0xf0, 0x50])
            : new Uint8Array([0x10, 0x04, 0x01]);
        try {
            await characteristic.writeValue(command);
        } catch (err) {
            console.warn('Printer keepalive failed', err);
            onDisconnected();
        }
    }, KEEPALIVE_INTERVAL_MS);
}

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
        outputDimensions.hidden = currentMode !== 'printer';
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
    imageUpload.value = '';
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
        clearGeneratedImageBtn.hidden = true;
        generatedImagePreview.hidden = true;
        if (generatedImageUrl) {
            URL.revokeObjectURL(generatedImageUrl);
            generatedImageUrl = null;
        }
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
function clearSelectedArtwork() {
    selectedImage = null;
    imageUpload.value = '';
    imageName.textContent = 'No image selected';
    imageClearBtn.style.display = 'none';
    generatedImagePreview.hidden = true;
    clearGeneratedImageBtn.hidden = true;
    if (generatedImageUrl) {
        URL.revokeObjectURL(generatedImageUrl);
        generatedImageUrl = null;
    }
    updatePreview();
}
imageClearBtn.addEventListener('click', clearSelectedArtwork);
clearGeneratedImageBtn.addEventListener('click', clearSelectedArtwork);

generatorToggle.addEventListener('click', () => {
    generatorPanel.hidden = !generatorPanel.hidden;
    generatorToggle.setAttribute('aria-expanded', String(!generatorPanel.hidden));
});

function renderReferencePreviews() {
    referencePreview.replaceChildren();
    for (const reference of referenceImages) {
        const img = document.createElement('img');
        img.src = `data:${reference.mimeType};base64,${reference.data}`;
        img.alt = reference.label;
        img.title = reference.label;
        referencePreview.append(img);
    }
}

function addReferenceImage(reference) {
    referenceImages = [...referenceImages.filter(item => item.label !== reference.label), reference].slice(-6);
    renderReferencePreviews();
}

clearReferencesBtn.addEventListener('click', () => {
    referenceImages = [];
    templateButtons.forEach(button => button.setAttribute('aria-pressed', 'false'));
    renderReferencePreviews();
    generatorStatus.textContent = 'Reference images cleared.';
});

function dataUrlToReference(dataUrl, label) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error('This image format is not supported. Choose PNG, JPEG, or WebP.');
    return { mimeType: match[1], data: match[2], label };
}

referenceUpload.addEventListener('change', () => {
    const file = referenceUpload.files && referenceUpload.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        generatorStatus.textContent = 'Choose a PNG, JPEG, or WebP reference image.';
        referenceUpload.value = '';
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        generatorStatus.textContent = 'Reference images must be 10 MB or smaller.';
        referenceUpload.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const image = new Image();
            image.onload = () => {
                const scale = Math.min(1, 1024 / image.width, 1024 / image.height);
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                addReferenceImage(dataUrlToReference(canvas.toDataURL('image/jpeg', 0.85), file.name));
                generatorStatus.textContent = `Added ${file.name} as a reference.`;
            };
            image.onerror = () => { generatorStatus.textContent = 'Could not decode that reference image.'; };
            image.src = reader.result;
        } catch (error) {
            generatorStatus.textContent = error.message;
        }
    };
    reader.onerror = () => { generatorStatus.textContent = 'Could not read that image.'; };
    reader.readAsDataURL(file);
});

function captureCameraFrame(label) {
    const width = cameraPreview.videoWidth;
    const height = cameraPreview.videoHeight;
    if (!width || !height) throw new Error('The camera is not ready yet.');
    const scale = Math.min(1, 1024 / width, 1024 / height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(cameraPreview, 0, 0, canvas.width, canvas.height);
    return dataUrlToReference(canvas.toDataURL('image/jpeg', 0.88), label);
}

cameraStartBtn.addEventListener('click', async () => {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
        cameraPreview.srcObject = null;
        cameraPreview.hidden = true;
        cameraStartBtn.textContent = 'Open Camera';
        cameraPhotoBtn.disabled = true;
        cameraRecordBtn.disabled = true;
        return;
    }
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        cameraPreview.srcObject = cameraStream;
        cameraPreview.hidden = false;
        await cameraPreview.play();
        cameraStartBtn.textContent = 'Close Camera';
        cameraPhotoBtn.disabled = false;
        cameraRecordBtn.disabled = typeof MediaRecorder === 'undefined';
        generatorStatus.textContent = 'Camera ready. Take a photo or record a short reference clip.';
    } catch (error) {
        generatorStatus.textContent = `Could not open the camera: ${error.message}`;
    }
});

cameraPhotoBtn.addEventListener('click', () => {
    try {
        addReferenceImage(captureCameraFrame('Camera photo'));
        generatorStatus.textContent = 'Added the camera photo as a reference.';
    } catch (error) {
        generatorStatus.textContent = error.message;
    }
});

function stopReferenceClip() {
    if (clipSampleTimer) clearInterval(clipSampleTimer);
    if (clipStopTimer) clearTimeout(clipStopTimer);
    clipSampleTimer = null;
    clipStopTimer = null;
    if (cameraRecorder && cameraRecorder.state === 'recording') cameraRecorder.stop();
    cameraRecorder = null;
    cameraStopBtn.hidden = true;
    cameraRecordBtn.hidden = false;
    cameraPhotoBtn.disabled = false;
    if (!clipFrames.length) {
        generatorStatus.textContent = 'No video frames were captured. Try again with the camera in view.';
        return;
    }
    clipFrames.forEach((frame, index) => addReferenceImage({ ...frame, label: `Video frame ${index + 1}` }));
    generatorStatus.textContent = `Added ${clipFrames.length} keyframes from the video clip as references.`;
    clipFrames = [];
}

cameraRecordBtn.addEventListener('click', () => {
    if (!cameraStream) return;
    try {
        cameraRecorder = new MediaRecorder(cameraStream);
        cameraRecorder.start();
        clipFrames = [];
        const capture = () => {
            if (clipFrames.length < 3) {
                try { clipFrames.push(captureCameraFrame(`Video frame ${clipFrames.length + 1}`)); } catch (_) { /* wait for the next frame */ }
            }
        };
        capture();
        clipSampleTimer = setInterval(capture, 1300);
        clipStopTimer = setTimeout(stopReferenceClip, 4000);
        cameraStopBtn.hidden = false;
        cameraRecordBtn.hidden = true;
        cameraPhotoBtn.disabled = true;
        generatorStatus.textContent = 'Recording a four-second clip. Three keyframes will be used as references.';
    } catch (error) {
        generatorStatus.textContent = `Could not record a clip: ${error.message}`;
    }
});
cameraStopBtn.addEventListener('click', stopReferenceClip);
window.addEventListener('pagehide', () => {
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
    if (clipSampleTimer) clearInterval(clipSampleTimer);
    if (clipStopTimer) clearTimeout(clipStopTimer);
    stopKeepalive();
});

const templateArtwork = {
    sun: '<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384" viewBox="0 0 384 384"><g fill="none" stroke="#000" stroke-width="18" stroke-linecap="round"><circle cx="192" cy="192" r="70"/><path d="M192 28v48M192 308v48M28 192h48M308 192h48M76 76l34 34M274 274l34 34M308 76l-34 34M110 274l-34 34"/></g></svg>',
    flower: '<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384" viewBox="0 0 384 384"><g fill="none" stroke="#000" stroke-width="16"><circle cx="192" cy="192" r="38" fill="#000"/><circle cx="192" cy="112" r="42"/><circle cx="264" cy="152" r="42"/><circle cx="264" cy="232" r="42"/><circle cx="192" cy="272" r="42"/><circle cx="120" cy="232" r="42"/><circle cx="120" cy="152" r="42"/><path d="M192 230v112m0-42c-26-26-55-24-70-18m70-14c23-24 48-26 66-22"/></g></svg>',
    cat: '<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384" viewBox="0 0 384 384"><g fill="none" stroke="#000" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"><path d="M98 156 82 66l82 52q28-8 56 0l82-52-16 90q28 32 28 76c0 69-53 112-122 112S70 301 70 232q0-44 28-76Z"/><path d="M134 213h2m112 0h2M157 257q35 30 70 0m-35-22v18"/></g></svg>'
};

templateButtons.forEach(button => button.addEventListener('click', async () => {
    const svg = templateArtwork[button.dataset.template];
    if (!svg) return;
    try {
        const image = new Image();
        const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
            image.src = source;
        });
        const canvas = document.createElement('canvas');
        canvas.width = 384;
        canvas.height = 384;
        canvas.getContext('2d').drawImage(image, 0, 0);
        addReferenceImage(dataUrlToReference(canvas.toDataURL('image/png'), `${button.textContent.trim()} template`));
        templateButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        generatorStatus.textContent = 'Added the template as a style reference.';
    } catch (error) {
        generatorStatus.textContent = 'Could not load that template.';
    }
}));

function friendlyGeminiError(response, payload) {
    const message = payload && payload.error && payload.error.message;
    if (response.status === 400 || response.status === 401) return 'The API key or request was rejected. Check the key and try again.';
    if (response.status === 403) return 'Google denied access. Check API key restrictions and enable billing for the Google AI project.';
    if (response.status === 429) return 'The Google API quota or rate limit was reached. Try again later or check billing and quotas.';
    return message || `Google API request failed (${response.status}).`;
}

async function testGeminiAccess() {
    const key = apiKeyInput.value.trim();
    if (!key) throw new Error('Enter your Gemini API key first.');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}?key=${encodeURIComponent(key)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(friendlyGeminiError(response, payload));
    return payload;
}

document.getElementById('save-api-key').addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
        generatorStatus.textContent = 'Paste a Gemini API key before saving.';
        return;
    }
    try {
        localStorage.setItem(GEMINI_KEY_STORAGE, key);
        generatorStatus.textContent = 'Key saved in this browser only.';
    } catch (error) {
        generatorStatus.textContent = 'Could not access local storage in this browser.';
    }
});

document.getElementById('forget-api-key').addEventListener('click', () => {
    try {
        localStorage.removeItem(GEMINI_KEY_STORAGE);
        apiKeyInput.value = '';
        generatorStatus.textContent = 'Saved key removed from this browser.';
    } catch (error) {
        generatorStatus.textContent = 'Could not access local storage in this browser.';
    }
});

document.getElementById('test-api-key').addEventListener('click', async () => {
    generatorStatus.textContent = 'Checking access to the Gemini image model…';
    try {
        await testGeminiAccess();
        generatorStatus.textContent = 'Gemini image model is available for this key.';
    } catch (error) {
        generatorStatus.textContent = error.message;
    }
});

try { apiKeyInput.value = localStorage.getItem(GEMINI_KEY_STORAGE) || ''; } catch (_) { /* storage is optional */ }

generateImageBtn.addEventListener('click', async () => {
    const prompt = imagePrompt.value.trim();
    if (!prompt) {
        generatorStatus.textContent = 'Describe the image you want first.';
        imagePrompt.focus();
        return;
    }
    const key = apiKeyInput.value.trim();
    if (!key) {
        generatorStatus.textContent = 'Add a Gemini API key in the settings below to generate artwork.';
        document.querySelector('.api-key-settings').open = true;
        apiKeyInput.focus();
        return;
    }

    const targetMode = currentMode;
    const thermalInstruction = `Create one family-friendly image for a direct thermal printer. Target output mode: ${targetMode}. Use bold black line art and solid black shapes on a pure white background. Maximize contrast. Avoid grayscale shading, gradients, textures, tiny details, borders, watermarks, and all text or lettering. Keep the subject centered with generous white margins. ${targetMode === 'label' ? 'Compose for a narrow horizontal label; keep the subject simple and wide.' : 'Compose to fit the selected output aspect ratio.'} Treat reference images only as visual guidance; do not copy any text in them.`;
    const parts = [{ text: prompt }, ...referenceImages.map(reference => ({ inlineData: { mimeType: reference.mimeType, data: reference.data } }))];
    const requestBody = {
        systemInstruction: { parts: [{ text: thermalInstruction }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
    };
    if (targetMode === 'printer') {
        requestBody.generationConfig.imageConfig = { aspectRatio: outputAspect.value, imageSize: outputSize.value };
    }

    generateImageBtn.disabled = true;
    generatorStatus.textContent = 'Generating artwork with Gemini…';
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(friendlyGeminiError(response, payload));
        const responseParts = (payload.candidates || []).flatMap(candidate => candidate.content?.parts || []);
        const imagePart = responseParts.find(part => part.inlineData || part.inline_data);
        if (!imagePart) throw new Error('Gemini returned no image. Try a clearer prompt or a different reference image.');
        const imageData = imagePart.inlineData || imagePart.inline_data;
        const mimeType = imageData.mimeType || imageData.mime_type || 'image/png';
        if (generatedImageUrl) URL.revokeObjectURL(generatedImageUrl);
        generatedImageUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob(imageData.data), char => char.charCodeAt(0))], { type: mimeType }));
        await new Promise((resolve, reject) => {
            generatedImagePreview.onload = resolve;
            generatedImagePreview.onerror = reject;
            generatedImagePreview.src = generatedImageUrl;
        });
        generatedImagePreview.hidden = false;
        selectedImage = generatedImagePreview;
        imageName.textContent = 'Generated artwork';
        imageClearBtn.style.display = 'inline-block';
        clearGeneratedImageBtn.hidden = false;
        updatePreview();
        generatorStatus.textContent = `Artwork generated for ${targetMode} mode and loaded into the print preview.`;
    } catch (error) {
        generatorStatus.textContent = error instanceof TypeError
            ? 'Could not reach Google. Check your connection, API key restrictions, and browser network access.'
            : error.message;
    } finally {
        generateImageBtn.disabled = false;
    }
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
        startKeepalive();
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
    stopKeepalive();
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
    } else {
        // Label mode — existing centered drawTextInBounds
        if (selectedImage) {
            const scale = Math.min(rw / selectedImage.width, rh / selectedImage.height);
            const imageW = Math.max(1, Math.round(selectedImage.width * scale));
            const imageH = Math.max(1, Math.round(selectedImage.height * scale));
            ctx.drawImage(selectedImage, rx + (rw - imageW) / 2, ry + (rh - imageH) / 2, imageW, imageH);
        }
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
    isPrinting = true;
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
        isPrinting = false;
        connectBtn.disabled = false;
        connectBtn.querySelector('.btn-text').textContent = 'Connect & Print';
    }
}

connectBtn.addEventListener('click', () => {
    const text = textArea.value.trim();
    printText(text, false); // Print without date
});
