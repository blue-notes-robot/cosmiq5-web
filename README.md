# **Deepblu Cosmiq 5 \- Web Controller**

## **🌊 Project Overview**

This project provides a web-based controller for the **Deepblu Cosmiq 5** dive computer. Since the official app has been discontinued, this tool allows you to modify all settings on your device directly from a web browser using Bluetooth Low Energy (BLE).

It runs entirely in your browser (client-side)—no data is sent to any external server.

🤖 Vibe Coding Disclaimer  
This entire project was "vibecoded" with Gemini Pro 3\. The code was generated through an iterative conversation between a human operator (providing logs and testing) and the AI (analyzing patterns and writing code). It represents a collaborative effort to preserve legacy hardware through modern AI assistance.

## **🚀 How to Use**

### **1\. Requirements**

* **Hardware:** Deepblu Cosmiq 5 Dive Computer.  
* **Browser:** You need a browser that supports Web Bluetooth.  
  * **PC/Mac/Android:** Google Chrome, Edge, or Opera.  
  * **iOS (iPhone/iPad):** Safari **does not** support this. You must download a dedicated WebBLE browser like **Bluefy** from the App Store.

### **2\. Connection Steps**

1. Open the [Hosted Web Page](https://blue-notes-robot.github.io/cosmiq5-web/) (or your local index.html).  
2. Turn on your Cosmiq 5 and ensure Bluetooth is active.  
3. Click the big blue **"Connect & Sync"** button.  
4. Select your device (usually named COSMIQ or Deepblu) from the list.  
5. Wait for the green "Connected" status. The app will automatically read your current settings.

### **3\. Features**

* **General:** Set Time/Date format, Syc Time, Units (Metric/Imperial), Backlight intensity, Screen Timeout, and Power-Saving (Eco) mode.  
* **Device info:** Model, firmware version and the number of dives in the logbook are shown after connecting. Settings the connected model/firmware does not support (per the Deepblu app) are locked; freedive alarms are only written on the Cosmiq 5.  
* **Environment:** Configure High Altitude mode and/or High Salinity mode (Advanced).  
* **Scuba:** Configure Air Mix (Nitrox), PPO2, Depth Alarms, Time Alarms, and Safety Factor.  
* **Freedive:** Configure Max Time and 6 distinct Depth Alarms.  
* **Logbook:** Download all dive logs (header + depth/temperature profile) with read-only commands and export them as **Subsurface XML** (File → Open in Subsurface), CSV or raw JSON. Tap a dive to see its depth/temperature profile. The logbook is saved in your browser, so it can be viewed and exported later without connecting, and later downloads only read new profiles.  
* **Diagnostics:** A "Byte Hunter" tab allows you to see the raw data packets coming from the device.

### **4\. Offline use (e.g. on a liveaboard)**

The page has no external dependencies, and Bluetooth talks to the dive computer directly, so no internet is needed once the page is open.

* **PC / Mac / Android (Chrome or Edge):** before the trip, open the [hosted page](https://blue-notes-robot.github.io/cosmiq5-web/) once while online.
  * The log at the bottom shows *"Offline ready"* once the page is cached.
  * It then opens without internet at the same address. Keep the trailing `/`: `…/cosmiq5-web/`.
  * You can also *Install* it (menu → *Install app* / *Add to Home screen*) to get an app icon.
  * Updates are picked up automatically the next time you are online.
* **iPhone (Bluefy):** iOS does not allow Bluefy to cache web pages for offline use.
  * Open the page before you lose internet and **keep the tab open**; once loaded, everything, including Bluetooth and the logbook download, works offline.
  * If iOS closes the tab, it can only be reopened with internet. The dive computer keeps its logs, so you can also download them after the trip.
* **Local copy:** you can also download `index.html` and `logbook.js` into the same folder and open `index.html` in Chrome or Edge. This works offline without caching.
  * The saved logbook is stored per address, so logs saved in a local copy do not appear on the hosted page (and vice versa).
* Downloaded dive logs are saved in the browser, so **View saved logbook** shows and exports them later, also without the dive computer.

### **5\. About the logbook (firmware bug)**

The Cosmiq firmware writes each dive profile to flash sector `start_sector % 256`, but reads it back from the unmodified `start_sector` stored in the dive header. Once a logbook passes sector 256:

* newer dives read back as erased flash (`0xFFFF`, which Subsurface/libdivecomputer shows as 645 m / 6553 °C, see [subsurface#3548](https://github.com/subsurface/subsurface/issues/3548)),
* and they physically overwrite the oldest dives.

The Logbook tab works around this: a newer dive's profile is read through the old dive whose slot it overwrote. Profiles that no header points to cannot be read with the known commands; those dives are still exported with date, duration, max depth and temperature, and the table shows the status of every dive. Each profile is downloaded twice and only accepted when both copies match.

`logbook.js` holds the protocol and export code (no build step; deploy it next to `index.html`). `node test/logbook.test.js <dump dir>` runs it against a simulated device built from captured headers/profiles.

## **⚠️ Important Safety Warning**

**This software is UNOFFICIAL and experimental.**

Diving involves significant risks, including decompression sickness, oxygen toxicity, and drowning.

1. **ALWAYS** verify your settings on the physical device screen before entering the water.  
2. **NEVER** rely solely on this software to configure life-safety parameters.  
3. The authors and the AI assistant accept **NO RESPONSIBILITY** for malfunctions, incorrect settings, or any safety incidents resulting from the use of this tool.

*Dive safe. Always carry a backup.*
