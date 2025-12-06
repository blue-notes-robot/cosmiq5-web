import glob
import os
import struct
from pathlib import Path

cur_dir = Path(__file__).parent
data_dir = cur_dir / "extracted_dives"


def hexdump(data, length=16):
    """Creates a hexdump-style output for a byte string."""
    lines = []
    for i in range(0, len(data), length):
        chunk = data[i : i + length]
        hex_part = " ".join(f"{b:02x}" for b in chunk)
        ascii_part = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        lines.append(f"{i:04x}  {hex_part:<{length * 3}}  |{ascii_part}|")
    return "\n".join(lines)


def parse_samples_from_block(data):
    """
    Parses a block of binary data to extract dive samples based on the
    4-byte marker/value structure.
    """
    samples = []
    i = 0
    # Markers seem to be in the range c0-cf, plus 'be'
    valid_markers = [
        0xC0, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xCB, 0xCC, 0xCD, 0xCE, 0xCF,
        0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF,
    ]

    while i < len(data) - 4:
        # A sample is 4 bytes: [Marker] [0x00] [Val_L] [Val_H]
        marker = data[i]
        
        # The second byte is almost always 0x00, let's enforce that
        if data[i + 1] == 0x00 and marker in valid_markers:
            val_bytes = data[i + 2 : i + 4]
            val = struct.unpack("<H", val_bytes)[0]  # Little-endian unsigned short

            # Heuristic for depth: values are in cm, so divide by 100 for meters.
            # Max depth of a dive computer is ~100m, so raw values shouldn't exceed 10000.
            # Let's filter out nonsensical values.
            if 0 < val < 20000: # 200m max, seems reasonable
                samples.append(
                    {
                        "offset": i,
                        "marker": f"0x{marker:02x}",
                        "raw_val": val,
                        "depth_m": val / 100.0,
                    }
                )
            # Move to the next potential sample
            i += 4
        else:
            # If it's not a valid sample, move to the next byte
            i += 1
            
    return samples


def analyze_log_blocks():
    """
    Reads binary log blocks, performs analysis, and prints parsed samples.
    """
    bin_files = glob.glob(str(data_dir / "*.bin"))

    if not bin_files:
        print("No .bin files found in 'data' folder. Run the analyzer first.")
        return

    print(f"Found {len(bin_files)} log blocks. Analyzing...")

    for filename in sorted(bin_files):
        print(f"\n--- Analyzing {os.path.basename(filename)} ---")

        with open(filename, "rb") as f:
            data = f.read()

        print(f"File Size: {len(data)} bytes")
        
        # Print hexdump for manual verification
        # print(hexdump(data))

        samples = parse_samples_from_block(data)

        if samples:
            print(f"Found {len(samples)} samples.")
            # Print first 5 and last 5 samples for brevity
            if len(samples) > 10:
                print("First 5 samples:")
                for s in samples[:5]:
                    print(f"  [{s['offset']:04x}] Marker: {s['marker']}, Raw: {s['raw_val']:<5}, Depth: {s['depth_m']:.2f}m")
                print("Last 5 samples:")
                for s in samples[-5:]:
                    print(f"  [{s['offset']:04x}] Marker: {s['marker']}, Raw: {s['raw_val']:<5}, Depth: {s['depth_m']:.2f}m")
            else:
                 for s in samples:
                    print(f"  [{s['offset']:04x}] Marker: {s['marker']}, Raw: {s['raw_val']:<5}, Depth: {s['depth_m']:.2f}m")
        else:
            print("No valid samples found in this block.")

        print("--- End of Analysis ---")


if __name__ == "__main__":
    analyze_log_blocks()
