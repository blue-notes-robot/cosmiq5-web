import glob
import os
import struct
from pathlib import Path
import matplotlib.pyplot as plt

cur_dir = Path(__file__).parent
data_dir = cur_dir / "extracted_dives" # Updated directory
plots_dir = cur_dir / "plots"


def parse_samples_from_block(data):
    """
    Parses a block of binary data to extract dive samples based on the
    4-byte marker/value structure.
    """
    samples = []
    i = 0
    valid_markers = [
        0xC0, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xCB, 0xCC, 0xCD, 0xCE, 0xCF,
        0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF,
    ]

    while i < len(data) - 4:
        marker = data[i]
        if data[i + 1] == 0x00 and marker in valid_markers:
            val_bytes = data[i + 2 : i + 4]
            val = struct.unpack("<H", val_bytes)[0]
            if 0 < val < 20000:
                samples.append({"depth_m": val / 100.0})
            i += 4
        else:
            i += 1
    return samples


def read_metadata(meta_filename):
    """Reads the .meta file and returns the LogPeriod."""
    log_period = 1 # Default to 1 second if not found
    try:
        with open(meta_filename, 'r') as f:
            for line in f:
                if line.startswith("LogPeriod="):
                    log_period = int(line.strip().split('=')[1])
                    break
    except FileNotFoundError:
        print(f"  Warning: Metadata file not found at {meta_filename}")
    return log_period

def plot_dives():
    if not plots_dir.exists():
        plots_dir.mkdir()

    bin_files = glob.glob(str(data_dir / "*.bin"))

    if not bin_files:
        print("No .bin files found in 'extracted_dives' folder. Run the extractor first.")
        return

    print(f"Found {len(bin_files)} extracted dive logs. Analyzing and plotting...")

    for filename in sorted(bin_files):
        print(f"\n--- Plotting {os.path.basename(filename)} ---")

        with open(filename, "rb") as f:
            data = f.read()

        samples = parse_samples_from_block(data)
        
        meta_filename = Path(filename).with_suffix('.meta')
        log_period = read_metadata(meta_filename)


        if not samples:
            print("No samples found in this block, skipping plot.")
            continue

        print(f"Found {len(samples)} samples. Log period is {log_period}s.")

        # Use the log period from metadata to calculate the time axis
        time_s = [i * log_period for i in range(len(samples))]
        depths_m = [s["depth_m"] for s in samples]

        plt.figure(figsize=(12, 7))
        plt.plot(time_s, depths_m, marker='.', linestyle='-', markersize=4)
        
        plt.title(f"Dive Profile - {os.path.basename(filename)}")
        plt.xlabel(f"Time (seconds)")
        plt.ylabel("Depth (meters)")
        plt.gca().invert_yaxis()
        plt.grid(True, linestyle='--', alpha=0.6)
        plt.tight_layout()

        plot_filename = plots_dir / (os.path.basename(filename).replace('.bin', '.png'))
        plt.savefig(plot_filename)
        print(f"-> Plot saved to {plot_filename}")
        plt.close()


if __name__ == "__main__":
    plot_dives()
