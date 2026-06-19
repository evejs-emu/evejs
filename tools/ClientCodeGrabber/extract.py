"""
EVE Client Code Grabber
Extracts and decompiles Python bytecode from the EVE Online client's code.ccp archive.

Pipeline:  code.ccp (ZIP) -> .pyj (zlib-compressed) -> .pyc (Python 2.7) -> .py (decompiled)
"""

import os
import sys
import zlib
import time
import shutil
import zipfile
import struct
import subprocess
import argparse
import tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── ANSI colours & box-drawing ──────────────────────────────────────────────

RESET   = "\033[0m"
BOLD    = "\033[1m"
DIM     = "\033[2m"

RED     = "\033[91m"
GREEN   = "\033[92m"
YELLOW  = "\033[93m"
BLUE    = "\033[94m"
MAGENTA = "\033[95m"
CYAN    = "\033[96m"
WHITE   = "\033[97m"

BG_BLUE   = "\033[44m"
BG_GREEN  = "\033[42m"
BG_RED    = "\033[41m"

BAR_FILL  = "\u2588"   # █
BAR_EMPTY = "\u2591"   # ░

BOX_TL = "\u2554"  # ╔
BOX_TR = "\u2557"  # ╗
BOX_BL = "\u255a"  # ╚
BOX_BR = "\u255d"  # ╝
BOX_H  = "\u2550"  # ═
BOX_V  = "\u2551"  # ║
BOX_ML = "\u2560"  # ╠
BOX_MR = "\u2563"  # ╣

CHECK   = f"{GREEN}\u2714{RESET}"   # ✔
CROSS   = f"{RED}\u2718{RESET}"     # ✘
ARROW   = f"{CYAN}\u25b6{RESET}"    # ▶
BULLET  = f"{YELLOW}\u2022{RESET}"  # •

WIDTH = 72


def enable_ansi_windows():
    """Enable ANSI escape codes on Windows."""
    if sys.platform == "win32":
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)


def box_line(text, pad_char=" "):
    """Render a single box row with content centred."""
    inner = WIDTH - 4
    content = text[:inner].center(inner)
    return f"  {BOX_V} {content} {BOX_V}"


def box_top():
    return f"  {BOX_TL}{BOX_H * (WIDTH - 2)}{BOX_TR}"


def box_mid():
    return f"  {BOX_ML}{BOX_H * (WIDTH - 2)}{BOX_MR}"


def box_bot():
    return f"  {BOX_BL}{BOX_H * (WIDTH - 2)}{BOX_BR}"


def banner(source_path, output_path):
    print()
    print(f"{CYAN}{box_top()}{RESET}")
    print(f"{CYAN}{box_line('')}{RESET}")
    print(f"{CYAN}{box_line(f'{BOLD}{WHITE}EVE Client Code Grabber{RESET}{CYAN}')}{RESET}")
    print(f"{CYAN}{box_line(f'{DIM}Extract  {BAR_FILL}  Decompress  {BAR_FILL}  Decompile{RESET}{CYAN}')}{RESET}")
    print(f"{CYAN}{box_line('')}{RESET}")
    print(f"{CYAN}{box_mid()}{RESET}")
    print(f"{CYAN}{box_line(f'{DIM}Source:{RESET}  {WHITE}{source_path}{RESET}{CYAN}')}{RESET}")
    print(f"{CYAN}{box_line(f'{DIM}Output:{RESET}  {WHITE}{output_path}{RESET}{CYAN}')}{RESET}")
    print(f"{CYAN}{box_line('')}{RESET}")
    print(f"{CYAN}{box_bot()}{RESET}")
    print()


def progress_bar(current, total, width=40, label="", extra=""):
    """Render a coloured progress bar with percentage."""
    if total == 0:
        pct = 100
    else:
        pct = current / total * 100
    filled = int(width * current / max(total, 1))
    empty = width - filled

    if pct < 50:
        bar_colour = YELLOW
    elif pct < 100:
        bar_colour = CYAN
    else:
        bar_colour = GREEN

    bar = f"{bar_colour}{BAR_FILL * filled}{DIM}{BAR_EMPTY * empty}{RESET}"
    pct_str = f"{pct:5.1f}%"

    line = f"\r  {label}{bar}  {WHITE}{pct_str}{RESET}  {DIM}{current:,}/{total:,}{RESET}"
    if extra:
        # Truncate extra info to fit terminal
        max_extra = 60
        if len(extra) > max_extra:
            extra = "..." + extra[-(max_extra - 3):]
        line += f"  {extra}"

    # Pad to clear previous line remnants
    line += " " * 20
    sys.stdout.write(line)
    sys.stdout.flush()


def phase_header(num, title, icon=""):
    print()
    print(f"  {BOLD}{BG_BLUE}{WHITE} PHASE {num} {RESET}  {BOLD}{WHITE}{title}{RESET}  {icon}")
    print(f"  {DIM}{'─' * (WIDTH - 4)}{RESET}")


def phase_complete(msg, count, elapsed):
    print()
    print(f"  {CHECK}  {GREEN}{msg}{RESET}  {DIM}({count:,} files in {elapsed:.1f}s){RESET}")


def phase_error(msg):
    print()
    print(f"  {CROSS}  {RED}{msg}{RESET}")


# ── Core pipeline ───────────────────────────────────────────────────────────

def find_code_ccp(exefile_path):
    """Locate code.ccp relative to exefile.exe (should be at ../code.ccp from bin64/)."""
    exe_dir = Path(exefile_path).parent           # .../bin64/
    tq_dir = exe_dir.parent                       # .../tq/
    code_ccp = tq_dir / "code.ccp"
    if code_ccp.exists():
        return code_ccp
    # Also check same directory as exe
    alt = exe_dir / "code.ccp"
    if alt.exists():
        return alt
    return None


def extract_archive(code_ccp_path, output_dir):
    """Phase 1: Extract all .pyj entries from the code.ccp ZIP archive."""
    phase_header(1, "Extracting code.ccp archive", "\U0001f4e6")

    with zipfile.ZipFile(str(code_ccp_path), "r") as zf:
        entries = [e for e in zf.namelist() if e.endswith(".pyj")]
        total = len(entries)

        if total == 0:
            phase_error("No .pyj files found in archive!")
            return []

        extracted = []
        for i, entry in enumerate(entries, 1):
            out_path = output_dir / entry
            out_path.parent.mkdir(parents=True, exist_ok=True)
            data = zf.read(entry)
            out_path.write_bytes(data)
            extracted.append(entry)

            if i % 50 == 0 or i == total:
                progress_bar(i, total, label=f"{MAGENTA}[EXTRACT] {RESET}")

    phase_complete("Archive extracted", total, 0)
    return extracted


def decompress_pyj(output_dir, entries):
    """Phase 2: Decompress .pyj (zlib) → .pyc files."""
    phase_header(2, "Decompressing .pyj \u2192 .pyc", "\U0001f5dc\ufe0f")

    total = len(entries)
    success = 0
    failed = 0
    t0 = time.time()

    for i, entry in enumerate(entries, 1):
        pyj_path = output_dir / entry
        pyc_path = pyj_path.with_suffix(".pyc")

        try:
            compressed = pyj_path.read_bytes()
            decompressed = zlib.decompress(compressed)
            pyc_path.write_bytes(decompressed)
            success += 1
        except Exception as e:
            failed += 1
            if failed <= 3:
                sys.stdout.write(f"\n  {CROSS}  {DIM}{entry}: {e}{RESET}")

        if i % 50 == 0 or i == total:
            progress_bar(i, total, label=f"{BLUE}[DECOMP] {RESET}")

    elapsed = time.time() - t0
    phase_complete(f"Decompressed {success:,} files", success, elapsed)
    if failed:
        print(f"  {CROSS}  {RED}{failed:,} files failed to decompress{RESET}")

    return success, failed


def decompile_pyc(output_dir, entries, workers=4, verbose=True):
    """Phase 3: Run uncompyle6 on .pyc → .py files."""
    phase_header(3, "Decompiling .pyc \u2192 .py  (uncompyle6)", "\U0001f523")

    pyc_entries = []
    for entry in entries:
        pyc_path = (output_dir / entry).with_suffix(".pyc")
        if pyc_path.exists():
            pyc_entries.append(entry)

    total = len(pyc_entries)
    success = 0
    failed = 0
    fail_list = []
    t0 = time.time()

    # Find uncompyle6 executable
    uncompyle6_cmd = shutil.which("uncompyle6")
    if not uncompyle6_cmd:
        import sysconfig
        from pathlib import Path as _Path
        user_scripts = _Path(sysconfig.get_path("scripts", "nt_user"))
        # Try common locations
        for candidate in [
            sys.executable.replace("python.exe", "Scripts\\uncompyle6.exe"),
            sys.executable.replace("python.exe", "Scripts\\uncompyle6"),
            str(user_scripts / "uncompyle6.exe"),
            str(user_scripts / "uncompyle6"),
        ]:
            if os.path.exists(candidate):
                uncompyle6_cmd = candidate
                break

    if not uncompyle6_cmd:
        phase_error("uncompyle6 not found! Install with: pip install uncompyle6")
        return 0, total

    print(f"  {BULLET}  Using: {DIM}{uncompyle6_cmd}{RESET}")
    print(f"  {BULLET}  Workers: {DIM}{workers}{RESET}")
    print(f"  {BULLET}  Files to decompile: {DIM}{total:,}{RESET}")
    print()

    def decompile_one(entry):
        pyc_path = (output_dir / entry).with_suffix(".pyc")
        py_path = (output_dir / entry).with_suffix(".py")

        try:
            result = subprocess.run(
                [uncompyle6_cmd, "-o", str(py_path.parent), str(pyc_path)],
                capture_output=True,
                text=True,
                timeout=30,
            )

            # uncompyle6 outputs the .py with the same stem
            if py_path.exists() and py_path.stat().st_size > 0:
                return (entry, True, "")
            elif result.returncode != 0:
                err = result.stderr.strip().split("\n")[-1] if result.stderr else "unknown"
                return (entry, False, err)
            else:
                return (entry, True, "")
        except subprocess.TimeoutExpired:
            return (entry, False, "timeout (30s)")
        except Exception as e:
            return (entry, False, str(e))

    last_files = []

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(decompile_one, e): e for e in pyc_entries}

        for i, future in enumerate(as_completed(futures), 1):
            entry, ok, err = future.result()

            if ok:
                success += 1
                status_icon = CHECK
                py_name = Path(entry).with_suffix(".py").as_posix()
            else:
                failed += 1
                fail_list.append((entry, err))
                status_icon = CROSS
                py_name = Path(entry).with_suffix(".py").as_posix()

            # Show last file processed
            if verbose and (i % 25 == 0 or not ok or i == total):
                # Clear progress line and show file status
                short_name = py_name
                if len(short_name) > 55:
                    short_name = "..." + short_name[-52:]
                sys.stdout.write(f"\r{' ' * (WIDTH + 40)}\r")  # clear line
                if not ok:
                    print(f"  {status_icon}  {DIM}{short_name}{RESET}  {RED}{err[:40]}{RESET}")
                else:
                    print(f"  {status_icon}  {DIM}{short_name}{RESET}")

            progress_bar(
                i, total,
                label=f"{GREEN}[DECOMPILE] {RESET}",
                extra=f"{GREEN}{success:,}\u2714 {RED}{failed:,}\u2718{RESET}",
            )

    elapsed = time.time() - t0
    print()
    phase_complete(f"Decompiled {success:,} files", success, elapsed)
    if failed:
        print(f"  {CROSS}  {RED}{failed:,} files failed to decompile{RESET}")
        # Write failure log
        log_path = output_dir / "_decompile_errors.log"
        with open(log_path, "w") as f:
            for entry, err in fail_list:
                f.write(f"{entry}: {err}\n")
        print(f"  {BULLET}  Error log: {DIM}{log_path}{RESET}")

    return success, failed


def cleanup_non_py(output_dir):
    """Remove all non-.py files (.pyj, .pyc, etc.) from the output directory."""
    phase_header(4, "Cleaning up non-code files", "\U0001f9f9")

    non_py = []
    for f in Path(output_dir).rglob("*"):
        if f.is_file() and f.suffix != ".py":
            non_py.append(f)

    total = len(non_py)
    if total == 0:
        print(f"  {CHECK}  {GREEN}Nothing to clean — only .py files found{RESET}")
        return 0

    removed = 0
    total_bytes = 0
    for i, f in enumerate(non_py, 1):
        total_bytes += f.stat().st_size
        f.unlink()
        removed += 1
        if i % 100 == 0 or i == total:
            progress_bar(i, total, label=f"{RED}[CLEANUP] {RESET}")

    # Remove any now-empty directories
    for d in sorted(Path(output_dir).rglob("*"), reverse=True):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()

    mb_freed = total_bytes / 1024 / 1024
    print()
    phase_complete(f"Removed {removed:,} files ({mb_freed:.1f} MB freed)", removed, 0)
    return removed


def summary(total_files, extract_ok, decomp_ok, decomp_fail, decompile_ok, decompile_fail, output_dir, elapsed_total):
    """Print final summary."""
    print()
    print(f"  {CYAN}{BOX_TL}{BOX_H * (WIDTH - 2)}{BOX_TR}{RESET}")
    print(f"  {CYAN}{box_line(f'{BOLD}{WHITE}EXTRACTION COMPLETE{RESET}{CYAN}')}{RESET}")
    print(f"  {CYAN}{box_mid()}{RESET}")

    py_count = sum(1 for _ in Path(output_dir).rglob("*.py"))
    pyc_count = sum(1 for _ in Path(output_dir).rglob("*.pyc"))
    pyj_count = sum(1 for _ in Path(output_dir).rglob("*.pyj"))

    stats = [
        f"Archive entries:    {WHITE}{total_files:>8,}{RESET}",
        f"Decompressed .pyc:  {GREEN}{decomp_ok:>8,}{RESET}   {RED}failed: {decomp_fail:,}{RESET}",
        f"Decompiled .py:     {GREEN}{decompile_ok:>8,}{RESET}   {RED}failed: {decompile_fail:,}{RESET}",
        f"",
        f"Output .py files:   {WHITE}{py_count:>8,}{RESET}",
        f"Output .pyc files:  {WHITE}{pyc_count:>8,}{RESET}",
        f"Output .pyj files:  {WHITE}{pyj_count:>8,}{RESET}",
        f"Total time:         {WHITE}{elapsed_total:>7.1f}s{RESET}",
    ]

    for s in stats:
        inner = WIDTH - 4
        padded = f"  {s}".ljust(inner + 40)  # extra for ANSI codes
        print(f"  {CYAN}{BOX_V}{RESET} {padded} {CYAN}{BOX_V}{RESET}")

    print(f"  {CYAN}{box_mid()}{RESET}")
    print(f"  {CYAN}{box_line(f'{DIM}Output: {WHITE}{output_dir}{RESET}{CYAN}')}{RESET}")
    print(f"  {CYAN}{box_bot()}{RESET}")
    print()


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    enable_ansi_windows()

    script_dir = Path(__file__).resolve().parent
    default_exe = script_dir.parent.parent / "client" / "EVE" / "tq" / "bin64" / "exefile.exe"
    parser = argparse.ArgumentParser(description="EVE Client Code Grabber")
    parser.add_argument(
        "--exe",
        default=str(default_exe),
        help="Path to exefile.exe",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output directory (default: tools/ClientCodeGrabber/Latest)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=6,
        help="Number of parallel decompile workers (default: 6)",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress per-file output during decompilation",
    )
    args = parser.parse_args()

    # Resolve paths
    if args.output:
        output_dir = Path(args.output).resolve()
    else:
        output_dir = script_dir / "Latest"

    exefile = Path(args.exe)
    if not exefile.exists():
        print(f"\n  {CROSS}  {RED}exefile.exe not found at: {exefile}{RESET}")
        sys.exit(1)

    code_ccp = find_code_ccp(exefile)
    if not code_ccp:
        print(f"\n  {CROSS}  {RED}code.ccp not found relative to: {exefile}{RESET}")
        sys.exit(1)

    # Banner
    banner(str(code_ccp), str(output_dir))

    # Clean output directory
    if output_dir.exists():
        print(f"  {BULLET}  Cleaning previous output...")
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    t_start = time.time()

    # Phase 1: Extract
    t0 = time.time()
    entries = extract_archive(code_ccp, output_dir)
    t_extract = time.time() - t0
    if not entries:
        sys.exit(1)

    # Phase 2: Decompress .pyj → .pyc
    decomp_ok, decomp_fail = decompress_pyj(output_dir, entries)

    # Phase 3: Decompile .pyc → .py
    decompile_ok, decompile_fail = decompile_pyc(
        output_dir, entries, workers=args.workers, verbose=not args.quiet
    )

    t_total = time.time() - t_start

    # Summary
    summary(
        total_files=len(entries),
        extract_ok=len(entries),
        decomp_ok=decomp_ok,
        decomp_fail=decomp_fail,
        decompile_ok=decompile_ok,
        decompile_fail=decompile_fail,
        output_dir=output_dir,
        elapsed_total=t_total,
    )

    # Offer to clean up non-.py files
    non_py = sum(1 for f in Path(output_dir).rglob("*") if f.is_file() and f.suffix != ".py")
    if non_py > 0:
        print(f"  {BULLET}  There are {YELLOW}{non_py:,}{RESET} non-.py files (.pyj, .pyc, etc.) in the output.")
        print()
        try:
            answer = input(f"  {ARROW}  {BOLD}Would you like to remove them and keep only .py code files? {WHITE}[y/N]{RESET} ")
        except (EOFError, KeyboardInterrupt):
            answer = ""
        if answer.strip().lower() in ("y", "yes"):
            cleanup_non_py(output_dir)
        else:
            print(f"\n  {BULLET}  {DIM}Keeping all files as-is.{RESET}")
    print()


if __name__ == "__main__":
    main()
