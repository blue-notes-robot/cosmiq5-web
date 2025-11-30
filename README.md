# Deepblu Cosmiq 5 - Reverse Engineering & Web Controller

## Project Overview
The manufacturer of the Deepblu Cosmiq 5 dive computer has ceased operations, removing the official app from app stores. This project preserves the functionality of the device by reverse-engineering the Bluetooth Low Energy (BLE) protocol and providing a web-based replacement controller.

**Current Version:** v27
**Status:** Full Read/Write Control established.

---

## 1. Hardware & Connectivity

* **Device Name:** `COSMIQ` or `Deepblu`
* **Service UUID:** `6e400001-b5a3-f393-e0a9-e50e24dcca9e` (Nordic UART)
* **Write Characteristic (TX):** `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
* **Notify Characteristic (RX):** `6e400003-b5a3-f393-e0a9-e50e24dcca9e`

### Connection Logic
Data is sent as **ASCII Text Strings** representing Hexadecimal values, terminated by a newline (`\n`).

---

## 2. The Protocol

### Packet Structure
`# [CMD] [CHECKSUM] [LENGTH] [PAYLOAD] \n`

* **`#`**: Header
* **`CMD`**: 2 chars (e.g., `2a`)
* **`CHECKSUM`**: 2 chars (Calculated)
* **`LENGTH`**: 2 chars (e.g., `02` or `04`)
* **`PAYLOAD`**: N chars (The value)

### Checksum Algorithms
The device uses **two different algorithms** depending on the specific setting.

**Algorithm A: Full Sum (Most Settings)**
Used for: Alarms, Air, PPO2, Timeout, Backlight.
> `Checksum = (TargetConstant - (Length + SumOfPayloadBytes)) & 0xFF`

**Algorithm B: Value Only (Legacy)**
Used for: Safety Factor.
> `Checksum = (TargetConstant - SumOfPayloadBytes) & 0xFF`

---

## 3. Command Reference

| Setting | CMD | Algorithm | Target (Dec/Hex) | Payload Logic |
| :--- | :--- | :--- | :--- | :--- |
| **Backlight** | `2e` | Full Sum | **210** (`0xD2`) | `02` + `0[Level]` (Levels 3-7 mapped to 1-5) |
| **Safety Factor** | `21` | **Val Only** | **219** (`0xDB`) | `04000[Val]` (0=Cons, 1=Norm, 2=Prog) |
| **Air Mix** | `22` | Full Sum | **222** (`0xDE`) | `02` + `[HexVal]` (e.g., 32% = `20`) |
| **PPO2** | `2d` | Full Sum | **211** (`0xD3`) | `02` + `[Val * 10]` (e.g., 1.4 = `0E`) |
| **Timeout** | `2a` | Full Sum | **214** (`0xD6`) | `04` + `000[Index]` (0=15s, 1=30s, 2=60s, 3=120s) |
| **Scuba Depth** | `27` | Full Sum | **217** (`0xD9`) | `04` + `Hex[(Meters * 100) + 1000]` |
| **Scuba Time** | `28` | Full Sum | **216** (`0xD8`) | `04` + `00[Minutes]` |
| **FD Time** | `26` | Full Sum | **218** (`0xDA`) | `04` + `14` + `Hex[(Sec - 30) / 5]` |
| **FD Depths** | `25` | Full Sum | **219** (`0xDB`) | See Freedive Logic below |

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

The device returns settings in bulk packets when queried.

| Query CMD | Returns | Response Parsing (Indices based on Hex String) |
| :--- | :--- | :--- |
| `#5f9f0200` | System | Char 10-11: **Backlight Level** |
| `#5ca20200` | Scuba 1 | Char 6-9: **Depth**<br>Char 10-13: **Timeout**<br>Char 14-15: **Air**<br>Char 16-17: **PPO2** |
| `#5ba30200` | Scuba 2 | Char 10-13: **Time Alarm**<br>Char 14-15: **Safety Factor**<br>Char 16-17: **Dive Mode** |
| `#5da10200` | Free 1 | **Depth Alarms 1-6** (2 chars each, starting index 6) |
| `#609e0200` | Free 2 | Char 6-7: **Max Time** |

---

## 5. How to Deploy
1.  Save the `index.html` file.
2.  Host it on any **HTTPS** server (GitHub Pages is recommended).
3.  Open on iPhone using **Bluefy** or Android using Chrome.
