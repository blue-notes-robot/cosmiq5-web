import binascii
import os
import struct
from pathlib import Path

cur_dir = Path(__file__).parent
data_dir = cur_dir / "data"
output_dir = cur_dir / "extracted_dives"


class CosmiqLogHeader:
    """
    Parses a 72-byte raw header for a single dive, based on the structure
    found in the decompiled CosmiqLogHeader.java.
    The header consists of 36 little-endian 2-byte words.
    """

    def __init__(self, header_bytes):
        if len(header_bytes) != 72:
            raise ValueError(f"Header must be 72 bytes long, got {len(header_bytes)}")
        self.raw = header_bytes
        self._parse()

    def _unpack_word(self, offset):
        return struct.unpack("<H", self.raw[offset * 2 : offset * 2 + 2])[0]

    def _unpack_signed_word(self, offset):
        return struct.unpack("<h", self.raw[offset * 2 : offset * 2 + 2])[0]
        
    def _parse(self):
        self.logNumber = self._unpack_word(0)
        self.dvmode = self.raw[2] # This is a single byte
        self.oxygen_setting = self.raw[3] # This is a single byte
        
        dvsetting = self._unpack_word(2)
        self.dvUnitSetting = dvsetting >> 15

        date_word_1 = self._unpack_word(3) # This seems to be just the year
        self.dvdate_year = date_word_1 + 2000

        date_word_2 = self._unpack_word(4)
        self.dvdate_day = date_word_2 & 0xFF
        self.dvdate_month = (date_word_2 >> 8) & 0xFF

        date_word_3 = self._unpack_word(5)
        self.dvdate_minute = date_word_3 & 0xFF
        self.dvdate_hour = (date_word_3 >> 8) & 0xFF

        self.dvtime = self._unpack_word(6) # Dive time in minutes
        
        self.maxdepth = self._unpack_word(11) / 100.0 # In meters
        self.mintemperature = self._unpack_signed_word(12) / 10.0 # In Celsius
        
        self.logPeriod = self.raw[28] # Single byte
        self.logLength = self._unpack_word(14)
        
        self.logStartSector = self._unpack_word(15)
        self.logEndSector = self._unpack_word(16)
        self.logCheckSum = self._unpack_word(17)

    def __str__(self):
        return (
            f"Dive #{self.logNumber:03d} | "
            f"{self.dvdate_day:02d}/{self.dvdate_month:02d}/{self.dvdate_year} "
            f"{self.dvdate_hour:02d}:{self.dvdate_minute:02d} | "
            f"Duration: {self.dvtime}min | "
            f"Max Depth: {self.maxdepth:.1f}m | "
            f"Temp: {self.mintemperature:.1f}C | "
            f"Period: {self.logPeriod}s | "
            f"Length: {self.logLength} bytes | "
            f"Start Sector: {self.logStartSector}"
        )


def extract_dives_from_dump(dump_filename):
    if not output_dir.exists():
        output_dir.mkdir()

    header_hex = ""
    body_hex = ""

    with open(dump_filename, "r") as f:
        lines = f.readlines()

    print(f"Processing {len(lines)} packets from dump file...")

    for line in lines:
        line = line.strip().upper()
        if len(line) < 10:
            continue
        cmd = line[0:2]
        payload = line[6:]
        if cmd == "42":
            header_hex += payload
        elif cmd == "44":
            body_hex += payload

    print(f"Extracted {len(header_hex)//2} header bytes and {len(body_hex)//2} body bytes.")

    header_bytes = binascii.unhexlify(header_hex)
    body_bytes = binascii.unhexlify(body_hex)
    
    # The header data is a sequence of 72-byte records.
    num_headers = len(header_bytes) // 72
    print(f"Found {num_headers} potential dive headers.")

    SECTOR_SIZE = 4096

    dive_count = 0
    for i in range(num_headers):
        header_chunk = header_bytes[i * 72 : (i + 1) * 72]
        
        log_num_check = struct.unpack("<H", header_chunk[0:2])[0]
        if log_num_check == 0 or log_num_check == 0xFFFF:
            continue
            
        header = CosmiqLogHeader(header_chunk)
        print(header)

        # The body starts at sector 12. Each sector is 4096 bytes.
        # The header's logStartSector is an absolute sector index.
        start_offset = (header.logStartSector - 12) * SECTOR_SIZE
        
        if start_offset < 0:
            print(f"  -> Skipping, invalid start sector {header.logStartSector}.")
            continue

        if start_offset + header.logLength > len(body_bytes):
            print(f"  -> Skipping, log length ({header.logLength}) starting at {start_offset} exceeds body size ({len(body_bytes)}).")
            continue
            
        dive_body_bytes = body_bytes[start_offset : start_offset + header.logLength]

        dive_filename = output_dir / f"dive_{header.logNumber:03d}.bin"
        metadata_filename = output_dir / f"dive_{header.logNumber:03d}.meta"

        with open(dive_filename, "wb") as f:
            f.write(dive_body_bytes)
            
        with open(metadata_filename, "w") as f:
            f.write(f"LogPeriod={header.logPeriod}\n")
            f.write(f"MaxDepth={header.maxdepth}\n")
            f.write(f"DiveTime={header.dvtime}\n")

        print(f"  -> Extracted dive {header.logNumber} to {dive_filename}")
        dive_count += 1
        
    print(f"\nExtraction complete. Found and extracted {dive_count} valid dives.")


if __name__ == "__main__":
    dump_file = data_dir / "cosmiq_dump_1765031981564.txt"
    if dump_file.exists():
        extract_dives_from_dump(dump_file)
    else:
        print(f"Error: Dump file not found at {dump_file}")