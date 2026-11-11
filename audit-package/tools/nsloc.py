#!/usr/bin/env python3
"""nSLOC counter for programs/swd_amm/src (audit scope sizing).

nSLOC = non-blank, non-comment source lines, excluding `#[cfg(test)]`
modules. With --v2-only, items gated `#[cfg(not(feature = "v2-only"))]`
are dropped (and items gated `#[cfg(feature = "v2-only")]` kept), so the
number matches what `--features v2-only` compiles; whole files that the
crate root does not compile under v2-only are skipped.

    python3 audit-package/tools/nsloc.py            # full program
    python3 audit-package/tools/nsloc.py --v2-only  # reduced mainnet scope
    python3 audit-package/tools/nsloc.py --json
"""
import json
import os
import re
import sys

SRC = os.path.join(os.path.dirname(__file__), "..", "..", "programs", "swd_amm", "src")
V2_ONLY_EXCLUDED_FILES = {"cp.rs", "cp_math.rs", "dlmm.rs", "dlmm_math.rs"}

GATE_OUT_IN_V2 = re.compile(r'^\s*#\[cfg\(not\(feature = "v2-only"\)\)\]\s*$')
GATE_IN_V2 = re.compile(r'^\s*#\[cfg\((all\()?feature = "v2-only".*\)\]\s*$')
CFG_TEST = re.compile(r'^\s*#\[cfg\(test\)\]\s*$')


def strip_comments(text):
    out, i, n, depth = [], 0, len(text), 0
    in_str = False
    while i < n:
        c = text[i]
        if depth == 0 and not in_str and text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if not in_str and text.startswith("/*", i):
            depth += 1; i += 2; continue
        if depth and text.startswith("*/", i):
            depth -= 1; i += 2; continue
        if depth:
            if c == "\n":
                out.append(c)
            i += 1; continue
        if c == '"' and (i == 0 or text[i - 1] != "\\") and not (text[i - 1:i] == "'" and text[i + 1:i + 2] == "'"):
            in_str = not in_str
        out.append(c); i += 1
    return "".join(out)


def skip_item(lines, k):
    """Index just past the item starting at lines[k] (attributes included)."""
    depth = 0
    started = False
    while k < len(lines):
        l = lines[k]
        depth += l.count("{") + l.count("(") + l.count("[") - l.count("}") - l.count(")") - l.count("]")
        s = l.strip()
        if s and not s.startswith("#["):
            started = True
        k += 1
        if started and depth <= 0 and (s.endswith(";") or s.endswith("}") or s.endswith("},")):
            return k
    return k


def count(path, v2_only):
    lines = strip_comments(open(path, encoding="utf-8").read()).split("\n")
    n, k = 0, 0
    while k < len(lines):
        l = lines[k]
        if CFG_TEST.match(l):
            k = skip_item(lines, k + 1); continue
        if GATE_OUT_IN_V2.match(l) and v2_only:
            k = skip_item(lines, k + 1); continue
        if GATE_IN_V2.match(l) and not v2_only:
            k = skip_item(lines, k + 1); continue
        if l.strip():
            n += 1
        k += 1
    return n


def main():
    v2 = "--v2-only" in sys.argv
    res = {}
    for f in sorted(os.listdir(SRC)):
        if not f.endswith(".rs") or (v2 and f in V2_ONLY_EXCLUDED_FILES):
            continue
        res[f] = count(os.path.join(SRC, f), v2)
    if "--json" in sys.argv:
        print(json.dumps({"v2_only": v2, "files": res, "total": sum(res.values())}, indent=1))
        return
    for f, n in res.items():
        print(f"{n:6d}  {f}")
    print(f"{sum(res.values()):6d}  TOTAL ({'v2-only' if v2 else 'full'} build, nSLOC, tests excluded)")


if __name__ == "__main__":
    main()
