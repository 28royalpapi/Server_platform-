#!/usr/bin/env python3
"""Fail closed when connectedDebugAndroidTest ran zero tests or reported failures."""
from pathlib import Path
import argparse
import sys
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument("--expected-tests", type=int, default=None)
args = parser.parse_args()

RESULTS = Path("apps/android-caller/app/build/outputs/androidTest-results/connected/debug")
files = sorted(RESULTS.rglob("TEST-*.xml")) if RESULTS.exists() else []

if not files:
    print(f"ERROR: no Android instrumentation result XML found under {RESULTS}", file=sys.stderr)
    raise SystemExit(1)

total = failures = errors = skipped = 0
for result in files:
    try:
        root = ET.parse(result).getroot()
    except (ET.ParseError, OSError) as exc:
        print(f"ERROR: could not parse Android test result {result}: {exc}", file=sys.stderr)
        raise SystemExit(1)
    suites = list(root.iter("testsuite")) if root.tag == "testsuites" else [root]
    for suite in suites:
        total += int(suite.attrib.get("tests", "0"))
        failures += int(suite.attrib.get("failures", "0"))
        errors += int(suite.attrib.get("errors", "0"))
        skipped += int(suite.attrib.get("skipped", "0"))

print(f"ANDROID_INSTRUMENTATION_RESULTS tests={total} failures={failures} errors={errors} skipped={skipped}")
if total < 1:
    print("ERROR: instrumentation runner completed without executing a test.", file=sys.stderr)
    raise SystemExit(1)
if args.expected_tests is not None and total != args.expected_tests:
    print(f"ERROR: expected exactly {args.expected_tests} instrumentation tests, observed {total}.", file=sys.stderr)
    raise SystemExit(1)
if skipped:
    print("ERROR: Android instrumentation reported skipped tests.", file=sys.stderr)
    raise SystemExit(1)
if failures or errors:
    print("ERROR: Android instrumentation reported failures or errors.", file=sys.stderr)
    raise SystemExit(1)
