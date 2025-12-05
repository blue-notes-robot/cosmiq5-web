# **Deepblu Cosmiq 5 \- Technical Specifications**

This document details the reverse-engineered Bluetooth Low Energy (BLE) protocol for the Deepblu Cosmiq 5\. These findings were derived empirically through packet sniffing and "brute force" analysis.

## **1\. Connection Details**

* **Service UUID:** 6e400001-b5a3-f393-e0a9-e50e24dcca9e (Nordic UART Service)  
* **Write Characteristic:** 6e400002-b5a3-f393-e0a9-e50e24dcca9e  
* **Notify Characteristic:** 6e400003-b5a3-f393-e0a9-e50e24dcca9e

### **Packet Structure**

Data is transferred as ASCII Hex Strings, terminated by a newline (0x0A).  
\# \[CMD\] \[CHECKSUM\] \[LENGTH\] \[PAYLOAD\] \\n  
**Checksum Algorithm (Algorithm A):**

Checksum \= (TargetConstant \- (Length \+ SumOfPayloadBytes)) & 0xFF

## **2\. Command Reference (Write)**

| Setting | CMD | Target | Length | Payload Structure | Notes |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **Backlight / Eco** | 2E | **210** | 02 | 00 \[Bitmask\] | Lower 4 bits \= Level (1-5). Bit 4 \= Eco Off. |
| **Screen Timeout** | 2A | **214** | 04 | 00 00 00 0\[Sec\] | Value is raw seconds (e.g. 1E \= 30s). |
| **Units** | 23 | **221** | 02 | 00 0\[Val\] | 0=Imperial, 1=Metric. |
| **Date Format** | 24 | **220** | 02 | 00 0\[Val\] | 0=Current Date, 1=Last Dive. |
| **Environment** | 30 | **208** | 04 | 00 00 00 0\[Val\] | 0=Normal, 1=Salinity, 2=Altitude. |
| **Safety Factor** | 21 | **223** | 04 | 00 00 00 0\[Val\] | 0=Conservative, 1=Normal, 2=Progressive. |
| **Air Mix** | 22 | **222** | 02 | 00 \[HexVal\] | Val \= Oxygen % (e.g. 32 \= 0x20). |
| **PPO2** | 2D | **211** | 02 | 00 \[Val\*10\] | e.g. 1.4 \= 0E. |
| **Scuba Depth** | 27 | **217** | 04 | Hex\[(m\*100)+1000\] |  |
| **Scuba Time** | 28 | **216** | 04 | 00 \[Minutes\] |  |
| **FD Time** | 26 | **218** | 04 | 14 \[Sec-30\]/5 |  |
| **FD Alarms 1 & 2** | 25 | **219** | 04 | \[A2\] \[A1\] | Values are (Depth \- 5). Even alarm first. |
| **FD Alarms 3 & 4** | 31 | **207** | 04 | \[A4\] \[A3\] | Values are (Depth \- 5). Even alarm first. |
| **FD Alarms 5 & 6** | 32 | **206** | 04 | \[A6\] \[A5\] | Values are (Depth \- 5). Even alarm first. |

### **Freedive Alarm Logic (Crucial)**

Freedive depth alarms are stored in pairs. To write one alarm, you must read the current value of its partner and send both back in the correct order: \[Even Alarm Byte\] \[Odd Alarm Byte\].

## **3\. Memory Map (Read)**

Configuration is read by sending query commands. The device responds with packets containing current values at specific byte offsets (0-indexed relative to the payload).

| Query CMD | Response Packet | Data Layout |
| :---- | :---- | :---- |
| **\#5F9F0200** | $5F... | **Byte 1:** Env Mode (0/1/2) **Byte 2:** Backlight & Eco Bitmask |
| **\#5CA20200** | $5C... | **Byte 0-1:** Scuba Depth Alarm **Byte 2-3:** Scuba Time Alarm **Byte 4:** Air Mix **Byte 5:** Default Mode (0=Scuba, 1=Gauge, 2=Free) |
| **\#5BA30200** | $5B... | **Byte 3:** Screen Timeout (Raw Seconds) **Byte 4:** Date Format **Byte 5:** Units |
| **\#5DA10200** | $5D... | **Byte 0:** FD Alarm 2 **Byte 1:** FD Alarm 1 **Byte 3:** FD Max Time **Byte 4:** Safety Factor **Byte 5:** PPO2 |
| **\#609E0200** | $60... | **Byte 0:** FD Alarm 4 **Byte 1:** FD Alarm 3 **Byte 2:** FD Alarm 6 **Byte 3:** FD Alarm 5 |

*Note: Offsets above refer to the payload bytes (after the 6-character header).*

## **5\. Quirks & Anomalies**

* **Split Freedive Data:** Freedive Alarms are split across packets $5D (Alarms 1-2) and $60 (Alarms 3-6).  
* **Byte Order:** In Freedive Alarm packets (both Read and Write), the **Even** numbered alarm always occupies the first byte, and the **Odd** numbered alarm occupies the second byte.  
* **PPO2 Location:** PPO2 is stored in the Freedive packet $5D, confusingly mixed with depth alarms and safety settings.
