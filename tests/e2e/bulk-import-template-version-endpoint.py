"""E2E: /api/public/bulk-template-version endpoint.

Verifies that the public API endpoint returns the current TEMPLATE_VERSION and
the allowed line-of-business values.

SCRUM-128 C27 (Eng QC N13): part 2 of this script used to upload a CSV with a
stale `# template_version:` marker and assert the old importer's
template-version mismatch banner (test ids template-version-mismatch-banner /
tvm-detected / tvm-current). That banner was deleted with
components/bulk-import.tsx in C2 and the strict importer has no equivalent: it
does not read the marker (strict-import/parse.ts keeps "#" rows as data rows).
C22 removed the assertion; C27 drops the rest of part 2 (an upload with nothing
to assert) so the script checks only what still exists.
"""
import json, re, urllib.request

BASE = "http://localhost:8080"


def main():
    with urllib.request.urlopen(f"{BASE}/api/public/bulk-template-version") as r:
        payload = json.loads(r.read().decode())
    assert "template_version" in payload, payload
    current = payload["template_version"]
    assert re.match(r"^\d+\.\d+\.\d+$", current), current
    assert set(payload["line_of_business_allowed"]) == {"VILT", "Standalone", "Integrated"}
    print("endpoint template_version:", current)
    print("OK: version endpoint verified")


main()
