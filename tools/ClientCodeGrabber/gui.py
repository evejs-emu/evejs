"""
EVE Client Code Grabber  —  Production GUI v3
"""
import tkinter as tk
from tkinter import filedialog
import threading, queue, sys, os, math, time
import zlib, shutil, zipfile, subprocess, random
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed

# ── Module-level worker (must be picklable for ProcessPoolExecutor on Windows) ──
def _decompile_worker(args):
    """Decompile a single .pyc → .py.  Tries the uncompyle6 library first
    (fast, no subprocess overhead), falls back to CLI subprocess."""
    pyc_str, py_str, unc_cmd = args
    pyc, py = Path(pyc_str), Path(py_str)
    try:
        import uncompyle6
        with open(py, "w", errors="replace") as fh:
            uncompyle6.decompile_file(str(pyc), fh)
        if py.exists() and py.stat().st_size > 0:
            return True, ""
    except Exception:
        pass  # fall through to subprocess
    try:
        r = subprocess.run(
            [unc_cmd, "-o", str(py.parent), str(pyc)],
            capture_output=True, text=True, timeout=30)
        if py.exists() and py.stat().st_size > 0:
            return True, ""
        return False, (r.stderr or "").strip().split("\n")[-1]
    except subprocess.TimeoutExpired:
        return False, "timeout"
    except Exception as ex:
        return False, str(ex)

# ══════════════════════════════════════════════════════════
#  Design tokens
# ══════════════════════════════════════════════════════════
BG   = "#070b12"
S1   = "#0d1422"   # surface 1
S2   = "#131d2e"   # surface 2
BD   = "#1e3050"   # border
BDA  = "#2d5080"   # border active

BLUE  = "#38bdf8"
BLUEM = "#0ea5e9"
BLUEDIM = "#0c2840"
GOLD  = "#f59e0b"
GOLDD = "#78350f"
GREEN = "#22c55e"
GREENM= "#16a34a"
GREEND= "#052e16"
RED   = "#ef4444"
REDD  = "#450a0a"

T0 = "#f8fafc"
T1 = "#e2e8f0"
T2 = "#94a3b8"
T3 = "#475569"
T4 = "#1e293b"

FN = "Segoe UI"
F_TITLE = (FN, 20, "bold")
F_H1    = (FN, 13, "bold")
F_H2    = (FN, 11, "bold")
F_BODY  = (FN, 10)
F_HINT  = (FN,  9)
F_SMALL = (FN,  8)
F_MONO  = ("Consolas", 9)
F_BTN   = (FN, 13, "bold")

SCRIPT_DIR  = Path(__file__).resolve().parent
DEFAULT_EXE = str(SCRIPT_DIR.parent.parent / "client" / "EVE" / "tq" / "bin64" / "exefile.exe")
DEFAULT_OUT = str(SCRIPT_DIR / "Latest")


def lp(a, b, t):
    t = max(0.0, min(1.0, t))
    def c(x): return int(x[1:3],16), int(x[3:5],16), int(x[5:7],16)
    ar,ag,ab = c(a); br,bg,bb = c(b)
    return "#{:02x}{:02x}{:02x}".format(
        int(ar+(br-ar)*t), int(ag+(bg-ag)*t), int(ab+(bb-ab)*t))


def rr(canvas, x1, y1, x2, y2, r, **kw):
    """Draw a rounded rectangle on canvas."""
    r = min(r, max(1, int((x2-x1)//2)), max(1, int((y2-y1)//2)))
    pts = [x1+r,y1, x2-r,y1, x2,y1, x2,y1+r,
           x2,y2-r, x2,y2, x2-r,y2, x1+r,y2,
           x1,y2, x1,y2-r, x1,y1+r, x1,y1]
    canvas.create_polygon(pts, smooth=True, **kw)


# ══════════════════════════════════════════════════════════
#  Animated starfield header
# ══════════════════════════════════════════════════════════
class Header(tk.Canvas):
    def __init__(self, parent, **kw):
        super().__init__(parent, height=88, bg=BG,
                         highlightthickness=0, bd=0, **kw)
        self._t = 0.0
        self._stars = [
            [random.random(), random.random(),
             random.uniform(-3e-4, 3e-4), random.uniform(-2e-4, 2e-4),
             random.uniform(0.2, 1.0), random.uniform(0.8, 2.2)]
            for _ in range(55)
        ]
        self._tick()

    def _tick(self):
        self._t += 0.025
        w = self.winfo_width() or 920
        h = 88
        self.delete("all")

        # Background gradient
        for y in range(h):
            v = 1 - y/h
            r_ = int(7  + v * 8)
            g_ = int(11 + v * 10)
            b_ = int(18 + v * 14)
            self.create_line(0, y, w, y, fill=f"#{r_:02x}{g_:02x}{b_:02x}")

        # Stars
        for s in self._stars:
            s[0] = (s[0] + s[2]) % 1.0
            s[1] = (s[1] + s[3]) % 1.0
            twinkle = s[4] * (0.4 + 0.6*math.sin(self._t*3 + s[0]*20))
            col = lp("#0d1e38", "#6bb8d8", twinkle * 0.65)
            x, y, sz = s[0]*w, s[1]*h, s[5]
            self.create_oval(x-sz, y-sz, x+sz, y+sz, fill=col, outline="")

        # Bottom glow line
        g = 0.45 + 0.45*math.sin(self._t*1.8)
        self.create_line(0, h-2, w, h-2, fill=lp(GOLDD, GOLD, g*0.8), width=2)

        # Diamond icon
        cx, cy = 48, h//2
        ds = 11 + 1.5*math.sin(self._t*2.2)
        self.create_polygon(cx, cy-ds, cx+ds, cy, cx, cy+ds, cx-ds, cy,
                            fill=GOLD, outline=GOLDD, width=1)
        ids = ds * 0.45
        self.create_polygon(cx, cy-ids, cx+ids, cy, cx, cy+ids, cx-ids, cy,
                            fill=GOLDD, outline="")

        # Title
        self.create_text(w//2, h//2-13, text="EVE CLIENT CODE GRABBER",
                         font=F_TITLE, fill=T0, anchor="center")
        sub = lp(BLUEDIM, BLUE, 0.4 + 0.3*math.sin(self._t))
        self.create_text(w//2, h//2+12,
                         text="Extract  ·  Decompress  ·  Decompile  Python source from the EVE client",
                         font=F_BODY, fill=sub, anchor="center")

        self.after(33, self._tick)


# ══════════════════════════════════════════════════════════
#  Smooth progress bar
# ══════════════════════════════════════════════════════════
class Bar(tk.Canvas):
    SH = 90
    def __init__(self, parent, h=10, **kw):
        super().__init__(parent, height=h, bg=S1,
                         highlightthickness=0, bd=0, **kw)
        self._v = self._t = self._sx = 0.0
        self._col = BLUE
        self._on = False
        self.bind("<Configure>", lambda e: self._draw())

    def set(self, pct, col=None):
        self._t = max(0, min(1, pct))
        if col: self._col = col
        if not self._on:
            self._on = True
            self._tick()

    def reset(self):
        self._v = self._t = self._sx = 0.0
        self._on = False
        self._draw()

    def _tick(self):
        d = self._t - self._v
        self._v += d * 0.16
        if abs(d) < 0.001: self._v = self._t
        w = self.winfo_width() or 300
        fp = int(w * self._v)
        if fp > 0: self._sx = (self._sx + 4) % (fp + self.SH)
        self._draw()
        if abs(self._t-self._v) > 0.001 or 0 < self._v < 1:
            self.after(16, self._tick)
        else:
            self._on = False

    def _draw(self):
        self.delete("all")
        w = self.winfo_width() or 300
        h = self.winfo_height() or 10
        r = h // 2
        rr(self, 0, 0, w, h, r, fill=S2, outline="")
        fp = int(w * self._v)
        if fp > 2:
            rr(self, 0, 0, fp, h, r, fill=self._col, outline="")
            sx = max(0, self._sx - self.SH)
            ex = min(fp, self._sx)
            if ex > sx:
                rr(self, sx, 0, ex, h, r, fill=lp(self._col,"#ffffff",0.42), outline="")
        rr(self, 0, 0, w, h, r, fill="", outline=BD)


# ══════════════════════════════════════════════════════════
#  Phase card  (circular ring + label)
# ══════════════════════════════════════════════════════════
class PhaseCard(tk.Canvas):
    RW  = 10    # ring width
    SZ  = 168   # card size — tall enough for ring + two text rows

    def __init__(self, parent, num, label, **kw):
        super().__init__(parent, width=self.SZ, height=self.SZ,
                         bg=S1, highlightthickness=1,
                         highlightbackground=BD, **kw)
        self._num   = num
        self._lbl   = label
        self._state = "idle"
        self._v     = 0.0
        self._t     = 0.0
        self._tgt   = 0.0
        self._det   = ""
        self._tick()

    def _tick(self):
        self._t += 0.045
        d = self._tgt - self._v
        self._v += d * 0.11
        if abs(d) < 0.001: self._v = self._tgt
        self._draw()
        self.after(20, self._tick)

    def _draw(self):
        self.delete("all")
        s  = self.SZ
        w  = self.winfo_width() or s   # actual canvas width (may be stretched)
        cx = w // 2

        st = self._state
        if   st == "idle":    rc, tc, bg = BD,    T3,    S1
        elif st == "running": rc, tc, bg = BLUE,  T1,    S2
        elif st == "done":    rc, tc, bg = GREEN, GREEN, "#061410"
        else:                 rc, tc, bg = RED,   RED,   "#100606"

        self.config(bg=bg, highlightbackground=rc if st != "idle" else BD)
        self.create_rectangle(0, 0, w, s, fill=bg, outline="")

        # Ring geometry — square bounding box so arc is circular, not oval
        ring_h    = int(s * 0.68)          # vertical space for ring (top 68%)
        ring_m    = 16                     # margin
        diam      = min(w - 2*ring_m, ring_h - 2*ring_m)   # square side
        ax1       = cx - diam // 2
        ax2       = cx + diam // 2
        ay1       = ring_m
        ay2       = ring_m + diam
        cy_ring   = (ay1 + ay2) // 2
        ring_r    = diam // 2

        # Track
        self.create_arc(ax1, ay1, ax2, ay2,
                        start=90, extent=359.9,
                        style="arc", outline=BD if st=="idle" else lp(bg, rc, 0.3),
                        width=self.RW)
        # Fill
        if self._v > 0.003 or st == "running":
            ext = -max(4, int(359.9 * self._v))
            draw_col = rc
            if st == "running" and self._v < 0.04:
                draw_col = lp(BD, rc, 0.5 + 0.5*math.sin(self._t*4))
            self.create_arc(ax1, ay1, ax2, ay2,
                            start=90, extent=ext,
                            style="arc", outline=draw_col, width=self.RW)

        # Center text inside ring
        if   st == "idle":
            self.create_text(cx, cy_ring, text=str(self._num),
                             font=(FN, 22, "bold"), fill=T3, anchor="center")
        elif st == "running":
            tc2 = lp(T2, BLUE, 0.5 + 0.5*math.sin(self._t*3))
            self.create_text(cx, cy_ring, text=f"{int(self._v*100)}%",
                             font=(FN, 17, "bold"), fill=tc2, anchor="center")
        elif st == "done":
            self.create_text(cx, cy_ring, text="✔",
                             font=(FN, 22, "bold"), fill=GREEN, anchor="center")
        else:
            self.create_text(cx, cy_ring, text="✘",
                             font=(FN, 22, "bold"), fill=RED, anchor="center")

        # Labels sit below the ring with guaranteed clearance
        label_y  = ay2 + 14
        detail_y = ay2 + 28
        self.create_text(cx, label_y, text=self._lbl.upper(),
                         font=(FN, 8, "bold"), fill=tc, anchor="center")
        if self._det:
            short = self._det if len(self._det) <= 18 else self._det[:15]+"…"
            self.create_text(cx, detail_y, text=short,
                             font=(FN, 7), fill=T3, anchor="center")

    def set_running(self):
        self._state = "running"; self._tgt = 0.01
    def set_progress(self, p, d=""):
        self._tgt = max(0,min(1,p)); self._det = d
    def set_done(self, d=""):
        self._state = "done"; self._tgt = 1.0; self._det = d
    def set_error(self, d=""):
        self._state = "error"; self._det = d
    def reset(self):
        self._state = "idle"; self._v = self._tgt = 0.0; self._det = ""


# ══════════════════════════════════════════════════════════
#  Validated file input
# ══════════════════════════════════════════════════════════
class FileInput(tk.Frame):
    def __init__(self, parent, is_dir=False, **kw):
        super().__init__(parent, bg=S1, **kw)
        self._is_dir = is_dir
        self.var = tk.StringVar()
        self.var.trace_add("write", self._validate)

        row = tk.Frame(self, bg=S1)
        row.pack(fill="x")

        # Border frame around entry
        self._ef = tk.Frame(row, bg=S2, highlightbackground=BD,
                            highlightthickness=1)
        self._ef.pack(side="left", fill="x", expand=True)
        self._entry = tk.Entry(self._ef, textvariable=self.var,
                               bg=S2, fg=T1, font=F_MONO,
                               insertbackground=BLUE, relief="flat", bd=7)
        self._entry.pack(fill="x")
        self._entry.bind("<FocusIn>",
                         lambda _: self._ef.config(highlightbackground=BLUE))
        self._entry.bind("<FocusOut>", self._blur)

        # Browse button
        self._bb = tk.Frame(row, bg=BLUEDIM, cursor="hand2")
        self._bb.pack(side="left", padx=(8,0))
        self._bl = tk.Label(self._bb, text="  Browse  ",
                            font=(FN,9,"bold"), fg=BLUE, bg=BLUEDIM, pady=7)
        self._bl.pack()
        for w in (self._bb, self._bl):
            w.bind("<Button-1>", self._browse)
            w.bind("<Enter>", lambda _: [self._bb.config(bg=lp(BLUEDIM,BLUE,0.35)),
                                          self._bl.config(bg=lp(BLUEDIM,BLUE,0.35), fg=T0)])
            w.bind("<Leave>", lambda _: [self._bb.config(bg=BLUEDIM),
                                          self._bl.config(bg=BLUEDIM, fg=BLUE)])

        # Validation badge
        self._badge = tk.Label(row, text="  ", font=(FN,12), bg=S1, width=2)
        self._badge.pack(side="left", padx=(6,0))

    def _browse(self, _=None):
        p = (filedialog.askdirectory(title="Choose output folder") if self._is_dir
             else filedialog.askopenfilename(title="Select exefile.exe",
                  filetypes=[("Executable","*.exe"),("All files","*.*")]))
        if p: self.var.set(p)

    def _validate(self, *_):
        v = self.var.get().strip()
        if not v:
            self._set(None); return
        p = Path(v)
        ok = (p.parent.exists() or p.exists()) if self._is_dir else (p.exists() and p.is_file())
        self._set(ok)

    def _blur(self, _):
        col = GREEN if self._ok else (RED if self._ok is False else BD)
        self._ef.config(highlightbackground=col)

    def _set(self, ok):
        self._ok = ok
        if   ok is True:  self._badge.config(text="✔", fg=GREEN); self._ef.config(highlightbackground=GREEN)
        elif ok is False: self._badge.config(text="✘", fg=RED);   self._ef.config(highlightbackground=RED)
        else:             self._badge.config(text="  ");           self._ef.config(highlightbackground=BD)

    _ok = None


# ══════════════════════════════════════════════════════════
#  Animated START button
# ══════════════════════════════════════════════════════════
class StartBtn(tk.Canvas):
    def __init__(self, parent, cmd, **kw):
        super().__init__(parent, height=58, bg=BG,
                         highlightthickness=0, bd=0, **kw)
        self._cmd = cmd
        self._state = "ready"
        self._hover = False
        self._t = 0.0
        self._ripples = []
        self.bind("<Enter>",    lambda _: self._hover_set(True))
        self.bind("<Leave>",    lambda _: self._hover_set(False))
        self.bind("<Button-1>", self._click)
        self._tick()

    def _hover_set(self, v):
        if self._state == "ready":
            self._hover = v
            self.config(cursor="hand2" if v else "")

    def _click(self, e):
        if self._state == "ready" and self._cmd:
            self._ripples.append([e.x, e.y, self._t])
            self._cmd()

    def set_running(self): self._state = "running"; self._hover = False; self.config(cursor="")
    def set_ready(self):   self._state = "ready"
    def set_done(self):    self._state = "done"

    def _tick(self):
        self._t += 0.04
        self._ripples = [r for r in self._ripples if self._t - r[2] < 0.7]
        self._draw()
        self.after(20, self._tick)

    def _draw(self):
        self.delete("all")
        w = self.winfo_width() or 860
        h = self.winfo_height() or 58
        r = 10
        p = 0.5 + 0.5 * math.sin(self._t * 2.4)

        if self._state == "ready":
            fill  = lp(GREENM, GREEN, 0.1 + 0.2*p) if not self._hover else lp(GREENM, GREEN, 0.5)
            bord  = lp(GREENM, GREEN, 0.35 + 0.5*p)
            label = "▶   START EXTRACTION"
            tc    = T0
        elif self._state == "running":
            fill  = lp(BLUEDIM, "#0d2840", p * 0.25)
            bord  = lp(BLUEDIM, BLUE, p)
            label = "⏳   Extraction in progress…"
            tc    = BLUE
        else:
            fill  = lp(GREEND, "#073a16", p * 0.35)
            bord  = lp(GREENM, GREEN, p)
            label = "✔   Complete  —  Click to run again"
            tc    = GREEN

        # Outer glow
        for i in range(6, 0, -1):
            rr(self, i*2, i*1.5, w-i*2, h-i*1.5, r+3,
               fill=lp(BG, bord, i*0.07), outline="")

        # Body
        rr(self, 0, 0, w, h, r, fill=fill, outline=bord, width=2)
        # Top sheen
        rr(self, 2, 2, w-2, int(h*0.45), r-1,
           fill=lp(fill,"#ffffff",0.07), outline="")

        # Ripples
        for rx, ry, born in self._ripples:
            age  = self._t - born
            rad  = age * w * 1.4
            alp  = max(0, 1 - age/0.6)
            col  = lp(fill, T0, alp * 0.25)
            self.create_oval(rx-rad, ry-rad, rx+rad, ry+rad, outline=col, width=2)

        self.create_text(w//2, h//2, text=label, font=F_BTN, fill=tc, anchor="center")


# ══════════════════════════════════════════════════════════
#  Log console  (macOS-style header)
# ══════════════════════════════════════════════════════════
class Console(tk.Frame):
    def __init__(self, parent, **kw):
        super().__init__(parent, bg=S1, highlightbackground=BD,
                         highlightthickness=1, **kw)
        hdr = tk.Frame(self, bg=S2)
        hdr.pack(fill="x")
        for col in (RED, GOLD, GREEN):
            tk.Label(hdr, text="●", font=(FN,10), fg=col, bg=S2).pack(side="left", padx=(6,0), pady=5)
        tk.Label(hdr, text="  OUTPUT CONSOLE", font=F_SMALL,
                 fg=T3, bg=S2).pack(side="left")
        clr = tk.Label(hdr, text="Clear  ", font=F_SMALL,
                       fg=T3, bg=S2, cursor="hand2")
        clr.pack(side="right")
        clr.bind("<Button-1>", lambda _: self.clear())

        tk.Frame(self, bg=BD, height=1).pack(fill="x")

        self._txt = tk.Text(self, bg="#05080f", fg=T1, font=F_MONO,
                            relief="flat", bd=0, state="disabled",
                            wrap="word", height=1,
                            selectbackground=BDA, insertbackground=BLUE)
        sb = tk.Scrollbar(self, command=self._txt.yview,
                          bg=S2, troughcolor=BG, relief="flat", width=8)
        self._txt.config(yscrollcommand=sb.set)
        self._txt.pack(side="left", fill="both", expand=True, padx=(10,0), pady=6)
        sb.pack(side="right", fill="y", pady=4, padx=(0,3))

        for tag, fg_, font_ in [
            ("ok",    GREEN, None),
            ("warn",  GOLD,  None),
            ("err",   RED,   None),
            ("phase", BLUE,  (FN,9,"bold")),
            ("dim",   T3,    None),
            ("bold",  T0,    (FN,9,"bold")),
            ("norm",  T1,    None),
        ]:
            cfg = {"foreground": fg_}
            if font_: cfg["font"] = font_
            self._txt.tag_config(tag, **cfg)

    def write(self, text, tag="norm"):
        self._txt.config(state="normal")
        self._txt.insert("end", text+"\n", tag)
        self._txt.see("end")
        self._txt.config(state="disabled")

    def clear(self):
        self._txt.config(state="normal")
        self._txt.delete("1.0","end")
        self._txt.config(state="disabled")


# ══════════════════════════════════════════════════════════
#  Step card
# ══════════════════════════════════════════════════════════
class StepCard(tk.Frame):
    def __init__(self, parent, num, title, hint, is_dir=False, **kw):
        super().__init__(parent, bg=S1, **kw)

        # Gold left strip
        tk.Frame(self, width=4, bg=GOLD).pack(side="left", fill="y")

        # Badge
        badge = tk.Frame(self, bg=S1, width=52)
        badge.pack(side="left", fill="y")
        badge.pack_propagate(False)
        c = tk.Canvas(badge, width=52, height=52, bg=S1, highlightthickness=0)
        c.pack(expand=True)
        c.create_polygon(26,4, 48,26, 26,48, 4,26, fill=GOLD, outline=GOLDD, width=1)
        c.create_polygon(26,14, 38,26, 26,38, 14,26, fill=GOLDD, outline="")
        c.create_text(26, 26, text=str(num), font=(FN,13,"bold"), fill=T0)

        # Content
        content = tk.Frame(self, bg=S1)
        content.pack(side="left", fill="both", expand=True, padx=(4,16), pady=12)

        top = tk.Frame(content, bg=S1)
        top.pack(fill="x")
        tk.Label(top, text=title, font=F_H1, fg=T0, bg=S1).pack(side="left")
        tk.Label(top, text=f"  {hint}", font=F_HINT, fg=T3, bg=S1).pack(side="left")

        self.input = FileInput(content, is_dir=is_dir)
        self.input.pack(fill="x", pady=(8,0))


# ══════════════════════════════════════════════════════════
#  Connecting arrow between phase cards
# ══════════════════════════════════════════════════════════
class Arrow(tk.Canvas):
    def __init__(self, parent, **kw):
        super().__init__(parent, width=32, height=168, bg=BG,
                         highlightthickness=0, bd=0, **kw)
        self._lit = False
        self._t   = 0.0
        self._tick()

    def light(self): self._lit = True

    def _tick(self):
        self._t += 0.06
        self.delete("all")
        w, h = 32, 148
        col = lp(BD, BLUE, 0.5 + 0.5*math.sin(self._t*2)) if self._lit else BD
        mx = w // 2
        my = h // 2
        # Line
        self.create_line(mx, my-10, mx, my+10, fill=col, width=2)
        # Arrow head
        self.create_polygon(mx-6, my+4, mx+6, my+4, mx, my+14,
                            fill=col, outline="")
        self.after(40, self._tick)


# ══════════════════════════════════════════════════════════
#  Workers — custom animated slider + step buttons
# ══════════════════════════════════════════════════════════
class _SliderBtn(tk.Canvas):
    """Minimal glowing ± button for the workers slider."""
    SZ = 30
    def __init__(self, parent, glyph, cmd, **kw):
        super().__init__(parent, width=self.SZ, height=self.SZ,
                         bg=S1, highlightthickness=0, cursor="hand2", **kw)
        self._glyph = glyph
        self._cmd   = cmd
        self._state = "idle"   # idle | hover | press
        self.bind("<Enter>",           lambda e: self._set("hover"))
        self.bind("<Leave>",           lambda e: self._set("idle"))
        self.bind("<ButtonPress-1>",   lambda e: self._set("press"))
        self.bind("<ButtonRelease-1>", lambda e: (self._cmd(), self._set("hover")))
        self._draw()

    def _set(self, s):
        self._state = s
        self._draw()

    def _draw(self):
        self.delete("all")
        sz = self.SZ
        if self._state == "press":
            fill, tc, bc = lp(BLUEDIM, BLUE, 0.3), BLUE,  BLUE
        elif self._state == "hover":
            fill, tc, bc = lp(S2, BLUEDIM, 0.6),  BLUE,  BDA
        else:
            fill, tc, bc = S2,                     T3,    BD
        self.create_rectangle(1, 1, sz-1, sz-1, fill=fill, outline=bc)
        self.create_text(sz//2, sz//2+1, text=self._glyph,
                         font=(FN, 15, "bold"), fill=tc, anchor="center")


class WorkersSlider(tk.Canvas):
    """Fully custom animated horizontal slider, 1‥max_w."""
    H   = 62
    _TY = 24   # track Y centre inside canvas
    _PAD = 20  # horizontal padding

    def __init__(self, parent, default, max_w=16, **kw):
        self.MAX_W = max_w
        super().__init__(parent, bg=S1, height=self.H,
                         highlightthickness=0, cursor="hand2", **kw)
        self._v     = default
        self._hover = False
        self._drag  = False
        self._glow  = 0.35
        self._t     = 0.0
        self._cbs   = []

        self.bind("<Configure>",       lambda e: self._draw())
        self.bind("<ButtonPress-1>",   self._on_press)
        self.bind("<B1-Motion>",       self._on_drag)
        self.bind("<ButtonRelease-1>", self._on_release)
        self.bind("<Enter>",           lambda e: self._set_hover(True))
        self.bind("<Leave>",           lambda e: self._set_hover(False))
        self.bind("<Left>",            lambda e: self._step(-1))
        self.bind("<Right>",           lambda e: self._step(1))
        self._tick()

    def _set_hover(self, v):
        self._hover = v

    def _tick(self):
        self._t += 0.06
        target = 1.0 if (self._hover or self._drag) else 0.38
        self._glow += (target - self._glow) * 0.10
        self._draw()
        self.after(20, self._tick)

    # ── geometry helpers ───────────────────────────────
    def _tx(self):
        w = self.winfo_width() or 400
        return self._PAD, w - self._PAD, self._TY

    def _v2x(self, v):
        x1, x2, _ = self._tx()
        return x1 + (v - 1) / (self.MAX_W - 1) * (x2 - x1)

    def _x2v(self, x):
        x1, x2, _ = self._tx()
        frac = (x - x1) / (x2 - x1)
        return max(1, min(self.MAX_W, round(1 + frac * (self.MAX_W - 1))))

    # ── rendering ──────────────────────────────────────
    def _draw(self):
        self.delete("all")
        w         = self.winfo_width() or 400
        x1, x2, ty = self._tx()
        tx        = self._v2x(self._v)
        g         = self._glow
        th        = 3   # track half-height

        # Background
        self.create_rectangle(0, 0, w, self.H, fill=S1, outline="")

        # Track groove (full)
        self.create_rectangle(x1, ty-th, x2, ty+th, fill=S2, outline=BD, width=1)

        # Filled track (active portion)
        self.create_rectangle(x1, ty-th, tx, ty+th,
                              fill=lp(BLUEDIM, BLUE, g * 0.8), outline="")

        # Tick marks + key labels
        for i in range(1, self.MAX_W + 1):
            ix   = self._v2x(i)
            big  = (i % 4 == 0) or i == 1 or i == self.MAX_W
            h    = 8 if big else 4
            col  = lp(BD, BLUE, g * 0.85) if i <= self._v else T4
            self.create_line(ix, ty + th + 2, ix, ty + th + 2 + h, fill=col, width=1)
            if big:
                lc = lp(T3, T2, g) if i <= self._v else T3
                self.create_text(ix, ty + th + h + 12,
                                 text=str(i), font=(FN, 7), fill=lc, anchor="center")

        # Thumb glow rings (outermost first so inner overwrites)
        tr = int(11 + g * 4)
        for rr, strength in ((tr+14, 0.055), (tr+9, 0.13), (tr+4, 0.26)):
            gc = lp(S1, BLUE, g * strength)
            self.create_oval(tx-rr, ty-rr, tx+rr, ty+rr, fill=gc, outline="")

        # Thumb body
        self.create_oval(tx-tr, ty-tr, tx+tr, ty+tr,
                         fill=lp(S2, "#0a1f3a", 1.0),
                         outline=lp(BDA, BLUE, g), width=2)

        # Thumb inner bright dot
        ir = max(2, int(tr * 0.28))
        self.create_oval(tx-ir, ty-ir, tx+ir, ty+ir,
                         fill=lp(BDA, BLUE, g), outline="")

        # Subtle top-left shine on thumb
        self.create_oval(tx - int(tr*0.55), ty - int(tr*0.65),
                         tx + int(tr*0.15), ty - int(tr*0.1),
                         fill=lp(S2, "#ffffff", g * 0.08), outline="")

    # ── interaction ────────────────────────────────────
    def _on_press(self, e):
        self.focus_set()
        self._drag = True
        self._update(e.x)

    def _on_drag(self, e):
        self._update(e.x)

    def _on_release(self, e):
        self._drag = False

    def _update(self, x):
        nv = self._x2v(x)
        if nv != self._v:
            self._v = nv
            for cb in self._cbs: cb(nv)

    def _step(self, d):
        nv = max(1, min(self.MAX_W, self._v + d))
        if nv != self._v:
            self._v = nv
            for cb in self._cbs: cb(nv)

    def on_change(self, cb): self._cbs.append(cb)

    @property
    def value(self): return self._v


class WorkersRow(tk.Frame):
    def __init__(self, parent, **kw):
        super().__init__(parent, bg=S1, **kw)
        tk.Frame(self, width=4, bg=BLUE).pack(side="left", fill="y")

        inner = tk.Frame(self, bg=S1)
        inner.pack(fill="both", expand=True, padx=16, pady=10)

        ncpu      = os.cpu_count() or 4
        default_w = min(max(ncpu, 4), ncpu)

        # Header
        hdr = tk.Frame(inner, bg=S1)
        hdr.pack(fill="x", pady=(0, 6))
        tk.Label(hdr, text="PARALLEL WORKERS", font=(FN, 9, "bold"),
                 fg=T2, bg=S1).pack(side="left")
        tk.Label(hdr, text=f"  ·  {ncpu} logical CPUs detected  ·  higher = faster",
                 font=F_HINT, fg=T3, bg=S1).pack(side="left")

        self._val_lbl = tk.Label(hdr, text=str(default_w),
                                  font=(FN, 18, "bold"), fg=GOLD, bg=S1)
        self._val_lbl.pack(side="right")
        tk.Label(hdr, text="workers  ", font=F_HINT, fg=T3, bg=S1).pack(side="right")

        # Slider + ± buttons
        row = tk.Frame(inner, bg=S1)
        row.pack(fill="x")

        self._minus = _SliderBtn(row, "−", lambda: self._slider._step(-1))
        self._minus.pack(side="left", padx=(0, 8))

        self._slider = WorkersSlider(row, default_w, max_w=ncpu)
        self._slider.pack(side="left", fill="x", expand=True)
        self._slider.on_change(self._on_change)

        self._plus = _SliderBtn(row, "+", lambda: self._slider._step(1))
        self._plus.pack(side="left", padx=(8, 0))

    def _on_change(self, v):
        self._val_lbl.config(text=str(v))

    @property
    def value(self): return self._slider.value


# ══════════════════════════════════════════════════════════
#  Status bar
# ══════════════════════════════════════════════════════════
class StatusBar(tk.Frame):
    def __init__(self, parent, **kw):
        super().__init__(parent, bg=S2, height=28, **kw)
        tk.Frame(self, width=3, bg=BLUE).pack(side="left", fill="y")
        self._lbl = tk.Label(self, text="Ready  —  configure your paths and press Start",
                             font=F_SMALL, fg=T3, bg=S2, anchor="w")
        self._lbl.pack(side="left", padx=12, fill="x", expand=True)
        self._right = tk.Label(self, text="", font=F_SMALL, fg=T3, bg=S2)
        self._right.pack(side="right", padx=12)

    def set(self, text, right=""):
        self._lbl.config(text=text)
        self._right.config(text=right)


# ══════════════════════════════════════════════════════════
#  Main application
# ══════════════════════════════════════════════════════════
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("EVE Client Code Grabber")
        self.configure(bg=BG)
        self.resizable(True, True)
        self.minsize(800, 720)
        self._q = queue.Queue()
        self._running = False
        self._build()
        self._poll()
        self.update_idletasks()
        W, H = 960, 940
        self.geometry(f"{W}x{H}+{(self.winfo_screenwidth()-W)//2}+{(self.winfo_screenheight()-H)//2}")

    # ── Layout ────────────────────────────────────────────
    def _build(self):
        self.rowconfigure(1, weight=1)
        self.columnconfigure(0, weight=1)

        # Row 0: everything fixed-height (header + config + button + phases)
        top = tk.Frame(self, bg=BG)
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(0, weight=1)
        self._build_top(top)

        # Row 1: log (expands)
        bot = tk.Frame(self, bg=BG)
        bot.grid(row=1, column=0, sticky="nsew")
        bot.rowconfigure(0, weight=1)
        bot.columnconfigure(0, weight=1)

        self._console = Console(bot)
        self._console.grid(row=0, column=0, sticky="nsew", padx=18, pady=(6,0))

        self._statusbar = StatusBar(self)
        self._statusbar.grid(row=2, column=0, sticky="ew")
        self.rowconfigure(2, weight=0)

    def _build_top(self, p):
        P = dict(padx=18, pady=5)

        # Header
        Header(p).pack(fill="x")
        tk.Frame(p, bg=S2, height=1).pack(fill="x")

        # Step 1
        self._s1 = StepCard(p, 1, "EVE Client",
                            "Select the exefile.exe in your EVE installation",
                            is_dir=False)
        self._s1.input.var.set(DEFAULT_EXE)
        self._s1.pack(fill="x", **P)

        # Step 2
        self._s2 = StepCard(p, 2, "Output Folder",
                            "Where to save the extracted .py files",
                            is_dir=True)
        self._s2.input.var.set(DEFAULT_OUT)
        self._s2.pack(fill="x", **P)

        # Step 3: workers
        self._workers = WorkersRow(p)
        self._workers.pack(fill="x", **P)

        # Divider
        tk.Frame(p, bg=S2, height=1).pack(fill="x", padx=18, pady=(8,0))

        # START button
        self._btn = StartBtn(p, cmd=self._start)
        self._btn.pack(fill="x", padx=18, pady=10)

        # Divider
        tk.Frame(p, bg=S2, height=1).pack(fill="x", padx=18)

        # Phase row
        ph_outer = tk.Frame(p, bg=BG)
        ph_outer.pack(fill="x", padx=18, pady=12)
        tk.Label(ph_outer, text="PIPELINE", font=(FN,8,"bold"),
                 fg=T3, bg=BG).pack(anchor="w", pady=(0,8))

        ph_row = tk.Frame(ph_outer, bg=BG)
        ph_row.pack(fill="x")

        labels = ["Extract", "Decompress", "Decompile", "Cleanup"]
        self._phases = []
        self._arrows = []
        for i, lbl in enumerate(labels):
            card = PhaseCard(ph_row, i+1, lbl)
            card.pack(side="left", expand=True, fill="x")
            self._phases.append(card)
            if i < len(labels)-1:
                arr = Arrow(ph_row)
                arr.pack(side="left")
                self._arrows.append(arr)

        # Divider before log
        tk.Frame(p, bg=S2, height=1).pack(fill="x", padx=18, pady=(4,0))

    # ── Events ────────────────────────────────────────────
    def _start(self):
        if self._running: return
        exe = self._s1.input.var.get().strip()
        out = self._s2.input.var.get().strip()
        if not exe or not Path(exe).exists():
            self._console.write("✘  exefile.exe not found — use Browse to locate it.", "err")
            self._statusbar.set("Error: exefile.exe not found", "")
            return
        self._running = True
        for ph in self._phases: ph.reset()
        for ar in self._arrows:  ar._lit = False
        self._console.clear()
        self._btn.set_running()
        self._statusbar.set("Running…", "")
        threading.Thread(target=self._pipeline,
                         args=(exe, out, self._workers.value),
                         daemon=True).start()

    # ── Queue polling ─────────────────────────────────────
    def _poll(self):
        try:
            while True: self._handle(self._q.get_nowait())
        except queue.Empty: pass
        self.after(25, self._poll)

    def _handle(self, m):
        t = m["type"]
        if t == "log":
            self._console.write(m["text"], m.get("tag","norm"))
        elif t == "phase_start":
            i = m["i"]
            self._phases[i].set_running()
            self._console.write(f"── Phase {i+1}: {m['lbl']} ──", "phase")
            if i > 0: self._arrows[i-1].light()
        elif t == "phase_prog":
            self._phases[m["i"]].set_progress(m["p"], m.get("d",""))
        elif t == "phase_done":
            self._phases[m["i"]].set_done(m.get("d",""))
            self._console.write(f"  ✔  {m.get('d','')}", "ok")
        elif t == "phase_err":
            self._phases[m["i"]].set_error(m.get("d",""))
            self._console.write(f"  ✘  {m.get('d','')}", "err")
        elif t == "status":
            self._statusbar.set(m["text"], m.get("right",""))
        elif t == "done":
            self._running = False
            self._btn.set_done()
            self._console.write("", "norm")
            self._console.write("━"*60, "dim")
            self._console.write(m.get("summary","Complete."), "bold")
            self._console.write("━"*60, "dim")
            self._statusbar.set(m.get("summary","Complete."), "")

    def _put(self, **kw): self._q.put(kw)

    # ── Pipeline ──────────────────────────────────────────
    def _pipeline(self, exe_path, out_dir_str, workers):
        exe     = Path(exe_path)
        out     = Path(out_dir_str)
        t_start = time.time()

        def find_ccp():
            for p in [exe.parent.parent/"code.ccp", exe.parent/"code.ccp"]:
                if p.exists(): return p
            return None

        ccp = find_ccp()
        if not ccp:
            self._put(type="phase_err", i=0, d="code.ccp not found near exefile.exe")
            self._put(type="done", summary="Aborted — code.ccp not found.")
            return

        self._put(type="log", text=f"  Source  →  {ccp}", tag="dim")
        self._put(type="log", text=f"  Output  →  {out}", tag="dim")

        if out.exists():
            self._put(type="log", text="  Clearing previous output…", tag="dim")
            shutil.rmtree(out)
        out.mkdir(parents=True, exist_ok=True)

        # ── Phase 0: Extract  (read ZIP → decompress in memory → write .pyc) ──
        # Skipping .pyj to disk entirely saves a full read/write round-trip.
        self._put(type="phase_start", i=0, lbl="Extract")
        t0 = time.time()
        try:
            with zipfile.ZipFile(str(ccp)) as zf:
                entries = [e for e in zf.namelist() if e.endswith(".pyj")]
                N = len(entries)
                if not N:
                    self._put(type="phase_err", i=0, d="No .pyj entries found")
                    self._put(type="done", summary="Aborted — empty archive."); return
                # Read all compressed data into memory while ZIP is open
                raw_data = {}
                for idx, entry in enumerate(entries, 1):
                    raw_data[entry] = zf.read(entry)
                    if idx % 200 == 0 or idx == N:
                        self._put(type="phase_prog", i=0, p=idx/N, d=f"{idx:,}/{N:,} read")
            self._put(type="phase_done", i=0, d=f"{N:,} entries read  ({time.time()-t0:.1f}s)")
        except Exception as e:
            self._put(type="phase_err", i=0, d=str(e))
            self._put(type="done", summary=f"Aborted: {e}"); return

        # ── Phase 1: Decompress (parallel, in-memory → write .pyc) ───────────
        self._put(type="phase_start", i=1, lbl="Decompress")
        t0 = time.time()
        ok1 = fail1 = 0
        lock1 = threading.Lock()

        def decomp_one(entry):
            pyc = (out / entry).with_suffix(".pyc")
            try:
                data = zlib.decompress(raw_data[entry])
                pyc.parent.mkdir(parents=True, exist_ok=True)
                pyc.write_bytes(data)
                return True
            except Exception:
                return False

        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(decomp_one, e): e for e in entries}
            for idx, fut in enumerate(as_completed(futs), 1):
                if fut.result(): ok1 += 1
                else: fail1 += 1
                if idx % 200 == 0 or idx == N:
                    self._put(type="phase_prog", i=1, p=idx/N,
                              d=f"{ok1:,} ok  {fail1} fail")
        del raw_data  # free memory
        self._put(type="phase_done", i=1,
                  d=f"{ok1:,} ok  {fail1} fail  ({time.time()-t0:.1f}s)")

        # ── Phase 2: Decompile (ProcessPool for true parallelism) ─────────────
        self._put(type="phase_start", i=2, lbl="Decompile")
        t0 = time.time()
        unc = shutil.which("uncompyle6")
        if not unc:
            import sysconfig
            user_scripts = Path(sysconfig.get_path("scripts", "nt_user"))
            for cand in [str(Path(sys.executable).parent/"Scripts"/"uncompyle6.exe"),
                         str(Path(sys.executable).parent/"Scripts"/"uncompyle6"),
                         str(user_scripts/"uncompyle6.exe"),
                         str(user_scripts/"uncompyle6")]:
                if os.path.exists(cand): unc = cand; break
        if not unc:
            self._put(type="phase_err", i=2, d="uncompyle6 missing  (pip install uncompyle6)")
            self._put(type="done", summary="Aborted — install uncompyle6."); return

        self._put(type="log", text=f"  uncompyle6: {unc}", tag="dim")
        self._put(type="log", text=f"  Workers: {workers}  (ProcessPool — true parallelism)", tag="dim")

        pyc_list = [e for e in entries if (out/e).with_suffix(".pyc").exists()]
        DC = len(pyc_list); ok2 = fail2 = 0; fails = []

        # Build args list: (pyc_path_str, py_path_str, unc_cmd)
        task_args = [
            (str((out/e).with_suffix(".pyc")),
             str((out/e).with_suffix(".py")),
             unc)
            for e in pyc_list
        ]

        # ProcessPoolExecutor bypasses the GIL for CPU-bound uncompyle6 work
        try:
            PoolCls = ProcessPoolExecutor
        except Exception:
            PoolCls = ThreadPoolExecutor  # fallback

        with PoolCls(max_workers=workers) as pool:
            futs = {pool.submit(_decompile_worker, args): pyc_list[i]
                    for i, args in enumerate(task_args)}
            for idx, fut in enumerate(as_completed(futs), 1):
                try:
                    ok, err = fut.result()
                except Exception as ex:
                    ok, err = False, str(ex)
                e = futs[fut]
                if ok: ok2 += 1
                else:
                    fail2 += 1; fails.append((e, err))
                    if fail2 <= 5:
                        self._put(type="log", text=f"  ✘  {Path(e).name}  {err[:55]}", tag="warn")
                if idx % 100 == 0 or idx == DC:
                    self._put(type="phase_prog", i=2, p=idx/DC,
                              d=f"{ok2:,} ok  {fail2} fail")
                    self._put(type="status",
                              text=f"Decompiling…  {idx:,}/{DC:,}",
                              right=f"✔{ok2:,}  ✘{fail2}")

        self._put(type="phase_done", i=2,
                  d=f"{ok2:,} ok  {fail2} fail  ({time.time()-t0:.1f}s)")
        if fails:
            lp_ = out/"_decompile_errors.log"
            lp_.write_text("\n".join(f"{e}: {err}" for e,err in fails))
            self._put(type="log", text=f"  Error log → {lp_}", tag="dim")

        # ── Phase 3: Cleanup ──────────────────────────────
        self._put(type="phase_start", i=3, lbl="Cleanup")
        tmp = [f for f in out.rglob("*") if f.is_file() and f.suffix != ".py"]
        TT = len(tmp); freed = 0
        for idx, f in enumerate(tmp, 1):
            freed += f.stat().st_size; f.unlink()
            if idx % 150 == 0 or idx == TT:
                self._put(type="phase_prog", i=3, p=idx/max(TT,1), d=f"{idx:,} removed")
        for d in sorted(out.rglob("*"), reverse=True):
            if d.is_dir() and not any(d.iterdir()): d.rmdir()
        self._put(type="phase_done", i=3,
                  d=f"{TT:,} removed  ({freed/1048576:.1f} MB freed)")

        # ── Done ──────────────────────────────────────────
        py_count = sum(1 for _ in out.rglob("*.py"))
        elapsed  = time.time() - t_start
        summary  = (f"  ✔  {py_count:,} Python files extracted  |  "
                    f"Decompile: {ok2:,} ok / {fail2} failed  |  {elapsed:.1f}s")
        self._put(type="status", text=summary.strip(), right="")
        self._put(type="done",   summary=summary)


# ══════════════════════════════════════════════════════════
if __name__ == "__main__":
    App().mainloop()
