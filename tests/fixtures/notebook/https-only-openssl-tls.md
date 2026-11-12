---
triggers: curl, 证书, tls, 代理, 抓取, schannel, 握手, 下载 失败, 证书 错误
---

# Only OpenSSL-based TLS works under the sandbox — 2026-11-02

`curl.exe`, .NET (`Invoke-WebRequest`) and GCM all fail through the proxy with
`schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`. Python's
`urllib` and git work — both sit on OpenSSL.

Use the dsh environment's `python.exe` for any HTTPS fetch or download.

Evidence: `curl -x http://127.0.0.1:7897 https://api.github.com/zen` -> exit 35