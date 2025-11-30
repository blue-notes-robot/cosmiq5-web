# Deepblu Cosmiq 5 - Reverse Engineering & Web Controller

## Project Overview
The manufacturer of the Deepblu Cosmiq 5 dive computer has ceased operations, removing the official app from app stores. This project preserves the functionality of the device by reverse-engineering the Bluetooth Low Energy (BLE) protocol and providing a completely client-side web controller.

**Current Version:** v31 (Stable)
**Status:** Full Read/Write Control established for all settings.

> **⚠️ DISCLAIMER:** This software is unofficial. Diving involves risk. Always verify your settings on the physical device screen before diving. The authors are not responsible for any malfunctions or safety issues.

---

## 1. Hardware & Connectivity

* **Device Name:** `COSMIQ` or `Deepblu`
* **Service UUID:** `6e400001-b5a3-f393-e0a9-e50e24dcca9e` (Nordic UART Service)
* **Write Characteristic (TX):** `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
* **Notify Characteristic (RX):** `6e400003-b5a3-f393-e0a9-e50e24dcca9e`

### Data Format
The device communicates using **ASCII Text Strings**. It does not use raw binary byte arrays.
* **Example:** To send the byte `0x0A`, you must send the string `"0A"`.
* **Termination:** All commands must end with a newline character (`\n` or `0x0A`).

---

## 2. The Protocol

### Packet Structure
`# [CMD] [CHECKSUM] [LENGTH] [PAYLOAD] \n`

* **`#`**: Header (ASCII `0x23`)
* **`CMD`**: 2 chars (e.g., `2a`)
* **`CHECKSUM`**: 2 chars (Calculated)
* **`LENGTH`**: 2 chars (e.g., `02` or `04`)
* **`PAYLOAD`**: N chars (The value)

### Checksum Algorithms
The device uses two specific algorithms depending on the setting type.

**Algorithm A: Full Sum (Standard)**
Used for almost all settings (Alarms, Air, PPO2, Timeout, Backlight).
> `Checksum = (TargetConstant - (Length + SumOfPayloadBytes)) & 0xFF`

**Algorithm B: Value Sum (Legacy)**
Used ONLY for Safety Factor.
> `Checksum = (TargetConstant - SumOfPayloadBytes) & 0xFF`

---

## 3. Command Reference (The Rosetta Stone)

These constants have been empirically verified.

| Setting | CMD | Algorithm | Target (Dec) | Target (Hex) | Payload Logic |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Backlight** | `2e` | Full Sum | **210** | `D2` | `02` + `0[Level]` (3-7 mapped to 1-5) |
| **Safety Factor** | `21` | **Val Sum** | **219** | `DB` | `04000[Val]` (0=Cons, 1=Norm, 2=Prog) |
| **Air Mix** | `22` | Full Sum | **222** | `DE` | `02` + `[HexVal]` (e.g., 32% = `20`) |
| **PPO2** | `2d` | Full Sum | **211** | `D3` | `02` + `[Val * 10]` (e.g., 1.4 = `0E`) |
| **Timeout** | `2a` | Full Sum | **214** | `D6` | `04` + `000[Index]` (0=15s, 1=30s, 2=60s, 3=120s) |
| **Scuba Depth** | `27` | Full Sum | **217** | `D9` | `04` + `Hex[(Meters * 100) + 1000]` |
| **Scuba Time** | `28` | Full Sum | **216** | `D8` | `04` + `00[Minutes]` |
| **FD Time** | `26` | Full Sum | **218** | `DA` | `04` + `14` + `Hex[(Sec - 30) / 5]` |
| **FD Depths** | `25` | Full Sum | **219** | `DB` | See Freedive Logic below |
| **Units** | `23` | Full Sum | **221** | `DD` | `02` + `0[Val]` (1=Metric, 0=Imperial) |
| **Date Format** | `24` | Full Sum | **220** | `DC` | `02` + `0[Val]` (0=DD/MM, 1=Last Dive) |

### Freedive Depth Alarm Logic
Freedive depth alarms use a "sliding window" for the payload structure.
* **Alarm 1:** `0a` + `[Meters - 5]`
* **Alarm 2:** `[Meters - 5]` + `13`
* **Alarm 3:** `19` + `[Meters - 5]` -> Target **207** (`0xCF`)
* **Alarm 4:** `[Meters - 5]` + `14` -> Target **207** (`0xCF`)
* **Alarm 5:** `32` + `[Meters - 5]` -> Target **206** (`0xCE`)
* **Alarm 6:** `[Meters - 5]` + `1e` -> Target **206** (`0xCE`)

---

## 4. Reading Settings (Memory Map)

To read settings, send the query commands. The device responds with a packet starting with `$` (ASCII `0x24`).
*Note: Indices below refer to the character position in the raw Hex string.*

**1. Query `#5f9f0200` (System)**
* **Returns:** `$5F...`
* **Char 10-11:** Backlight Level (Raw 3-7).

**2. Query `#5ca20200` (Scuba Config 1)**
* **Returns:** `$5C...`
* **Char 6-9:** Depth Alarm (Formula: `(Val - 1000) / 100`)
* **Char 10-13:** Screen Timeout Index (0-3)
* **Char 14-15:** Air Mix (%)
* **Char 16-17:** PPO2 (Raw value, e.g., `0E`=1.4)

**3. Query `#5ba30200` (Scuba Config 2)**
* **Returns:** `$5B...`
* **Char 10-13:** Time Alarm (Minutes)
* **Char 14-15:** Safety Factor (0-2)
* **Char 16-17:** Default Mode (0=Scuba, 1=Gauge, 2=Free)

**4. Query `#5da10200` (Freedive Depths)**
* **Returns:** `$5D...`
* Contains 6 alarms, 2 chars each, starting at Index 6.
* Formula: `Val + 5` = Meters.

**5. Query `#609e0200` (Freedive Time)**
* **Returns:** `$60...`
* **Char 6-7:** Time Factor.
* Formula: `(Val * 5) + 30` = Seconds.

---

## 5. Development Setup

1.  Clone this repository.
2.  Open `index.html` in a text editor.
3.  Deploy to **GitHub Pages** or any local server supporting HTTPS (Required for Web Bluetooth API).
4.  Access via a supported browser:
    * **iOS:** [Bluefy](https://apps.apple.com/us/app/bluefy-web-ble-browser/id1492822055) (Required, Safari does not support WebBLE).
    * **Android:** Chrome / Edge.
    * **Desktop:** Chrome / Edge.
