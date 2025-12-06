# **Deepblu Android App Decompilation Guide**

**Goal:** Identify the Bluetooth command sequence required to download dive logs from the Cosmiq 5/Cosmiq+ Gen 5 and decode the binary format.

## **1\. Tools Required**

* **JADX-GUI:** For decompiling and viewing Java source code.  
* **APK File:** Deepblu App (v3.4.20 or older).

## **2\. Key Search Terms**

Use Ctrl \+ Shift \+ F in JADX to search for these strings:

* **UUIDs:** 6e400001 (Service), 6e400002 (Write), 6e400003 (Notify).  
* **Specific Variable Names (Found\!):**  
  * COSMIQ\_CUSTOM\_CHARACTERISTIC\_CONFIG\_WRITE (Right-click \-\> "Find Usage" on this is your best bet\!)  
  * COSMIQ\_CUSTOM\_CHARACTERISTIC\_CONFIG\_NOTIFY  
* **Protocol Markers:** "\#" (Packet start), "\\n" (Packet end).  
* **Keywords:** Sync, Download, DiveLog, History, Firmware.  
* **Hex Constants:** Look for switch statements switching on byte values like 0x5F, 0x5C, 0x20, etc.

## **3\. What to Look For**

### **A. The "Start Download" Command**

We need to find the command sent to the device to trigger the log dump.

* It is likely a short hex string sent to the Write Characteristic.  
* Look for references to COSMIQ\_CUSTOM\_CHARACTERISTIC\_CONFIG\_WRITE.  
* Check if there is a command byte we haven't used yet (e.g., 0xBB, 0xAA, 0x44).  
* **New Target:** com.deepblu.library.ble.connect.cmdHandler.BleCommandTranslator. Look for decimalValueToBlePacket.

### **B. The Data Parser**

We need to find the code that handles incoming data on the Notify Characteristic.

* Look for references to COSMIQ\_CUSTOM\_CHARACTERISTIC\_CONFIG\_NOTIFY.  
* Look for onCharacteristicChanged.  
* Look for a loop that accumulates bytes into a buffer (ByteArrayOutputStream or similar).  
* **Crucial:** Find the class that parses this buffer into Depth, Time, and Temperature. This will give us the binary format structure (e.g., "Bytes 0-1 \= Depth in cm", "Byte 2 \= Temp").

### **C. The Login Bypass (Optional but helpful)**

If we can patch the app to skip the login screen, we can use the app itself to sniff the traffic.

* Look for isLoggedIn() or SessionManager.  
* Check SharedPreferences keys like auth\_token or user\_id.

## **4\. Reporting Back**

When you find relevant code snippets (especially the Bluetooth handling logic), paste them here. We can analyze the logic flow together to reconstruct the download protocol.

### **5\. Identified Classes (Progress)**

* com.deepblu.library.ble.connect.attribute.CosmiqUuidAttributes: Contains the UUID definitions.  
* com.deepblu.library.ble.connect.cmdHandler.CosmiqCmdHandler: Handles writing to the device.  
* com.deepblu.library.ble.connect.cmdHandler.BleCommandTranslator: Translates decimal values to BLE packets.  
* com.deepblu.library.ble.connect.cmdHandler.CosmiqRecordsDownload: Handles log downloading logic.  
  * ID\_CMD\_WRITE\_DOWNLOAD\_HEADER \= 65 (0x41)  
  * ID\_CMD\_WRITE\_DOWNLOAD\_LOG \= 67 (0x43)  
  * ID\_CMD\_DOWNLOAD\_HEADER \= 66 (0x42)  
  * ID\_CMD\_DOWNLOAD\_LOG \= 68 (0x44)