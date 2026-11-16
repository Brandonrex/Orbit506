"""In-process job runner for detail fetches. Job state lives in SQLite (detail_jobs).

One worker thread processes jobs one at a time, so a burst of saves cannot hammer the catalogues.
A job stops early (status 'cancelled') when its property is deleted or its geometry changes.
"""
from __future__ import annotations

import json
import logging
import queue
import sqlite3
import threading
from datetime import date, timedelta
from pathlib import Path

from detail.composites import build_composites
from detail.config import CONFIG
from detail.run import Cancelled, DetailError, SceneOutcome, quiet_libraries, run_detail
from detail.sources import default_sources

from .. import db
from . import store

log = logging.getLogger("detail")


def plan_window(conn: sqlite3.Connection, pid: int, today: date | None = None) -> tuple[str, date, date]:
    """(kind, date_from, date_to). Full = last 12 months; incremental = after the last processed day,
    or from the earliest day that failed to load, whichever is earlier."""
    today = today or date.today()
    last, first_error = store.scene_bounds(conn, pid)
    if last is None and first_error is None:
        return "full", today - timedelta(days=CONFIG.window_days), today
    starts = [date.fromisoformat(first_error)] if first_error else []
    if last:
        starts.append(min(date.fromisoformat(last) + timedelta(days=1), today))
    return "incremental", min(starts), today


def request_job(conn: sqlite3.Connection, pid: int) -> sqlite3.Row:
    """Create a job for the property's current geometry, or return the one already pending for it."""
    prop = conn.execute("SELECT id, geom_hash FROM properties WHERE id = ?", (pid,)).fetchone()
    active = store.active_job(conn, pid)
    if active is not None:
        if active["geom_hash"] == prop["geom_hash"]:
            return active  # already covers up to today
        if active["status"] == "queued":  # queued for an older geometry
            store.update_job(conn, active["id"], status="cancelled", finished_at=store.now(), error="superseded")
        # A running job for an older geometry notices the change at its next day and cancels itself.
    kind, d0, d1 = plan_window(conn, pid)
    job_id = store.insert_job(conn, pid, kind, prop["geom_hash"], d0.isoformat(), d1.isoformat())
    RUNNER.submit(job_id)
    return store.job(conn, job_id)


class _JobLog:
    """Attach a per-job log file to the 'detail' logger for the duration of a job."""

    def __init__(self, path: Path):
        self.path = path

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.h = logging.FileHandler(self.path, encoding="utf-8")
        self.h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        log.addHandler(self.h)
        log.setLevel(logging.INFO)
        return self

    def __exit__(self, *exc):
        log.removeHandler(self.h)
        self.h.close()


class DetailRunner:
    def __init__(self):
        self.q: queue.Queue[int | None] = queue.Queue()
        self.thread: threading.Thread | None = None
        self.lock = threading.Lock()
        self.sources_factory = default_sources  # tests swap in a fake catalogue

    # ---- lifecycle ----
    def start(self) -> None:
        with self.lock:
            if self.thread is None or not self.thread.is_alive():
                quiet_libraries()
                self.thread = threading.Thread(target=self._loop, name="detail-runner", daemon=True)
                self.thread.start()

    def recover(self) -> None:
        """On startup: jobs left 'running' by a previous process failed; 'queued' ones are resubmitted."""
        conn = db.connect()
        try:
            with conn:
                conn.execute(
                    """UPDATE detail_jobs SET status = 'failed', error_reason = 'interrupted',
                              error = 'Server restarted while the job was running', finished_at = ?
                       WHERE status = 'running'""",
                    (store.now(),),
                )
            for r in conn.execute("SELECT id FROM detail_jobs WHERE status = 'queued' ORDER BY id").fetchall():
                self.submit(r["id"])
        finally:
            conn.close()

    def purge(self) -> int:
        """Optional TTL: drop the detail data of properties untouched for AF_DETAIL_TTL_DAYS days.
        The property itself stays; saving it or POST …/refresh fetches again."""
        if CONFIG.ttl_days <= 0:
            return 0
        conn = db.connect()
        try:
            n = store.purge_untouched(conn, CONFIG.ttl_days)
        finally:
            conn.close()
        if n:
            log.info("TTL purge: detail data of %d propert(ies) untouched for %d days removed", n, CONFIG.ttl_days)
        return n

    def submit(self, job_id: int) -> None:
        self.start()
        self.q.put(job_id)

    def wait_idle(self) -> None:
        """Block until every submitted job has finished (tests)."""
        self.q.join()

    def _loop(self) -> None:
        while True:
            try:
                job_id = self.q.get(timeout=PURGE_EVERY_S)
            except queue.Empty:
                self.purge()
                continue
            try:
                if job_id is not None:
                    self.run_job(job_id)
            except Exception:  # never let the worker die
                log.exception("detail job %s crashed", job_id)
            finally:
                self.q.task_done()

    # ---- one job ----
    def run_job(self, job_id: int) -> None:
        conn = db.connect()
        try:
            self._run(conn, job_id)
        finally:
            conn.close()

    def _run(self, conn: sqlite3.Connection, job_id: int) -> None:
        j = store.job(conn, job_id)
        if j is None or j["status"] != "queued":
            return
        pid = j["property_id"]
        prop = conn.execute("SELECT * FROM properties WHERE id = ?", (pid,)).fetchone()
        if prop is None or prop["geom_hash"] != j["geom_hash"]:
            store.update_job(conn, job_id, status="cancelled", finished_at=store.now(), error="superseded")
            return

        store.update_job(conn, job_id, status="running", started_at=store.now())
        out_dir = store.property_dir(pid)

        def current() -> bool:
            p = conn.execute("SELECT geom_hash FROM properties WHERE id = ?", (pid,)).fetchone()
            return p is not None and p["geom_hash"] == j["geom_hash"]

        def on_found(source: str, todo) -> None:
            store.update_job(conn, job_id, source=source, scenes_found=len(todo))

        done = valid = 0

        def on_scene(o: SceneOutcome) -> None:
            nonlocal done, valid
            if not current():
                for a in o.assets.values():  # written for a geometry that no longer exists
                    Path(a["path"]).unlink(missing_ok=True)
                raise Cancelled()
            store.save_scene(conn, pid, job_id, o)
            done += 1
            valid += o.status == "valid"
            store.update_job(conn, job_id, scenes_done=done, scenes_valid=valid)

        with _JobLog(out_dir / "logs" / f"job_{job_id}.log"):
            log.info("job %d property %d (%s) %s..%s", job_id, pid, j["kind"], j["date_from"], j["date_to"])
            try:
                run_detail(
                    json.loads(prop["geometry"]),
                    date.fromisoformat(j["date_from"]),
                    date.fromisoformat(j["date_to"]),
                    out_dir,
                    skip_dates=store.known_dates(conn, pid),
                    sources=self.sources_factory(),
                    on_found=on_found,
                    on_scene=on_scene,
                    should_continue=current,
                )
                if valid or not store.has_composites(conn, pid):
                    rebuild_composites(conn, pid)
                store.update_job(conn, job_id, status="done", finished_at=store.now())
                log.info("job %d done: %d day(s), %d valid", job_id, done, valid)
            except Cancelled:
                store.update_job(conn, job_id, status="cancelled", finished_at=store.now(), error="superseded")
                log.info("job %d cancelled (property changed or deleted)", job_id)
            except DetailError as e:
                store.update_job(conn, job_id, status="failed", finished_at=store.now(), error_reason=e.reason, error=str(e))
                log.error("job %d failed: %s", job_id, e)
            except Exception as e:
                store.update_job(conn, job_id, status="failed", finished_at=store.now(), error_reason="internal",
                                 error=f"{type(e).__name__}: {e}")
                log.exception("job %d failed", job_id)
        if conn.execute("SELECT 1 FROM properties WHERE id = ?", (pid,)).fetchone() is None:
            store.remove_files(pid)  # deleted while running: don't leave its folder behind


def rebuild_composites(conn: sqlite3.Connection, pid: int) -> None:
    """Monthly medians + days since clear, from the stored valid days (no downloads)."""
    dates = [s["acquired_at"] for s in store.scenes(conn, pid) if s["status"] == "valid"]
    store.replace_composites(conn, pid, build_composites(store.property_dir(pid), dates))


PURGE_EVERY_S = 3600
RUNNER = DetailRunner()
