# **Deepblu Cosmiq 5 \- Technical Specifications**

This document details the reverse-engineered Bluetooth Low Energy (BLE) protocol for the Deepblu Cosmiq 5\. These findings were empirically derived through packet sniffing and "brute force" analysis.

## **1\. Connection Details**

* **Service UUID:** 6e400001-b5a3-f393-e0a9-e50e24dcca9e (Nordic UART)  
* **Write Characteristic (TX):** 6e400002-...  
* **Notify Characteristic (RX):** 6e400003-...

### **Packet Structure**

All data is sent as ASCII Hex Strings, terminated by a newline (0x0A).  
Format: \# \[CMD\] \[CHECKSUM\] \[LENGTH\] \[PAYLOAD\] \\n

## **2\. Checksum Algorithm**

The device uses a specific subtraction algorithm to validate packets.

**Formula:** Checksum \= (TargetConstant \- (Length \+ SumOfPayloadBytes)) & 0xFF

*Note: For the Safety Factor setting, the Length byte is 04, but the payload logic requires careful padding.*

## **3\. Command Reference (Write)**

| Setting | CMD | Target | Length | Payload Structure | Notes |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **Safety Factor** | 21 | **223** | 04 | 00 00 00 0\[Val\] | Val: 0=Consv, 1=Norm, 2=Prog |
| **Air Mix** | 22 | **222** | 02 | 00 \[HexVal\] | Val is O2 % (e.g., 32 \= 0x20) |
| **Units** | 23 | **221** | 02 | 00 0\[Val\] | 0=Imperial, 1=Metric |
| **Date Format** | 24 | **220** | 02 | 00 0\[Val\] | 0=DD/MM, 1=Last Dive Date |
| **FD Depth (1)** | 25 | **219** | 04 | 0a \[Val-5\] | "Sliding Window" Logic |
| **FD Depth (2)** | 25 | **219** | 04 | \[Val-5\] 13 | Shares CMD with Alarm 1 |
| **FD Time** | 26 | **218** | 04 | 14 \[Seconds-30\]/5 |  |
| **Scuba Depth** | 27 | **217** | 04 | Hex\[(Meters\*100)+1000\] |  |
| **Scuba Time** | 28 | **216** | 04 | 00 \[Minutes\] |  |
| **Timeout** | 2a | **214** | 04 | 00 00 00 0\[Idx\] | Idx: 0=5s ... 6=2min |
| **Mode** | 2b | **N/A** | N/A | Static Packets | See Source Code (Packet varies by mode) |
| **PPO2** | 2d | **211** | 02 | 00 \[Val\*10\] | e.g., 1.4 \= 0E |
| **Backlight/Eco** | 2e | **210** | 02 | 00 \[Bitmask\] | Lower 4 bits=Level, Bit 4=Eco Off |
| **Environment** | 30 | **208** | 04 | 00 00 00 0\[Val\] | 0=Norm, 1=Salt, 2=High Alt |
| **FD Depth (3)** | 31 | **207** | 04 | 19 \[Val-5\] |  |
| **FD Depth (4)** | 31 | **207** | 04 | \[Val-5\] 14 |  |
| **FD Depth (5)** | 32 | **206** | 04 | 32 \[Val-5\] |  |
| **FD Depth (6)** | 32 | **206** | 04 | \[Val-5\] 1e | **Write Only** (Not readable via $60) |

## **4\. Memory Map (Read)**

Reading is performed by sending query commands. The response contains current settings at specific byte offsets.

| Query CMD | Response | Byte 0 | Byte 1 | Byte 2 | Byte 3 | Byte 4 | Byte 5 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **\#5F...** | $5F | \- | Env Mode | Backlight/Eco | \- | \- | \- |
| **\#5C...** | $5C | Depth (Hi) | Depth (Lo) | Timeout | \- | Air Mix | **Default Mode** |
| **\#5B...** | $5B | \- | Time Alarm | \- | Timeout | Date Mode | Units |
| **\#5D...** | $5D | FD Alarm 1 | FD Alarm 2 | FD Alarm 3 | FD Alarm 4 | **Safety** | **PPO2** |
| **\#60...** | $60 | FD Time | FD Alarm 5 | FD Alarm 6 | \- | \- | \- |

*Note: Offsets above refer to the payload bytes (after the header).*

## **5\. Quirks & Anomalies**

* **PPO2 Location:** PPO2 is strangely stored in the 6th byte of the Freedive packet ($5D), displacing what would logically be the 6th Freedive Alarm.  
* **FD Alarm 6:** Because PPO2 occupies its slot in the read packet ($5D), Freedive Alarm 6 cannot be read using standard queries. However, it can be successfully written to using Command 32 and appears in packet $60 byte 2\.  
* **Safety Factor Index:** Uses 0=Conservative, 1=Normal, 2=Progressive.