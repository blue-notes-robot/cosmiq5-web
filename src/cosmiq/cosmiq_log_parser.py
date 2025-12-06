import glob
import os
import struct
from pathlib import Path

cur_dir = Path(__file__).parent
data_dir = cur_dir / "data"


def parse_logs():
    bin_files = glob.glob(str(data_dir / "*.bin"))

    if not bin_files:
        print("No .bin files found in 'data' folder. Run the analyzer first.")
        return

    print(f"Found {len(bin_files)} log blocks. Analyzing...")

    for filename in sorted(bin_files):
        print(f"\n--- Analyzing {os.path.basename(filename)} ---")

        with open(filename, "rb") as f:
            data = f.read()

        # Try to find meaningful data
        # Deepblu logs often have a 0xC2/0xC3 marker for samples.

        # Hex view of start
        print(f"Header Hex: {data[:16].hex().upper()}")

        # Attempt to decode samples
        # Hypothesis: 2 bytes depth, 2 bytes temp? Or 4 bytes per sample?
        # Your dump had: C2 00 DA 04 C2 00 28 05 ...

        samples = []
        i = 0
        while i < len(data) - 4:
            # Look for C2 00 or C3 00 markers
            marker = data[i : i + 2]

            if marker == b"\xc2\x00" or marker == b"\xc3\x00" or marker == b"\xc4\x00":
                # Valid sample start?
                # Next 2 bytes: Value?
                val_bytes = data[i + 2 : i + 4]
                val = struct.unpack("<H", val_bytes)[0]  # Little endian unsigned short

                # Heuristic: Depth is usually in 10cm or cm units
                # 0x04DA = 1242. 12.4m?
                # 0x0528 = 1320. 13.2m?

                samples.append(
                    {
                        "offset": i,
                        "marker": marker.hex(),
                        "raw_val": val,
                        "depth_m": val / 100.0,  # Guessing units
                    }
                )
                i += 4  # Move past this block
            else:
                i += 1  # Scan forward

        print(f"Found {len(samples)} potential samples.")
        if len(samples) > 0:
            print("First 5 samples:")
            for s in samples[:5]:
                print(
                    f"  [{s['offset']}] {s['marker']} -> Raw: {s['raw_val']} (Approx {s['depth_m']}m?)"
                )


if __name__ == "__main__":
    parse_logs()
