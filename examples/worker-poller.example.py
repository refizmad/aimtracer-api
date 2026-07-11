"""
Minimal Python worker loop for the clipper backend (illustrative).

Real integration will live inside / next to cs2-clip/clipper.py or a new worker.py.

Run:
    pip install httpx
    X_MACHINE_TOKEN=dev_machine_token_please_change python examples/worker-poller.example.py
"""
import os
import time
import httpx
from typing import Optional, Any

BASE_URL = os.getenv("API_BASE", "http://localhost:3001")
TOKEN = os.getenv("X_MACHINE_TOKEN", "dev_machine_token_please_change")
HEADERS = {"X-Machine-Token": TOKEN}

def lease_job(wait: int = 25) -> Optional[dict]:
    with httpx.Client(timeout=30) as client:
        r = client.get(f"{BASE_URL}/worker/jobs/lease", params={"wait": wait}, headers=HEADERS)
        r.raise_for_status()
        return r.json().get("job")

def report(job_id: str, **kwargs: Any) -> dict:
    with httpx.Client(timeout=15) as client:
        r = client.patch(f"{BASE_URL}/worker/jobs/{job_id}", json=kwargs, headers=HEADERS)
        r.raise_for_status()
        return r.json()

def run_clip_job(job: dict):
    payload = job["payload"]
    share_code = payload["shareCode"]
    trusted = payload.get("trustedSteamIds", [])
    opts = payload.get("options", {})

    print(f"[worker] Starting clip for {share_code} (trusted={trusted}) opts={opts}")

    # === Replace the block below with real calls into clipper ===
    report(job["id"], status="PROCESSING", stage="downloading", progress=3, message="Downloading demo")
    time.sleep(2)
    report(job["id"], progress=18, stage="parsing", message="Parsing demo for clips")
    time.sleep(3)

    # Simulate rendering progress
    for i in range(1, 6):
        report(job["id"], progress=20 + i*12, stage="rendering", message=f"Rendering clip {i}/5")
        time.sleep(1.5)

    report(
        job["id"],
        status="COMPLETED",
        progress=100,
        stage="done",
        result={
            "shareCode": share_code,
            "clips": [
                {"filename": "clip_001_4k.mp4", "url": "https://clips.example/xxx.mp4"}
            ],
        },
    )
    print("[worker] Job completed")

def main():
    print("Clipper worker starting (polling HTTPS)...")
    while True:
        try:
            job = lease_job(wait=20)
            if not job:
                time.sleep(2)
                continue
            run_clip_job(job)
        except Exception as exc:
            print("Worker loop error:", exc)
            time.sleep(5)

if __name__ == "__main__":
    main()
