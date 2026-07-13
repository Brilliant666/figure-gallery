"""Disposable, bounded HTTP transport probe for VAL-01B.

This module is deliberately not a crawler.  It performs one allow-listed request
at a time, keeps a persistent request budget in the system temporary directory,
and never inherits browser cookies or environment proxy settings.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qsl, urljoin, urlsplit


FIXED_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)
ONLY_ALLOWED_PROXY = "http://127.0.0.1:7897"
HTML_HOSTS = frozenset({"hpoi.net", "www.hpoi.net"})
IMAGE_HOSTS = frozenset({"rfx.hpoi.net"})
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
PROXY_ENV_NAMES = frozenset({"http_proxy", "https_proxy", "all_proxy", "no_proxy"})
BODY_LIMITS = {"html": 3 * 1024 * 1024, "text": 512 * 1024, "image": 4 * 1024 * 1024}
SENSITIVE_QUERY_KEYS = frozenset(
    {"access_token", "api_key", "auth", "authorization", "key", "sig", "signature", "token"}
)


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def _require_temporary_path(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    temporary_root = Path(tempfile.gettempdir()).resolve()
    try:
        resolved.relative_to(temporary_root)
    except ValueError as exc:
        raise ValueError(f"runtime output must stay under {temporary_root}") from exc
    return resolved


def validate_proxy(proxy: str | None) -> str | None:
    if proxy is None:
        return None
    parsed = urlsplit(proxy)
    if (
        proxy != ONLY_ALLOWED_PROXY
        or parsed.username
        or parsed.password
        or parsed.hostname != "127.0.0.1"
        or parsed.port != 7897
    ):
        raise ValueError("only the unauthenticated loopback VAL-01B proxy is allowed")
    return proxy


def validate_public_url(url: str, kind: str) -> str:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    allowed_hosts = IMAGE_HOSTS if kind == "image" else HTML_HOSTS
    if parsed.scheme != "https":
        raise ValueError("only HTTPS URLs are allowed")
    if parsed.username or parsed.password:
        raise ValueError("URL credentials are not allowed")
    if parsed.port not in (None, 443):
        raise ValueError("non-standard ports are not allowed")
    if host not in allowed_hosts:
        raise ValueError(f"host is not allow-listed for {kind}: {host}")
    if any(key.lower() in SENSITIVE_QUERY_KEYS for key, _value in parse_qsl(parsed.query)):
        raise ValueError("credential-like query parameters are not allowed")
    return url


def validate_referer(referer: str | None, kind: str) -> str | None:
    if referer is None:
        return None
    if kind != "image":
        raise ValueError("Referer is only permitted for an image comparison")
    validate_public_url(referer, "html")
    parsed = urlsplit(referer)
    if not parsed.path.startswith("/hobby/"):
        raise ValueError("image Referer must be the corresponding public product page")
    return referer


@dataclass
class RequestBudget:
    """Persistent single-worker request gate.

    The count is incremented and saved before every outgoing hop so a failed or
    interrupted request is still conservatively counted.
    """

    state_path: Path
    max_requests: int = 30
    min_interval_seconds: float = 2.0
    now: Callable[[], float] = time.time
    sleep: Callable[[float], None] = time.sleep

    def initialize(self, initial_count: int = 0) -> dict[str, Any]:
        self.state_path = _require_temporary_path(self.state_path)
        if self.state_path.exists():
            raise FileExistsError(f"budget already exists: {self.state_path}")
        if not 0 <= initial_count <= self.max_requests:
            raise ValueError("initial count is outside the request budget")
        state = {
            "schema_version": 1,
            "count": initial_count,
            "max_requests": self.max_requests,
            "min_interval_seconds": self.min_interval_seconds,
            "last_started_at_epoch": None,
        }
        _write_json(self.state_path, state)
        return state

    def read(self) -> dict[str, Any]:
        self.state_path = _require_temporary_path(self.state_path)
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        if state.get("max_requests") != self.max_requests:
            raise ValueError("budget maximum changed")
        if float(state.get("min_interval_seconds", -1)) != self.min_interval_seconds:
            raise ValueError("budget interval changed")
        count = state.get("count")
        if not isinstance(count, int) or not 0 <= count <= self.max_requests:
            raise ValueError("budget count is invalid")
        return state

    def acquire(self) -> int:
        state = self.read()
        count = int(state["count"])
        if count >= self.max_requests:
            raise RuntimeError("Hpoi request budget exhausted")
        last_started = state.get("last_started_at_epoch")
        if last_started is not None:
            wait_for = self.min_interval_seconds - (self.now() - float(last_started))
            if wait_for > 0:
                self.sleep(wait_for)
        started = self.now()
        state["count"] = count + 1
        state["last_started_at_epoch"] = started
        _write_json(self.state_path, state)
        return int(state["count"])


def _request_headers(kind: str, referer: str | None) -> dict[str, str]:
    accept = {
        "html": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "text": "text/plain,*/*;q=0.8",
        "image": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }[kind]
    headers = {"User-Agent": FIXED_USER_AGENT, "Accept": accept}
    if referer:
        headers["Referer"] = referer
    forbidden = {"cookie", "authorization", "proxy-authorization"}
    if forbidden.intersection(key.lower() for key in headers):
        raise AssertionError("credential-bearing header rejected")
    return headers


def content_type_matches(kind: str, content_type: str | None) -> bool:
    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    if kind == "image":
        return media_type.startswith("image/")
    if kind == "html":
        return media_type in {"text/html", "application/xhtml+xml"}
    return media_type.startswith("text/")


def _requests_error_class(exc: BaseException) -> str:
    try:
        import requests
    except ImportError:  # pragma: no cover - classified before any network use
        return "client_unavailable"
    if isinstance(exc, requests.exceptions.ProxyError):
        return "proxy_error"
    if isinstance(exc, requests.exceptions.SSLError):
        return "tls_error"
    if isinstance(exc, requests.exceptions.Timeout):
        return "timeout"
    if isinstance(exc, requests.exceptions.ConnectionError):
        return "connection_error"
    if isinstance(exc, requests.exceptions.RequestException):
        return "request_error"
    return "unexpected_error"


def request_with_requests(
    url: str,
    *,
    kind: str,
    proxy: str | None,
    referer: str | None,
    timeout: float,
    body_limit: int,
    hop_body: Path,
) -> dict[str, Any]:
    try:
        import requests
        from requests.adapters import HTTPAdapter
    except ImportError:
        return {"error_class": "client_unavailable", "client": "requests"}

    started = time.perf_counter()
    session = requests.Session()
    session.trust_env = False
    session.auth = None
    session.cookies.clear()
    session.mount("https://", HTTPAdapter(max_retries=0))
    proxies = {"http": proxy, "https": proxy} if proxy else {}
    try:
        with session.get(
            url,
            headers=_request_headers(kind, referer),
            proxies=proxies,
            timeout=(timeout, timeout),
            allow_redirects=False,
            stream=True,
        ) as response:
            chunks: list[bytes] = []
            size = 0
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                size += len(chunk)
                if size > body_limit:
                    raise ValueError("response_body_limit_exceeded")
                chunks.append(chunk)
            body = b"".join(chunks)
            hop_body.write_bytes(body)
            return {
                "client": "requests",
                "status": response.status_code,
                "elapsed_seconds": round(time.perf_counter() - started, 3),
                "content_type": response.headers.get("Content-Type"),
                "bytes": len(body),
                "location": response.headers.get("Location"),
                "body_sha256": hashlib.sha256(body).hexdigest(),
                "error_class": None,
            }
    except ValueError as exc:
        return {
            "client": "requests",
            "elapsed_seconds": round(time.perf_counter() - started, 3),
            "error_class": str(exc),
        }
    except Exception as exc:  # requests exposes several platform-specific subclasses
        return {
            "client": "requests",
            "elapsed_seconds": round(time.perf_counter() - started, 3),
            "error_class": _requests_error_class(exc),
        }
    finally:
        session.cookies.clear()
        session.close()


def build_curl_command(
    url: str,
    *,
    kind: str,
    proxy: str | None,
    referer: str | None,
    timeout: float,
    body_limit: int,
    hop_body: Path,
    hop_headers: Path,
) -> list[str]:
    command = [
        "curl.exe",
        "-q",
        "--silent",
        "--show-error",
        "--request",
        "GET",
        "--retry",
        "0",
        "--max-redirs",
        "0",
        "--connect-timeout",
        str(timeout),
        "--max-time",
        str(timeout),
        "--max-filesize",
        str(body_limit),
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--compressed",
        "--output",
        str(hop_body),
        "--dump-header",
        str(hop_headers),
        "--write-out",
        "%{json}",
        "--header",
        f"User-Agent: {FIXED_USER_AGENT}",
        "--header",
        f"Accept: {_request_headers(kind, referer)['Accept']}",
    ]
    if referer:
        command.extend(["--referer", referer])
    if proxy:
        command.extend(["--proxy", proxy, "--noproxy", ""])
    else:
        command.extend(["--proxy", "", "--noproxy", "*"])
    command.append(url)
    return command


def _parse_last_header_block(raw: bytes) -> dict[str, str]:
    normalized = raw.replace(b"\r\n", b"\n")
    blocks = [block for block in normalized.split(b"\n\n") if block.strip()]
    for block in reversed(blocks):
        lines = block.splitlines()
        if not lines or not lines[0].startswith(b"HTTP/"):
            continue
        safe: dict[str, str] = {}
        try:
            safe["status"] = lines[0].decode("ascii", errors="replace").split()[1]
        except IndexError:
            pass
        for line in lines[1:]:
            if b":" not in line:
                continue
            name, value = line.split(b":", 1)
            lowered = name.strip().lower()
            if lowered in {b"content-type", b"location"}:
                safe[lowered.decode("ascii").replace("-", "_")] = value.strip().decode(
                    "utf-8", errors="replace"
                )
        return safe
    return {}


def _curl_error_class(exit_code: int) -> str | None:
    if exit_code == 0:
        return None
    return {
        5: "proxy_dns_error",
        6: "dns_error",
        7: "connection_error",
        28: "timeout",
        35: "tls_error",
        47: "redirect_error",
        56: "transfer_error",
        60: "tls_certificate_error",
        63: "response_body_limit_exceeded",
        97: "proxy_error",
    }.get(exit_code, "curl_error")


def request_with_curl(
    url: str,
    *,
    kind: str,
    proxy: str | None,
    referer: str | None,
    timeout: float,
    body_limit: int,
    hop_body: Path,
    hop_headers: Path,
) -> dict[str, Any]:
    command = build_curl_command(
        url,
        kind=kind,
        proxy=proxy,
        referer=referer,
        timeout=timeout,
        body_limit=body_limit,
        hop_body=hop_body,
        hop_headers=hop_headers,
    )
    environment = {
        key: value for key, value in os.environ.items() if key.lower() not in PROXY_ENV_NAMES
    }
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            check=False,
            env=environment,
            timeout=timeout + 5,
        )
    except subprocess.TimeoutExpired:
        return {
            "client": "curl",
            "elapsed_seconds": round(time.perf_counter() - started, 3),
            "error_class": "process_timeout",
        }
    except FileNotFoundError:
        return {"client": "curl", "error_class": "client_unavailable"}

    metrics: dict[str, Any] = {}
    if completed.stdout:
        try:
            raw_metrics = json.loads(completed.stdout.decode("utf-8", errors="replace"))
            for source, destination in (
                ("http_code", "status"),
                ("time_total", "elapsed_seconds"),
                ("size_download", "bytes"),
                ("url_effective", "effective_url"),
                ("content_type", "content_type"),
            ):
                if source in raw_metrics:
                    metrics[destination] = raw_metrics[source]
        except json.JSONDecodeError:
            metrics = {}
    safe_headers = (
        _parse_last_header_block(hop_headers.read_bytes()) if hop_headers.exists() else {}
    )
    if safe_headers.get("status"):
        metrics["status"] = int(safe_headers["status"])
    if safe_headers.get("content_type"):
        metrics["content_type"] = safe_headers["content_type"]
    metrics["location"] = safe_headers.get("location")
    body = hop_body.read_bytes() if hop_body.exists() else b""
    metrics.update(
        {
            "client": "curl",
            "curl_exit_code": completed.returncode,
            "bytes": len(body),
            "body_sha256": hashlib.sha256(body).hexdigest() if body else None,
            "error_class": _curl_error_class(completed.returncode),
        }
    )
    return metrics


def fetch_one(
    *,
    client: str,
    url: str,
    kind: str,
    proxy: str | None,
    referer: str | None,
    timeout: float,
    max_redirects: int,
    budget: RequestBudget,
    body_output: Path,
) -> dict[str, Any]:
    validate_public_url(url, kind)
    proxy = validate_proxy(proxy)
    referer = validate_referer(referer, kind)
    body_output = _require_temporary_path(body_output)
    body_output.parent.mkdir(parents=True, exist_ok=True)
    body_output.unlink(missing_ok=True)
    if not 0 <= max_redirects <= 3:
        raise ValueError("max_redirects must be between 0 and 3")
    if not 1 <= timeout <= 30:
        raise ValueError("timeout must be between 1 and 30 seconds")

    current_url = url
    seen: set[str] = set()
    hops: list[dict[str, Any]] = []
    body_limit = BODY_LIMITS[kind]
    with tempfile.TemporaryDirectory(prefix="figure-gallery-val01b-hop-") as temporary:
        hop_root = Path(temporary)
        for redirect_number in range(max_redirects + 1):
            if current_url in seen:
                hops.append({"url": current_url, "error_class": "redirect_loop"})
                break
            seen.add(current_url)
            request_number = budget.acquire()
            hop_body = hop_root / f"hop-{redirect_number}.body"
            hop_headers = hop_root / f"hop-{redirect_number}.headers"
            if client == "requests":
                hop = request_with_requests(
                    current_url,
                    kind=kind,
                    proxy=proxy,
                    referer=referer,
                    timeout=timeout,
                    body_limit=body_limit,
                    hop_body=hop_body,
                )
            elif client == "curl":
                hop = request_with_curl(
                    current_url,
                    kind=kind,
                    proxy=proxy,
                    referer=referer,
                    timeout=timeout,
                    body_limit=body_limit,
                    hop_body=hop_body,
                    hop_headers=hop_headers,
                )
            else:
                raise ValueError(f"unsupported client: {client}")
            hop["url"] = current_url
            hop["request_number"] = request_number
            hop["content_type_matches"] = content_type_matches(kind, hop.get("content_type"))
            status = int(hop.get("status") or 0)
            raw_location = hop.pop("location", None)
            redirect_target: str | None = None
            if raw_location:
                candidate_target = urljoin(current_url, raw_location)
                try:
                    redirect_target = validate_public_url(candidate_target, kind)
                    hop["location"] = redirect_target
                except ValueError:
                    hop["location"] = None
                    hop["redirect_target_blocked"] = True
            else:
                hop["location"] = None
            hops.append(hop)

            if status in REDIRECT_STATUSES and raw_location:
                if redirect_target is None:
                    hop["error_class"] = "blocked_redirect_target"
                    break
                if redirect_number >= max_redirects:
                    hop["error_class"] = "redirect_limit"
                    break
                current_url = redirect_target
                continue
            if hop_body.exists():
                shutil.copyfile(hop_body, body_output)
            break

    final = hops[-1]
    status = int(final.get("status") or 0)
    success = (
        final.get("error_class") is None
        and 200 <= status < 300
        and bool(final.get("content_type_matches"))
        and body_output.exists()
    )
    return {
        "schema_version": 1,
        "client": client,
        "channel": "temporary_loopback_proxy" if proxy else "direct",
        "kind": kind,
        "referer_mode": "product_page" if referer else "none",
        "initial_url": url,
        "final_url": final.get("url"),
        "hops": hops,
        "success": success,
        "body_saved": body_output.exists(),
        "body_output": str(body_output),
        "request_count_after": budget.read()["count"],
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    initialize = subparsers.add_parser("init-budget")
    initialize.add_argument("--budget-state", required=True, type=Path)
    initialize.add_argument("--initial-count", type=int, default=0)

    show = subparsers.add_parser("show-budget")
    show.add_argument("--budget-state", required=True, type=Path)

    request = subparsers.add_parser("request")
    request.add_argument("--budget-state", required=True, type=Path)
    request.add_argument("--result", required=True, type=Path)
    request.add_argument("--body-output", required=True, type=Path)
    request.add_argument("--client", required=True, choices=("curl", "requests"))
    request.add_argument("--kind", required=True, choices=("html", "text", "image"))
    request.add_argument("--url", required=True)
    request.add_argument("--proxy")
    request.add_argument("--referer")
    request.add_argument("--timeout", type=float, default=15.0)
    request.add_argument("--max-redirects", type=int, default=2)
    request.add_argument(
        "--written-permission-confirmed",
        action="store_true",
        help="confirm that the project owner has documented Hpoi's prior written permission",
    )
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    budget = RequestBudget(_require_temporary_path(args.budget_state))
    if args.command == "init-budget":
        value = budget.initialize(args.initial_count)
        print(json.dumps(value, ensure_ascii=False, sort_keys=True))
        return 0
    if args.command == "show-budget":
        print(json.dumps(budget.read(), ensure_ascii=False, sort_keys=True))
        return 0

    result_path = _require_temporary_path(args.result)
    if not args.written_permission_confirmed:
        result = {
            "schema_version": 1,
            "success": False,
            "error_class": "site_permission_not_confirmed",
            "error_message": (
                "live Hpoi requests are disabled unless prior written site permission "
                "has been documented"
            ),
        }
        _write_json(result_path, result)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 2
    try:
        result = fetch_one(
            client=args.client,
            url=args.url,
            kind=args.kind,
            proxy=args.proxy,
            referer=args.referer,
            timeout=args.timeout,
            max_redirects=args.max_redirects,
            budget=budget,
            body_output=args.body_output,
        )
    except (RuntimeError, ValueError) as exc:
        result = {
            "schema_version": 1,
            "success": False,
            "error_class": type(exc).__name__,
            "error_message": str(exc),
        }
        _write_json(result_path, result)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 2
    _write_json(result_path, result)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
