# Dive History Export and Visualization - Design Document

**Date:** 2025-12-16
**Status:** Draft for Review
**Goal:** Enable users to download dive logs from Cosmiq 5 and visualize them directly in the browser

## 1. Overview

This feature adds dive history export and visualization to the Cosmiq 5 web manager. Users will be able to download their dive logs via Bluetooth and immediately view depth/time profiles rendered on HTML Canvas, with no external dependencies or Python scripts required.

### Success Criteria
- **Minimum Viable:** Users can download dive logs and view depth/time profile graphs in the browser
- **Ideal:** Export to standard dive log formats (UDDF, Subsurface) for compatibility with other software

### Design Constraints
- Zero external dependencies (no Chart.js, no matplotlib)
- Pure HTML5 Canvas + vanilla JavaScript
- All processing in-memory (no file downloads required)
- Consistent with existing codebase style (single HTML file)

## 2. Architecture

### High-Level Flow

```
User clicks "Download Logs"
    ↓
Send BLE commands (#41 header, #43 body)
    ↓
Device streams packets (0x42 header, 0x44 body)
    ↓
Collect packets in memory (hex strings)
    ↓
Parse headers (72 bytes each → dive metadata)
    ↓
Parse body (binary depth samples)
    ↓
Render on Canvas (depth vs time graph)
    ↓
[Optional] Export to UDDF/Subsurface format
```

### Component Breakdown

**A. BLE Download Module** (exists in `divelog_download_parse` branch)
- Manages packet collection state
- Sends header/body request commands
- Accumulates incoming hex strings
- Shows download progress

**B. Binary Parser Module** (new - port from Python)
- `parseHeaders(hexString)` → Array of dive metadata objects
- `parseBody(hexString, header)` → Array of depth samples
- Handle little-endian byte unpacking in JavaScript

**C. Canvas Renderer Module** (new)
- `renderDiveProfile(canvas, samples, metadata)` → void
- Draw axes, grid lines, labels
- Plot depth samples as connected line
- Handle axis inversion (depth increases downward)

**D. Export Module** (future enhancement)
- `exportToUDDF(dives)` → XML string
- `exportToSubsurface(dives)` → XML string
- Trigger browser download of generated file

## 3. Data Structures

### Dive Header Object
```javascript
{
    logNumber: 1,              // Dive number
    mode: 0,                   // 0=Scuba, 1=Gauge, 2=Freedive
    oxygenPercent: 21,         // Air mix
    date: {
        year: 2025,
        month: 12,
        day: 16,
        hour: 14,
        minute: 30
    },
    durationMinutes: 45,       // Total dive time
    maxDepthMeters: 18.5,      // Maximum depth
    minTempCelsius: 12.3,      // Minimum temperature
    logPeriod: 1,              // Sampling interval in seconds
    logLength: 2700,           // Body data length in bytes
    startSector: 12,           // Memory sector location
    endSector: 13
}
```

### Dive Sample Object
```javascript
{
    timeSeconds: 0,            // Time since dive start
    depthMeters: 18.5,         // Depth at this sample
    marker: 0xC2               // Raw marker byte (for debugging)
}
```

## 4. Implementation Details

### Part 1: BLE Download (Reuse Existing)

The `divelog_download_parse` branch already has working code:

```javascript
// State management
const dumpState = {
    active: false,
    phase: 0,      // 0=header, 1=body
    packets: []    // Collected hex strings
};

// Trigger download
async function downloadLogs() {
    dumpState.active = true;
    dumpState.packets = [];

    // Request header
    await sendStatic("#41BD0200", "Request Header");

    // Wait for header response, then request body
    // (handled in handleRX when 0x42 packets arrive)
}

// In handleRX(), collect packets:
if (cmd === "42") {
    dumpState.packets.push(line);
    // When complete, trigger body request
} else if (cmd === "44") {
    dumpState.packets.push(line);
    // Accumulate body packets
}
```

**Key modification:** Instead of saving to file, call parser when download completes.

### Part 2: Binary Parsing (Port from Python)

**Parse Headers:**
```javascript
function parseHeaders(headerHex) {
    // headerHex is concatenated payload from all 0x42 packets
    const bytes = hexToBytes(headerHex);
    const dives = [];

    // Each header is 72 bytes
    for (let i = 0; i < bytes.length; i += 72) {
        if (i + 72 > bytes.length) break;

        const chunk = bytes.slice(i, i + 72);

        // Skip empty headers
        const logNum = readUint16LE(chunk, 0);
        if (logNum === 0 || logNum === 0xFFFF) continue;

        const dive = {
            logNumber: logNum,
            mode: chunk[2],
            oxygenPercent: chunk[3],
            date: {
                year: readUint16LE(chunk, 6) + 2000,
                month: (readUint16LE(chunk, 8) >> 8) & 0xFF,
                day: readUint16LE(chunk, 8) & 0xFF,
                hour: (readUint16LE(chunk, 10) >> 8) & 0xFF,
                minute: readUint16LE(chunk, 10) & 0xFF
            },
            durationMinutes: readUint16LE(chunk, 12),
            maxDepthMeters: readUint16LE(chunk, 22) / 100.0,
            minTempCelsius: readInt16LE(chunk, 24) / 10.0,
            logPeriod: chunk[28],
            logLength: readUint16LE(chunk, 28),
            startSector: readUint16LE(chunk, 30),
            endSector: readUint16LE(chunk, 32)
        };

        dives.push(dive);
    }

    return dives;
}
```

**Parse Body Samples:**
```javascript
function parseSamples(bodyHex, header) {
    const bytes = hexToBytes(bodyHex);
    const SECTOR_SIZE = 4096;

    // Calculate offset for this dive's data
    const startOffset = (header.startSector - 12) * SECTOR_SIZE;
    const diveData = bytes.slice(startOffset, startOffset + header.logLength);

    const samples = [];
    const validMarkers = [
        0xC0, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7,
        0xC8, 0xC9, 0xCA, 0xCB, 0xCC, 0xCD, 0xCE, 0xCF,
        0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7,
        0xB8, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF
    ];

    let i = 0;
    let sampleIndex = 0;

    // Parse 4-byte samples: [Marker] [0x00] [Depth_Low] [Depth_High]
    while (i < diveData.length - 4) {
        const marker = diveData[i];

        if (diveData[i + 1] === 0x00 && validMarkers.includes(marker)) {
            const depthRaw = readUint16LE(diveData, i + 2);

            // Sanity check: max dive computer depth ~200m
            if (depthRaw > 0 && depthRaw < 20000) {
                samples.push({
                    timeSeconds: sampleIndex * header.logPeriod,
                    depthMeters: depthRaw / 100.0,
                    marker: marker
                });
                sampleIndex++;
            }

            i += 4;  // Move to next sample
        } else {
            i += 1;  // Scan forward
        }
    }

    return samples;
}
```

**Helper Functions:**
```javascript
function hexToBytes(hexString) {
    const bytes = [];
    for (let i = 0; i < hexString.length; i += 2) {
        bytes.push(parseInt(hexString.substr(i, 2), 16));
    }
    return bytes;
}

function readUint16LE(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function readInt16LE(bytes, offset) {
    const val = readUint16LE(bytes, offset);
    return val > 32767 ? val - 65536 : val;
}
```

### Part 3: Canvas Rendering

**Render Dive Profile:**
```javascript
function renderDiveProfile(canvasId, samples, metadata) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');

    // Set canvas size
    canvas.width = 800;
    canvas.height = 500;

    // Calculate dimensions
    const padding = 60;
    const graphWidth = canvas.width - 2 * padding;
    const graphHeight = canvas.height - 2 * padding;

    // Find data bounds
    const maxDepth = Math.max(...samples.map(s => s.depthMeters));
    const maxTime = Math.max(...samples.map(s => s.timeSeconds));

    // Clear canvas
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;

    // Horizontal grid lines (depth)
    const depthStep = Math.ceil(maxDepth / 5);
    for (let d = 0; d <= maxDepth; d += depthStep) {
        const y = padding + (d / maxDepth) * graphHeight;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(padding + graphWidth, y);
        ctx.stroke();

        // Label
        ctx.fillStyle = '#666';
        ctx.font = '12px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${d}m`, padding - 10, y + 4);
    }

    // Vertical grid lines (time)
    const timeStep = Math.ceil(maxTime / 10 / 60) * 60; // Round to minutes
    for (let t = 0; t <= maxTime; t += timeStep) {
        const x = padding + (t / maxTime) * graphWidth;
        ctx.beginPath();
        ctx.moveTo(x, padding);
        ctx.lineTo(x, padding + graphHeight);
        ctx.stroke();

        // Label
        ctx.fillStyle = '#666';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.floor(t / 60)}min`, x, canvas.height - padding + 20);
    }

    // Draw axes
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.strokeRect(padding, padding, graphWidth, graphHeight);

    // Plot dive profile
    ctx.strokeStyle = '#007bff';
    ctx.lineWidth = 2;
    ctx.beginPath();

    samples.forEach((sample, idx) => {
        const x = padding + (sample.timeSeconds / maxTime) * graphWidth;
        const y = padding + (sample.depthMeters / maxDepth) * graphHeight;

        if (idx === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();

    // Draw title
    ctx.fillStyle = '#212529';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    const title = `Dive #${metadata.logNumber} - ${metadata.date.year}/${metadata.date.month}/${metadata.date.day} ${metadata.date.hour}:${metadata.date.minute}`;
    ctx.fillText(title, canvas.width / 2, 30);

    // Draw stats
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Max Depth: ${metadata.maxDepthMeters.toFixed(1)}m`, padding, canvas.height - 10);
    ctx.fillText(`Duration: ${metadata.durationMinutes}min`, padding + 200, canvas.height - 10);
    ctx.fillText(`Min Temp: ${metadata.minTempCelsius.toFixed(1)}°C`, padding + 400, canvas.height - 10);
}
```

### Part 4: UI Integration

**Add to Diagnostics Tab:**
```html
<div id="diag" class="section">
    <!-- Existing byte hunter code -->

    <!-- New dive log section -->
    <div class="card">
        <h3>Dive Log Download</h3>
        <button class="btn-main" onclick="downloadDiveLogs()">
            Download All Dive Logs
        </button>
        <div id="downloadProgress" style="display:none;">
            <p id="downloadStatus">Downloading...</p>
            <div style="width:100%; background:#ddd; height:20px; border-radius:10px;">
                <div id="downloadBar" style="width:0%; background:var(--blue); height:100%; border-radius:10px;"></div>
            </div>
        </div>
    </div>

    <div id="diveList" style="display:none;">
        <h3>Downloaded Dives</h3>
        <div id="diveCards"></div>
    </div>

    <canvas id="diveCanvas" style="display:none; margin-top:20px;"></canvas>
</div>
```

**Orchestration Function:**
```javascript
async function downloadDiveLogs() {
    // Show progress UI
    document.getElementById('downloadProgress').style.display = 'block';
    document.getElementById('downloadStatus').innerText = 'Requesting header...';

    // Clear state
    dumpState.active = true;
    dumpState.phase = 0;
    dumpState.packets = [];

    // Request header
    await sendStatic("#41BD0200", "Request Header");

    // Body request happens automatically in handleRX when header completes
    // When all packets collected, handleRX calls processDiveLogs()
}

function processDiveLogs() {
    document.getElementById('downloadStatus').innerText = 'Processing...';

    // Separate header and body packets
    const headerHex = dumpState.packets
        .filter(p => p.startsWith('42'))
        .map(p => p.substring(6))  // Strip command/checksum/length
        .join('');

    const bodyHex = dumpState.packets
        .filter(p => p.startsWith('44'))
        .map(p => p.substring(6))
        .join('');

    // Parse
    const dives = parseHeaders(headerHex);

    // Display dive list
    const diveCards = document.getElementById('diveCards');
    diveCards.innerHTML = '';

    dives.forEach(dive => {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <h4>Dive #${dive.logNumber}</h4>
            <p>${dive.date.year}/${dive.date.month}/${dive.date.day} ${dive.date.hour}:${String(dive.date.minute).padStart(2, '0')}</p>
            <p>Max Depth: ${dive.maxDepthMeters.toFixed(1)}m | Duration: ${dive.durationMinutes}min</p>
        `;
        card.onclick = () => viewDive(dive, bodyHex);
        diveCards.appendChild(card);
    });

    document.getElementById('diveList').style.display = 'block';
    document.getElementById('downloadProgress').style.display = 'none';
}

function viewDive(header, bodyHex) {
    const samples = parseSamples(bodyHex, header);

    const canvas = document.getElementById('diveCanvas');
    canvas.style.display = 'block';
    renderDiveProfile('diveCanvas', samples, header);

    // Scroll to canvas
    canvas.scrollIntoView({ behavior: 'smooth' });
}
```

## 5. Future Enhancements (Post-MVP)

### Export to UDDF Format
Universal Dive Data Format is an XML standard supported by many dive apps:

```javascript
function exportToUDDF(dives, bodyHex) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<uddf version="3.2.0">
    <generator>
        <name>Cosmiq 5 Web Manager</name>
        <version>1.0</version>
    </generator>
    <diver>
        <owner id="owner1">
            <equipment>
                <divecomputer id="cosmiq5">
                    <name>Deepblu Cosmiq 5</name>
                    <model>Cosmiq 5</model>
                </divecomputer>
            </equipment>
        </owner>
    </diver>
    <profiledata>
        ${dives.map(dive => {
            const samples = parseSamples(bodyHex, dive);
            return `
        <repetitiongroup id="rg${dive.logNumber}">
            <dive id="dive${dive.logNumber}">
                <informationbeforedive>
                    <datetime>${formatUDDFDate(dive.date)}</datetime>
                    <divenumber>${dive.logNumber}</divenumber>
                </informationbeforedive>
                <samples>
                    ${samples.map(s => `
                    <waypoint>
                        <divetime>${s.timeSeconds}</divetime>
                        <depth>${s.depthMeters}</depth>
                    </waypoint>`).join('')}
                </samples>
                <informationafterdive>
                    <greatestdepth>${dive.maxDepthMeters}</greatestdepth>
                    <diveduration>${dive.durationMinutes * 60}</diveduration>
                    <lowesttemperature>${dive.minTempCelsius}</lowesttemperature>
                </informationafterdive>
            </dive>
        </repetitiongroup>`;
        }).join('')}
    </profiledata>
</uddf>`;

    // Trigger download
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cosmiq5_dives_${Date.now()}.uddf`;
    a.click();
}
```

### Export to Subsurface Format
Subsurface uses a custom XML dialect. Similar approach to UDDF but different schema.

## 6. Testing Strategy

### Unit Tests (Manual)
- **Parser validation:** Use known hex dumps from branch to verify parsing
- **Boundary conditions:** Empty logs, single dive, max dives
- **Data integrity:** Compare parsed values against Python output

### Integration Tests
- **Full workflow:** Download → Parse → Render on real device
- **Edge cases:** Disconnection during download, corrupt packets
- **Multiple dives:** Verify sector offset calculations work correctly

### Visual Tests
- **Canvas rendering:** Compare graphs to Python matplotlib output
- **UI responsiveness:** Test on mobile browsers (Chrome Android)
- **Accessibility:** Ensure readable fonts, sufficient contrast

## 7. Rollout Plan

### Phase 1: Core MVP (Recommended for initial PR)
- Reuse BLE download code from branch
- Implement JS binary parser
- Implement Canvas renderer
- Add simple dive list UI
- Test with real device

### Phase 2: Polish
- Add loading animations
- Error handling and retry logic
- Export to raw JSON (backup option)
- Documentation updates

### Phase 3: Export Formats (Future)
- UDDF export
- Subsurface export
- CSV export for spreadsheets

## 8. Open Questions

1. **Branch strategy:** Revive `divelog_download_parse` or start fresh from `main`?
2. **Storage:** Should parsed dives be cached in memory during session?
3. **Large datasets:** Device might have 50+ dives - pagination needed?
4. **Mobile support:** Canvas rendering on small screens - responsive design?

## 9. Summary

This design provides a pure JavaScript, zero-dependency solution for dive log visualization. By porting the Python parsing logic to the browser and rendering with Canvas, users get immediate feedback without installing tools or saving files. The architecture maintains the project's philosophy of being a single, self-contained HTML file that works entirely offline after initial load.

The implementation reuses most of the BLE download code from the existing branch, adds ~300 lines of parsing logic, and ~150 lines of Canvas rendering code - keeping the total addition modest and maintainable.
