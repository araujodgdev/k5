"""Import only synthetic pilot artifacts. Requires openpyxl and Pandoc; not used at runtime."""
import base64
import hashlib
import io
import json
import re
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

import openpyxl

root = Path(sys.argv[1]).resolve()
pandoc = sys.argv[2]
app = Path(__file__).resolve().parent.parent
task = "corporate-ma/review-data-room-red-flag-review"
stamp = "20260921T184557Z"
config = json.loads((root / "tasks" / task / "task.json").read_text(encoding="utf-8"))
results = []
provenance_path = app / "src" / "data" / "feedback-provenance.json"
provenance = json.loads(provenance_path.read_text(encoding="utf-8")) if provenance_path.exists() else {}
runs = [("mercury", "Mercury 2.5", root / "results" / task / "mercury-2.5-high" / stamp),
        ("deepseek", "DeepSeek V4.1 Flash", root / "results" / task / "deepseek-flash-high" / stamp)]
# Optional third argument is the actual completed Meta run directory, never a placeholder.
if len(sys.argv) > 3:
    runs.append(("meta", "Muse Spark 1.3", Path(sys.argv[3]).resolve()))
for key, name, run in runs:
    run_config = json.loads((run / "config.json").read_text(encoding="utf-8"))
    expected_model = {"mercury": "inception/mercury-2.5", "deepseek": "deepseek/deepseek-flash", "meta": "meta/muse-spark-1.3"}[key]
    if run_config["model"] != expected_model or run_config["task"] != task:
        raise ValueError(f"Run model or task does not match the declared candidate: {key}")
    metrics = json.loads((run / "metrics.json").read_text())
    if metrics.get("finish_reason") != "finish_tool":
        raise ValueError(f"Run did not finish its deliverables: {run.name}")
    files = {}
    for kind, filename in [("memo", "red-flag-memo.docx"), ("tracker", "red-flag-tracker.xlsx")]:
        blob = (run / "output" / filename).read_bytes()
        with ZipFile(io.BytesIO(blob)) as office_file:
            if office_file.testzip() is not None:
                raise ValueError(f"Corrupt Office artifact: {filename}")
            required_part = "word/document.xml" if kind == "memo" else "xl/workbook.xml"
            if required_part not in office_file.namelist():
                raise ValueError(f"Missing Office content: {filename}")
            for part in office_file.namelist():
                if part.endswith(".xml") and re.search(r"mercury[ -]?2\.5|deepseek|inception|muse[ -]spark", office_file.read(part).decode("utf-8", errors="replace"), re.I):
                    raise ValueError(f"Model identity found in blind artifact: {key}/{filename}/{part}")
        files[kind] = {"filename": filename, "base64": base64.b64encode(blob).decode(), "sha256": hashlib.sha256(blob).hexdigest()}
    memo = subprocess.check_output([pandoc, str(run / "output" / "red-flag-memo.docx"), "-t", "gfm", "--wrap=none"], encoding="utf-8")
    workbook = openpyxl.load_workbook(run / "output" / "red-flag-tracker.xlsx", data_only=True)
    sheets = []
    for sheet in workbook:
        rows = [["" if value is None else str(value) for value in row] for row in sheet.iter_rows(values_only=True)]
        sheets.append({"name": sheet.title, "rows": [row for row in rows if any(row)]})
    results.append({"key": key, "name": name, "memo": memo, "sheets": sheets, "files": files,
                    "metrics": {k: metrics[k] for k in ["wall_clock_seconds", "turn_count", "input_tokens", "output_tokens"]}})
    provenance[files["memo"]["sha256"]] = {
        "generation": {k: run_config[k] for k in ["model", "task", "run_id", "max_turns", "temperature", "reasoning_effort", "skills", "sandbox_image", "started_at"]},
        "source_sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((root / "tasks" / task / "documents").iterdir()) if p.is_file()},
        "task_sha256": hashlib.sha256((root / "tasks" / task / "task.json").read_bytes()).hexdigest(),
        "finish_reason": metrics["finish_reason"],
        "system_prompt": None,
        "system_prompt_note": "Not persisted by the original harness; do not reconstruct a training trajectory from artifact previews.",
    }
archive = io.BytesIO()
with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
    def add_file(name, content):
        entry = ZipInfo(name, date_time=(2026, 9, 21, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        bundle.writestr(entry, content)
    add_file("LICENSE-Harvey.txt", (root / "LICENSE").read_bytes())
    for path in sorted((root / "tasks" / task / "documents").iterdir()):
        if path.is_file():
            add_file(path.name, path.read_bytes())
revision = hashlib.sha256(json.dumps({"results": results, "instructions": config["instructions"],
    "sources": hashlib.sha256(archive.getvalue()).hexdigest()}, sort_keys=True).encode()).hexdigest()[:16]
data = {"id": f"harvey-ma-{stamp}-{revision}", "title": "Revisão de riscos em uma aquisição",
        "instructions": config["instructions"], "task": task, "commit": "1dd81403b2fbb60596f7aea3fcecafad7bf73143",
        "sourceFiles": base64.b64encode(archive.getvalue()).decode(), "results": results}
target = app / "src" / "data" / "feedback-pilot.json"
target.parent.mkdir(parents=True, exist_ok=True)
provenance_path.write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")
history_path = target.with_name("feedback-history.json")
history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else []
if target.exists():
    previous = json.loads(target.read_text(encoding="utf-8"))
    if previous["id"] != data["id"] and not any(item["id"] == previous["id"] for item in history):
        history.append(previous)
history_path.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
target.with_name("feedback-pilot-LICENSE.txt").write_bytes((root / "LICENSE").read_bytes())
target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Imported {len(results)} runs into {target}; campaign {data['id']}")
