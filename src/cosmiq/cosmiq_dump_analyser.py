import binascii
import os
from pathlib import Path

cur_dir = Path(__file__).parent
data_dir = cur_dir / "data"


def parse_dump(filename):
    header_hex = ""
    body_hex = ""

    with open(filename, "r") as f:
        lines = f.readlines()

    print(f"Processing {len(lines)} packets...")

    for line in lines:
        line = line.strip()
        if len(line) < 10:
            continue

        # Structure: CMD(2) CKSUM(2) LEN(2) PAYLOAD(12)
        cmd = line[0:2]
        # cksum = line[2:4]
        # length = line[4:6]
        payload = line[6:]

        if cmd == "42":  # Header Response
            header_hex += payload
        elif cmd == "44":  # Body Response
            body_hex += payload

    print(f"\n--- HEADER ({len(header_hex) // 2} bytes) ---")
    print(header_hex)

    # Convert Body to Bytes for analysis
    try:
        body_bytes = binascii.unhexlify(body_hex)
    except binascii.Error:
        print("Error decoding hex data")
        return

    print(f"\n--- BODY ({len(body_bytes)} bytes) ---")

    # The dump contains a lot of empty FFFFFF padding.
    # Let's find the actual data clusters.

    # A dive log entry typically doesn't look like FFFFFFFFFF.
    # We will scan for non-FF blocks.

    unique_data_chunks = []
    current_chunk = bytearray()
    in_data = False

    for i in range(0, len(body_bytes), 6):  # Process in 6-byte chunks (packet size)
        chunk = body_bytes[i : i + 6]
        hex_chunk = chunk.hex().upper()

        # Check if this chunk is empty padding (Allowing for C2/C3/C4 markers we saw in logs)
        # In the user's log we saw "C200", "C300" markers.
        # Pure empty is usually FFFFFFFFFFFF.

        if hex_chunk == "FFFFFFFFFFFF":
            if in_data:
                unique_data_chunks.append(current_chunk)
                current_chunk = bytearray()
                in_data = False
        else:
            in_data = True
            current_chunk.extend(chunk)

    if current_chunk:
        unique_data_chunks.append(current_chunk)

    # Output results
    print(f"Found {len(unique_data_chunks)} distinct data blocks in the body.")

    for idx, block in enumerate(unique_data_chunks):
        print(f"\nBlock {idx + 1} Size: {len(block)} bytes")
        # Print hexdump of the block
        hex_str = block.hex().upper()
        # Split into readable lines of 32 chars (16 bytes)
        for i in range(0, len(hex_str), 32):
            print(hex_str[i : i + 32])

        # Save block to file
        block_filename = data_dir / f"dive_log_block_{idx + 1}.bin"
        with open(block_filename, "wb") as bf:
            bf.write(block)
        print(f"-> Saved to {block_filename}")


# Run the parser
# Replace with your actual filename if running locally
if __name__ == "__main__":
    print(os.getcwd())
    # creating a dummy file for demonstration if it doesn't exist
    dummy_filename = data_dir / "cosmiq_dump_1765031981564.txt"
    if os.path.exists(dummy_filename):
        parse_dump(dummy_filename)
    else:
        print(
            f"File {dummy_filename} not found. Please place the dump file in the same directory."
        )
