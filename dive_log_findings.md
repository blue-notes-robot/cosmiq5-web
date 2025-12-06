# **Deepblu Cosmiq 5 \- Reverse Engineering Findings**

## **1\. Log Download Protocol**

The **Deepblu Cosmiq 5** uses a request-response mechanism over Bluetooth Low Energy (BLE) to transfer dive logs. The communication consists of sending specific command packets and receiving data in chunks.

* **Command Structure:** Requests are sent as ASCII hex strings in the format: \# \[CMD\] \[CKSUM\] \[LEN\] \[PAYLOAD\].  
* **Checksum Algorithm:** The checksum target is calculated as 256 \- CommandID.  
  * **Header Request:** Sending \#41BD0200 (Command 0x41, Checksum 0xBD) requests the dive log header.  
  * **Body Request:** Sending \#43BB0200 (Command 0x43, Checksum 0xBB) requests the dive log body (samples).  
* **Data Transfer:**  
  * **Header Response (Cmd 0x42):** The device responds with packets starting with 42\. These contain metadata about the dives (e.g., dive count, pointers).  
  * **Body Response (Cmd 0x44):** The device responds with a stream of packets starting with 44\. These contain the actual dive profile data.  
  * **Packet Payload:** Each BLE packet carries 12 characters of payload, representing **6 bytes** of binary data.  
  * **Transfer Flow:** The app must first request the header, receive all header packets (typically 6), and then request the body.

## **2\. App Decompilation Insights**

Decompiling the Android app provided the exact logic for constructing commands and handling responses, confirming the "blind" guesses made during packet sniffing.

* **Key Classes:**  
  * CosmiqUuidAttributes: Confirmed the Service and Characteristic UUIDs.  
  * BleCommandTranslator: Revealed the packet construction logic and checksum verification method (256 \- sum % 256).  
  * CosmiqRecordsDownload: Explicitly defined the command IDs for downloading logs (65/0x41 for Write Header, 67/0x43 for Write Body) and the expected response IDs (66/0x42 and 68/0x44).  
* **Time Sync:** The decompilation also revealed the command 0x20 (decimal 32\) for syncing the system time, using a payload of YYMMDDHHMMSS.

## **3\. Dive Log Parsing**

Analyzing the extracted binary dump (cosmiq\_dump\_...txt) revealed the structure of the dive data.

* **Data Blocks:** The raw hex dump contains distinct blocks of data separated by empty padding (FF...FF). The Python analysis script identified **8 distinct blocks**, corresponding to individual dives.  
* **Sample Format:** The dive profile data inside the body blocks follows a specific pattern:  
  * **Markers:** Samples are often prefixed by markers like C2 00 or C3 00\.  
  * **Depth Encoding:** The depth is stored as a 16-bit little-endian integer. The value corresponds to depth in centimeters or tens of centimeters (e.g., a raw value of 1242 corresponds to 12.42m).  
  * **Structure:** The data stream is a sequence of \[Marker\] \[Value\] pairs, allowing for the reconstruction of a depth-over-time profile.

## **Summary**

By combining packet sniffing, static analysis of the app's code, and binary data analysis, we have successfully:

1. Mapped the entire configuration protocol.  
2. Identified the command sequence to trigger a log dump.  
3. Extracted valid binary dive logs from the device memory.  
4. Decoded the basic structure of the dive profile samples (Depth/Time).

This provides a complete picture of how the Cosmiq 5 communicates and stores data, enabling full control and data retrieval without the official app.
