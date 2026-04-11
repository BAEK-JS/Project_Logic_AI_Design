#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
브라우저 CORS 우회용 최소 프록시.

  python proxy_openai.py

실행 후 index.html 의 「API 베이스 URL」에 http://127.0.0.1:8787 입력.

- 클라이언트에서 들어온 Authorization 헤더를 그대로 OpenAI로 전달합니다.
- API 키는 이 프로세스 로그에 남기지 않습니다.
"""
from __future__ import annotations

import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

LISTEN = ("127.0.0.1", 8787)
OPENAI_ORIGIN = "https://api.openai.com"


def cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), fmt % args))

    def do_OPTIONS(self) -> None:
        if not self.path.startswith("/v1/"):
            self.send_error(404)
            return
        self.send_response(204)
        for k, v in cors_headers().items():
            self.send_header(k, v)
        self.end_headers()

    def do_POST(self) -> None:
        if not self.path.startswith("/v1/"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else b""

        headers = {
            "Content-Type": self.headers.get("Content-Type") or "application/json",
        }
        auth = self.headers.get("Authorization")
        if auth:
            headers["Authorization"] = auth

        url = OPENAI_ORIGIN + self.path
        req = Request(url, data=body, method="POST", headers=headers)
        try:
            with urlopen(req, timeout=180) as resp:
                data = resp.read()
                self.send_response(resp.status)
                for k, v in cors_headers().items():
                    self.send_header(k, v)
                ct = resp.headers.get("Content-Type") or "application/json"
                self.send_header("Content-Type", ct)
                self.end_headers()
                self.wfile.write(data)
        except HTTPError as e:
            err_body = e.read() if e.fp else b""
            self.send_response(e.code)
            for k, v in cors_headers().items():
                self.send_header(k, v)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(err_body)
        except URLError as e:
            msg = str(e.reason if hasattr(e, "reason") else e).encode("utf-8")
            self.send_response(502)
            for k, v in cors_headers().items():
                self.send_header(k, v)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                b'{"error":{"message":"proxy URLError: '
                + msg.replace(b'"', b"'")
                + b'","type":"proxy_error"}}'
            )


def main() -> None:
    httpd = HTTPServer(LISTEN, Handler)
    print("Listening http://%s:%s  (forwarding to %s)" % (LISTEN[0], LISTEN[1], OPENAI_ORIGIN))
    print("Set API base URL in index.html to: http://127.0.0.1:%s" % LISTEN[1])
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
