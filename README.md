# Deepblu Cosmiq 5 - Reverse Engineering & Web Bluetooth Controller

## Project Overview
The manufacturer of the Deepblu Cosmiq 5 dive computer has ceased operations, removing the official app from app stores. This renders the device's settings changeless once the app is gone. This project documents the reverse-engineered Bluetooth Low Energy (BLE) protocol used by the device and provides a web-based replacement controller using the Web Bluetooth API.

## 1. Hardware & Connectivity

* **Device Name:** `COSMIQ` or `Deepblu`
* **Communication Protocol:** Bluetooth Low Energy (BLE)
* **Service UUID:** `6e400001-b5a3-f393-e0a9-e50e24dcca9e` (Nordic UART Service)
* **Write Characteristic (TX):** `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
* **Read Characteristic (RX):** `6e400003-b5a3-f393-e0a9-e50e24dcca9e`

### Connection Logic
The device uses the standard Nordic UART Service (NUS). No password or pairing PIN is required for connection. Data is sent as ASCII text strings terminated by a newline character (`\n` or `0x0A`).

---

## 2. Protocol Structure

The device accepts commands in a hexadecimal string format.
**Format:** `# [CMD] [CHECKSUM] [LENGTH] [PAYLOAD] \n`

* **`#` (0x23):** Start of command.
* **`CMD` (2 chars):** The Command ID (e.g., `2a` for Screen Settings).
* **`CHECKSUM` (2 chars):** A calculated hex byte used to validate the packet.
* **`LENGTH` (2 chars):** The length of the payload in bytes (e.g., `02` or `04`).
* **`PAYLOAD` (N chars):** The actual setting value (Hex).
* **`\n` (0x0A):** End of command.

### The Checksum Algorithm
The dive computer validates commands by checking if the **Sum of Payload Bytes** matches a specific **Target Constant** for that command.

**Formula:**
`Checksum = (TargetConstant - Sum(PayloadBytes)) & 0xFF`

**Example (Set Air to 21%):**
1.  **Command:** `22` (Air Mix)
2.  **Target Constant:** `0xDE` (222)
3.  **Payload:** `15` (Hex for 21%)
4.  **Math:** `0xDE - 0x15 = 0xC9`
5.  **Resulting Packet:** `#22c90215`

---

## 3. Command Reference (The Rosetta Stone)

### A. General Settings

| Setting | CMD ID | Payload Structure | Target Constant | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Screen Timeout** | `2a` | `04` + `[Seconds_Hex_4chars]` | `0xD2` (210) | Length is `04` |
| **Backlight** | `2e` | `[Level_Hex]` | N/A (Static) | See Static Table |
| **Units** | `23` | `01` (Metric) / `00` (Imperial) | N/A (Static) | See Static Table |
| **Date Format** | `24` | `00` (Current) / `01` (Last Dive) | N/A (Static) | See Static Table |
| **High Salinity** | `30` | `01` (On) / `00` (Off) | N/A (Static) | Length is `04` |

### B. Scuba Mode Settings

| Setting | CMD ID | Payload Structure | Target Constant | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Air Mix (O2)** | `22` | `[Percentage_Hex]` | `0xDE` (222) | Range: 21% - 40% |
| **Max PPO2** | `2d` | `[Value * 10]` | `0xD3` (211) | e.g., 1.4 = `0E` |
| **Safety Factor** | `21` | `00` (Cons), `01` (Norm), `02` (Prog) | N/A (Static) | Length is `04` |
| **Depth Alarm** | `27` | `[(Meters * 100) + 1000]` | `0xD9` (217) | Length is `04` |
| **Time Alarm** | `28` | `[Minutes_Hex]` | `0xD8` (216) | Length is `04` |

### C. Freedive Mode Settings

| Setting | CMD ID | Payload Structure | Target Constant | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Max Time** | `26` | `14` + `[(Sec - 30) / 5]` | `0xE4` (228) | Length is `04` |
| **Depth Alarm 1** | `25` | `0a` + `[Meters - 5]` | `0xDB` (219) | Length is `04` |
| **Depth Alarm 2** | `25` | `[Meters - 5]` + `13` | `0xDB` (219) | Length is `04` |
| **Depth Alarm 3** | `31` | `19` + `[Meters - 5]` | `0xCF` (207) | Length is `04` |
| **Depth Alarm 4** | `31` | `[Meters - 5]` + `14` | `0xCF` (207) | Length is `04` |
| **Depth Alarm 5** | `32` | `32` + `[Meters - 5]` | `0xCE` (206) | Length is `04` |
| **Depth Alarm 6** | `32` | `[Meters - 5]` + `1e` | `0xCE` (206) | Length is `04` |

---

## 4. Static Command Lookup
For settings that do not require dynamic calculation (toggles/modes), raw ASCII strings can be sent directly.

**Dive Modes:**
* **Scuba:** `#2bd30200`
* **Freedive:** `#2bd10202`
* **Gauge:** `#2bd20201`

**Safety Factor:**
* **Conservative:** `#21db040000`
* **Normal:** `#21da040001`
* **Progressive:** `#21d9040002`

**Backlight Brightness:**
* **Level 1 (Low):** `#2ecd0203`
* **Level 2:** `#2ecc0204`
* **Level 3:** `#2ecb0205`
* **Level 4:** `#2eca0206`
* **Level 5 (Max):** `#2ec90207`

---

## 5. Implementation Guide (JavaScript)

To implement a controller, you must use the **Web Bluetooth API** (available in Chrome, Edge, and Bluefy on iOS).

### Packet Builder Function
The following JavaScript function correctly calculates the checksum and sends the command.

```javascript
async function sendCommand(prefix, targetSum, valHex, lenHex = "02") {
    // 1. Calculate Sum of Payload Bytes
    // Note: This must include the Length Byte and every byte of the Value
    let payloadBytes = [];
    payloadBytes.push(parseInt(lenHex, 16));
    
    // Split valHex string into byte chunks (e.g. "05dc" -> [0x05, 0xdc])
    for (let i = 0; i < valHex.length; i += 2) {
        payloadBytes.push(parseInt(valHex.substr(i, 2), 16));
    }

    let sum = payloadBytes.reduce((a, b) => a + b, 0);

    // 2. Calculate Checksum
    let checkDec = (targetSum - sum) & 0xFF; // Wrap to 8-bit
    let checkHex = checkDec.toString(16).padStart(2, '0');

    // 3. Construct String
    let command = `#${prefix}${checkHex}${lenHex}${valHex}\n`;

    // 4. Send
    let encoder = new TextEncoder();
    await characteristic.writeValue(encoder.encode(command));
}

Known Gotchas
Text vs Binary: The device expects the characters of the hex string (ASCII), not raw binary values. Do not use Uint8Array([0x23, 0x2A...]) unless you are encoding the ASCII values of those characters.

Length Byte: Most commands use a length of 02 (2 chars/1 byte). However, Screen Timeout, Scuba Depth, Time Alarm, and all Freedive settings use a length of 04 (4 chars/2 bytes).

Freedive Logic: Freedive depth alarms use a "Sliding Window" logic. The payload is [IndexByte] [ValueByte], but for even-numbered alarms, the order is swapped to [ValueByte] [IndexByte]. The TargetConstant remains the same for the pair.