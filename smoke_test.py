"""Check the PDF's Data and Power layers without printing secrets.

Run with .venv/bin/python smoke_test.py, or add --config-only to avoid API calls.
"""

import argparse
import os
from pathlib import Path
import stat
import sys
from urllib.parse import urlparse
import uuid

try:
    import requests
    from dotenv import load_dotenv
    from openai import OpenAI
except ImportError:
    sys.exit("FAIL Dependencies: run bash scripts/setup.sh first.")


ROOT = Path(__file__).resolve().parent


class CheckError(Exception):
    """An error message that is safe to display."""


def need(*names):
    missing = [name for name in names if not os.environ.get(name, "").strip()]
    if missing:
        raise CheckError("Missing settings in .env: " + ", ".join(missing))


def require_url(name):
    need(name)
    parsed = urlparse(os.environ[name])
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise CheckError(f"{name} must be an HTTP(S) URL.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise CheckError(f"{name} must not contain credentials, a query, or a fragment.")


def check_env_file():
    env = ROOT / ".env"
    if not env.is_file():
        raise CheckError("Missing .env: run bash scripts/setup.sh.")
    if stat.S_IMODE(env.stat().st_mode) & 0o077:
        raise CheckError("Run chmod 600 .env to restrict access.")


def check_data_config():
    need("ZETARIS_ORG_ID", "ZETARIS_API_KEY")
    require_url("ZETARIS_REST_URL")
    if not os.environ["ZETARIS_ORG_ID"].isdigit():
        raise CheckError("ZETARIS_ORG_ID must be numeric; a local install uses 1.")


def check_power_config():
    need("MODEL_API_KEY", "NEMOTRON_MODEL")
    require_url("MODEL_BASE_URL")
    if "nemotron" not in os.environ["NEMOTRON_MODEL"].lower():
        raise CheckError("NEMOTRON_MODEL must identify a Nemotron model.")
    if urlparse(os.environ["MODEL_BASE_URL"]).hostname == "integrate.api.nvidia.com":
        if not os.environ["MODEL_API_KEY"].startswith("nvapi-"):
            raise CheckError("NVIDIA's direct endpoint requires an nvapi- key.")


def zetaris_web():
    require_url("ZETARIS_BASE_URL")
    response = requests.get(os.environ["ZETARIS_BASE_URL"], timeout=10)
    response.raise_for_status()


def zetaris_sql():
    check_data_config()
    response = requests.post(
        os.environ["ZETARIS_REST_URL"].rstrip("/") + "/sql-editor/sqls/run",
        headers={
            "Authorization": "Bearer " + os.environ["ZETARIS_API_KEY"],
            "X-Org-ID": os.environ["ZETARIS_ORG_ID"],
            "X-Request-ID": str(uuid.uuid4()),
        },
        json={
            "queryId": str(uuid.uuid4()),
            "sql": "SELECT 1 AS one",
            "source": "SqlEditor",
            "limit": 1,
        },
        timeout=60,
        allow_redirects=False,
    )
    if response.is_redirect:
        raise CheckError("Unexpected redirect; check ZETARIS_REST_URL.")
    response.raise_for_status()
    body = response.json()
    data = body.get("data") if isinstance(body, dict) else None
    if not (
        isinstance(data, list)
        and data
        and isinstance(data[0], list)
        and data[0]
        and str(data[0][0]) == "1"
    ):
        raise CheckError("SELECT 1 returned an unexpected result; check the local API reference.")


def nemotron():
    check_power_config()
    with OpenAI(
        base_url=os.environ["MODEL_BASE_URL"],
        api_key=os.environ["MODEL_API_KEY"],
        timeout=90.0,
        max_retries=0,
    ) as client:
        reply = client.chat.completions.create(
            model=os.environ["NEMOTRON_MODEL"],
            messages=[{"role": "user", "content": "Reply with the single word: ready"}],
            max_tokens=2048,
        )
    if not reply.choices or not (reply.choices[0].message.content or "").strip():
        raise CheckError("Nemotron returned no answer text; check the model and token limit.")


def safe_error(error):
    # Provider errors can contain credentials or response bodies: never print them.
    if isinstance(error, CheckError):
        return str(error)
    response = getattr(error, "response", None)
    status = getattr(response, "status_code", None) or getattr(error, "status_code", None)
    if status is not None:
        return f"HTTP {status}; check the service, credentials, model ID, and account limits."
    if isinstance(error, requests.exceptions.Timeout) or "Timeout" in type(error).__name__:
        return "Request timed out; check service startup and connectivity."
    if isinstance(error, requests.exceptions.ConnectionError) or "Connection" in type(error).__name__:
        return "Connection unavailable; check service startup and network permissions."
    return f"{type(error).__name__}; details withheld to avoid exposing credentials."


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-only", action="store_true", help="Validate local settings without API calls")
    args = parser.parse_args()
    load_dotenv(ROOT / ".env", override=False, interpolate=False)
    os.environ.setdefault("ZETARIS_BASE_URL", "http://localhost:3000")
    if args.config_only:
        checks = [
            ("Config: private .env", check_env_file),
            ("Config: Zetaris settings", check_data_config),
            ("Config: Nemotron settings", check_power_config),
        ]
    else:
        checks = [
            ("Data: Zetaris web interface", zetaris_web),
            ("Data: Zetaris SQL over REST", zetaris_sql),
            ("Power: Nemotron reply", nemotron),
        ]
    failures = 0
    for name, fn in checks:
        try:
            fn()
        except Exception as error:
            failures += 1
            print(f"FAIL {name}: {safe_error(error)}", flush=True)
        else:
            print(f"PASS {name}", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
