#!/usr/bin/env python3
"""Fail closed unless every ELF PT_LOAD segment in an APK ABI is 16 KB aligned."""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("usage: check-16kb-elf-alignment.py ABI APK")

abi, apk_arg = sys.argv[1], Path(sys.argv[2])
expected_machine = {
    "arm64-v8a": "AArch64",
    "x86_64": "Advanced Micro Devices X86-64",
}
if abi not in expected_machine:
    raise SystemExit(f"Unsupported ABI: {abi}")
if not apk_arg.is_file() or apk_arg.stat().st_size == 0:
    raise SystemExit(f"APK missing or empty: {apk_arg}")

readelf = shutil.which("readelf") or shutil.which("greadelf")
if not readelf:
    raise SystemExit("readelf/greadelf is required to inspect native ELF segments")

prefix = f"lib/{abi}/"
with zipfile.ZipFile(apk_arg) as archive:
    members = sorted(
        item for item in archive.namelist()
        if item.startswith(prefix) and item.endswith(".so") and not item.endswith("/")
    )
    if not members:
        raise SystemExit(f"No native .so libraries found for ABI {abi} in {apk_arg}")

    failures: list[str] = []
    with tempfile.TemporaryDirectory(prefix="server-elf16k-") as temp:
        root = Path(temp)
        for member in members:
            output = root / Path(member).name
            output.write_bytes(archive.read(member))
            header = subprocess.run(
                [readelf, "-h", str(output)], text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False
            )
            if header.returncode != 0:
                failures.append(f"{member}: readelf header failed: {header.stderr.strip()}")
                continue
            machine = re.search(r"^\s*Machine:\s*(.+?)\s*$", header.stdout, re.MULTILINE)
            if not machine or machine.group(1) != expected_machine[abi]:
                failures.append(
                    f"{member}: wrong ELF machine "
                    f"{machine.group(1) if machine else 'unknown'} (expected {expected_machine[abi]})"
                )
                continue

            program_headers = subprocess.run(
                [readelf, "-W", "-l", str(output)], text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False
            )
            if program_headers.returncode != 0:
                failures.append(f"{member}: readelf program headers failed: {program_headers.stderr.strip()}")
                continue

            loads = []
            for line in program_headers.stdout.splitlines():
                fields = line.split()
                if fields and fields[0] == "LOAD":
                    try:
                        loads.append(int(fields[-1], 0))
                    except (ValueError, IndexError):
                        failures.append(f"{member}: could not parse PT_LOAD alignment: {line.strip()}")

            if not loads:
                failures.append(f"{member}: no PT_LOAD program headers found")
                continue
            bad = [value for value in loads if value < 0x4000]
            if bad:
                failures.append(
                    f"{member}: PT_LOAD alignment(s) below 0x4000: "
                    + ", ".join(hex(value) for value in bad)
                )
            else:
                print(
                    f"ALIGNED abi={abi} library={Path(member).name} "
                    f"PT_LOAD_segments={len(loads)} min_align={hex(min(loads))}"
                )

if failures:
    for failure in failures:
        print("UNALIGNED " + failure, file=sys.stderr)
    raise SystemExit(1)

print(f"SERVER_16KB_ELF_ALIGNMENT_PASS abi={abi} libraries={len(members)} apk={apk_arg}")
