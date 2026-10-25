#!/usr/bin/env python3
"""Keep the AI-on consent script and team notice in the bundle identical to web/lib/talk/policy.ts.

The words a judge reads aloud (CONSENT_SCRIPT) and a team reads (TEAM_NOTICE) live in one place in production,
web/lib/talk/policy.ts. components/bundle.js carries a copy so the previews are standalone: the two strings between the
`@policy:begin` and `@policy:end` markers, which this script writes and nothing else should. It also writes
components/policy.snapshot.json, which the test suite compares the bundle with (the suite is served from this folder and
cannot read ../web).

    python3 scripts/sync_policy.py           # rewrite the bundle's two strings and the snapshot from policy.ts
    python3 scripts/sync_policy.py --check   # change nothing; exit 1 (and say why) if the bundle or the snapshot drifted

build_previews.py runs --check (generate_component_docs.py does not), so a policy change in web/ cannot ship unnoticed. Without
../web (this folder on its own) the check is skipped and the snapshot stays as it is.

Not in policy.ts yet, so still preview-only in the bundle: the AI-off variant, the per-processor `sends` lists and the
retention line (see "Followups" in the design-system report). Add them to policy.ts, then extend POLICY_CONSTANTS below.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POLICY = os.path.join(ROOT, "..", "web", "lib", "talk", "policy.ts")
BUNDLE = os.path.join(ROOT, "components", "bundle.js")
SNAPSHOT = os.path.join(ROOT, "components", "policy.snapshot.json")

# policy.ts export name -> (bundle variable, snapshot key)
POLICY_CONSTANTS = {
    "CONSENT_SCRIPT": ("POLICY_SCRIPT", "consentScript"),
    "TEAM_NOTICE": ("POLICY_NOTICE", "teamNotice"),
}
BEGIN, END = "// @policy:begin", "// @policy:end"


def ts_string(src, name):
    """The value of `export const NAME = "..."` (one double-quoted literal; JS and JSON agree on its escapes)."""
    m = re.search(r"export const %s\s*=\s*(\"(?:[^\"\\\n]|\\.)*\")" % re.escape(name), src)
    if not m:
        raise SystemExit("sync_policy: %s is not a double-quoted string constant in %s" % (name, POLICY))
    return json.loads(m.group(1))


def read_policy():
    with open(POLICY, encoding="utf-8") as f:
        src = f.read()
    return {name: ts_string(src, name) for name in POLICY_CONSTANTS}


def bundle_block(values):
    lines = ["    " + BEGIN]
    for name, (var, _key) in POLICY_CONSTANTS.items():
        lines.append("    var %s = %s;" % (var, json.dumps(values[name], ensure_ascii=False)))
    lines.append("    " + END)
    return "\n".join(lines)


def bundle_values():
    with open(BUNDLE, encoding="utf-8") as f:
        src = f.read()
    a, b = src.find(BEGIN), src.find(END)
    if a < 0 or b < a:
        raise SystemExit("sync_policy: the @policy markers are missing from bundle.js")
    block = src[a:b]
    out = {}
    for name, (var, _key) in POLICY_CONSTANTS.items():
        m = re.search(r"var %s = (\"(?:[^\"\\\n]|\\.)*\");" % var, block)
        if not m:
            raise SystemExit("sync_policy: %s is missing between the markers in bundle.js" % var)
        out[name] = json.loads(m.group(1))
    return src, out


def snapshot_of(values):
    d = {"source": "web/lib/talk/policy.ts"}
    for name, (_var, key) in POLICY_CONSTANTS.items():
        d[key] = values[name]
    return json.dumps(d, indent=1, ensure_ascii=False) + "\n"


def main():
    check = "--check" in sys.argv[1:]
    if not os.path.exists(POLICY):
        print("sync_policy: %s not found; skipped (the snapshot stays as it is)" % os.path.relpath(POLICY, ROOT))
        return 0
    want = read_policy()
    src, have = bundle_values()
    snap_want = snapshot_of(want)
    try:
        with open(SNAPSHOT, encoding="utf-8") as f:
            snap_have = f.read()
    except FileNotFoundError:
        snap_have = ""
    drift = [n for n in POLICY_CONSTANTS if have[n] != want[n]]
    if check:
        if drift or snap_have != snap_want:
            for n in drift:
                print("sync_policy: bundle.js %s differs from web/lib/talk/policy.ts %s" % (POLICY_CONSTANTS[n][0], n))
            if snap_have != snap_want:
                print("sync_policy: components/policy.snapshot.json is out of date")
            print("sync_policy: run python3 scripts/sync_policy.py")
            return 1
        print("sync_policy: bundle.js and the snapshot match web/lib/talk/policy.ts")
        return 0
    a, b = src.find(BEGIN), src.find(END) + len(END)
    # keep the indentation of the first marker line
    start = src.rfind("\n", 0, a) + 1
    new_src = src[:start] + bundle_block(want) + src[b:]
    if new_src != src:
        with open(BUNDLE, "w", encoding="utf-8") as f:
            f.write(new_src)
        print("sync_policy: rewrote the policy strings in bundle.js")
    if snap_have != snap_want:
        with open(SNAPSHOT, "w", encoding="utf-8") as f:
            f.write(snap_want)
        print("sync_policy: wrote components/policy.snapshot.json")
    if new_src == src and snap_have == snap_want:
        print("sync_policy: already in sync")
    return 0


if __name__ == "__main__":
    sys.exit(main())
