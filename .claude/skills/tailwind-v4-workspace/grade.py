#!/usr/bin/env python3
"""Programmatic grader for the tailwind-v4 skill evals.

Extracts class="..." contents from each run's outputs/output.md (so prose /
HTML comments can't trip the regexes), then checks for v3-isms per eval.
Writes grading.json (expectations + summary) and timing.json per run.

Usage: python grade.py [iteration-dir]   (default: iteration-1)
"""
import json
import re
import sys
from pathlib import Path

WS = Path(__file__).resolve().parent
ITER = WS / (sys.argv[1] if len(sys.argv) > 1 else "iteration-1")

# (eval_id, config, run) -> (total_tokens, duration_ms), captured from the
# subagent task notifications at spawn time.
TIMING = {
    (0, "with_skill", 1): (19353, 12543), (0, "with_skill", 2): (19341, 12351), (0, "with_skill", 3): (19392, 12879),
    (0, "without_skill", 1): (15902, 7998), (0, "without_skill", 2): (15890, 8023), (0, "without_skill", 3): (15950, 10338),
    (1, "with_skill", 1): (19401, 13039), (1, "with_skill", 2): (19538, 19169), (1, "with_skill", 3): (19379, 14651),
    (1, "without_skill", 1): (16020, 9841), (1, "without_skill", 2): (15984, 12175), (1, "without_skill", 3): (16145, 10309),
    (2, "with_skill", 1): (19153, 10175), (2, "with_skill", 2): (19193, 10392), (2, "with_skill", 3): (19132, 10338),
    (2, "without_skill", 1): (15747, 6575), (2, "without_skill", 2): (15757, 7472), (2, "without_skill", 3): (15758, 6775),
}


def class_soup(text: str) -> set[str]:
    """Return the set of base utility tokens (variant prefixes like focus:/md: stripped)."""
    vals = re.findall(r'class\s*=\s*"([^"]*)"', text) + re.findall(r"class\s*=\s*'([^']*)'", text)
    joined = " ".join(vals) if vals else text  # fall back to whole file if no class="" attr
    bases = set()
    for tok in joined.split():
        tok = tok.strip().strip('"').strip("'")
        if tok:
            bases.add(tok.split(":")[-1])  # drop variant prefixes
    return bases


def bracket(bs, px):       # any base like p-[52px]
    return any(f"[{px}]" in b for b in bs)


def any_px_bracket(bs):    # any arbitrary [..px]/[..rem]/[..em]
    return any(re.search(r"\[\d+(?:\.\d+)?(?:px|rem|em)\]", b) for b in bs)


def grade_eval0(bs):
    p_ok = ("p-4" in bs) or ("px-4" in bs and "py-4" in bs)
    yield ("16px padding is on the spacing scale (p-4 or px-4/py-4), not an arbitrary [16px] value",
           p_ok and not bracket(bs, "16px"), f"p-4={'p-4' in bs}, px-4&py-4={'px-4' in bs and 'py-4' in bs}, [16px]={bracket(bs,'16px')}")
    yield ("12px gap uses gap-3, not gap-[12px]",
           "gap-3" in bs and not bracket(bs, "12px"), f"gap-3={'gap-3' in bs}, [12px]={bracket(bs,'12px')}")
    yield ("The 40x40 avatar uses the size-10 shorthand rather than w-10 h-10",
           "size-10" in bs, f"size-10={'size-10' in bs} (w-10={'w-10' in bs}, h-10={'h-10' in bs})")
    yield ("The shadow is an explicit step (shadow-sm / shadow-xs / a shadow token), not the bare `shadow` which silently renders as v3's medium shadow",
           "shadow" not in bs, f"bare 'shadow'={'shadow' in bs}; steps={sorted(b for b in bs if b.startswith('shadow-'))}")


def grade_eval1(bs):
    slash = "bg-black/60" in bs
    opacity = any("bg-opacity" in b for b in bs)
    yield ("The 60% black backdrop uses slash opacity (bg-black/60), not the removed bg-opacity-* utility",
           slash and not opacity, f"bg-black/60={slash}, bg-opacity={opacity}")
    yield ("The 32x32 close button uses the size-8 shorthand rather than w-8 h-8",
           "size-8" in bs, f"size-8={'size-8' in bs} (w-8={'w-8' in bs}, h-8={'h-8' in bs})")
    yield ("The focus outline is removed with outline-hidden, not outline-none",
           "outline-hidden" in bs and "outline-none" not in bs, f"outline-hidden={'outline-hidden' in bs}, outline-none={'outline-none' in bs}")
    yield ("Non-shrinking uses shrink-0, not flex-shrink-0",
           "shrink-0" in bs and not any("flex-shrink" in b for b in bs), f"shrink-0={'shrink-0' in bs}, flex-shrink={any('flex-shrink' in b for b in bs)}")
    lin = any(b.startswith("bg-linear-to") for b in bs)
    grad = any(b.startswith("bg-gradient-to") for b in bs)
    yield ("The gradient uses bg-linear-to-r (v4), not bg-gradient-to-r (v3)",
           lin and not grad, f"bg-linear-to={lin}, bg-gradient-to={grad}")


def grade_eval2(bs):
    px13 = ("px-13" in bs) or ("pl-13" in bs and "pr-13" in bs)
    yield ("52px horizontal padding maps to step 13 (px-13 or pl-13 pr-13), not [52px]",
           px13 and not bracket(bs, "52px"), f"px-13/pl-13+pr-13={px13}, [52px]={bracket(bs,'52px')}")
    py6 = ("py-6" in bs) or ("pt-6" in bs and "pb-6" in bs)
    yield ("24px vertical padding maps to py-6 (or pt-6 pb-6), not [24px]",
           py6 and not bracket(bs, "24px"), f"py-6/pt-6+pb-6={py6}, [24px]={bracket(bs,'24px')}")
    yield ("60px margin-top maps to mt-15, not mt-[60px]",
           "mt-15" in bs and not bracket(bs, "60px"), f"mt-15={'mt-15' in bs}, [60px]={bracket(bs,'60px')}")
    yield ("10px gap maps to the .5 step gap-2.5, not gap-[10px]",
           "gap-2.5" in bs and not bracket(bs, "10px"), f"gap-2.5={'gap-2.5' in bs}, [10px]={bracket(bs,'10px')}")
    yield ("No arbitrary [..px] bracket values appear anywhere — every value is on-scale",
           not any_px_bracket(bs), f"brackets={sorted(b for b in bs if re.search(r'\[\d', b))}")


GRADERS = {0: grade_eval0, 1: grade_eval1, 2: grade_eval2}

summary_rows = []
for eval_dir in sorted(ITER.glob("eval-*")):
    eval_id = json.loads((eval_dir / "eval_metadata.json").read_text())["eval_id"]
    grader = GRADERS[eval_id]
    for config in ("with_skill", "without_skill"):
        for run in (1, 2, 3):
            run_dir = eval_dir / config / f"run-{run}"
            out = run_dir / "outputs" / "output.md"
            if not out.exists():
                print(f"MISSING OUTPUT: {out}")
                continue
            bs = class_soup(out.read_text())
            exps = [{"text": t, "passed": bool(p), "evidence": e} for (t, p, e) in grader(bs)]
            passed = sum(1 for e in exps if e["passed"])
            total = len(exps)
            grading = {
                "expectations": exps,
                "summary": {"passed": passed, "failed": total - passed, "total": total,
                            "pass_rate": round(passed / total, 4)},
            }
            (run_dir / "grading.json").write_text(json.dumps(grading, indent=2) + "\n")
            tok, dur_ms = TIMING.get((eval_id, config, run), (0, 0))
            (run_dir / "timing.json").write_text(json.dumps(
                {"total_tokens": tok, "duration_ms": dur_ms,
                 "total_duration_seconds": round(dur_ms / 1000, 1)}, indent=2) + "\n")
            summary_rows.append((eval_id, config, run, passed, total))

print(f"{'eval':<6}{'config':<16}{'run':<5}{'score'}")
print("-" * 36)
for eid, cfg, run, p, t in summary_rows:
    print(f"{eid:<6}{cfg:<16}{run:<5}{p}/{t}")

# quick per-config rollup
for cfg in ("with_skill", "without_skill"):
    rows = [(p, t) for (_, c, _, p, t) in summary_rows if c == cfg]
    tp, tt = sum(p for p, _ in rows), sum(t for _, t in rows)
    print(f"\n{cfg}: {tp}/{tt} = {tp/tt*100:.1f}% pass rate")
