---
triggers: 拒绝访问, icacls, 权限标签, 完整性, 写入 拒绝, 目录 权限
---

# Writes need the Low integrity label on the target — 2026-11-02

The confined process runs at low integrity. A directory with no Low mandatory label
is treated as medium, so creating children fails with "Access to the path is denied"
even though the DACL grants Modify.

Diagnose by comparing `icacls <dir>` against a directory that works; the healthy one
shows `Mandatory Label\Low Mandatory Level:(I)(OI)(CI)(NW)`.

Two fixes, neither available from inside the sandbox:
- `icacls <dir> /setintegritylevel (OI)(CI)Low /T` from an elevated shell
- recreate the directory under a labelled parent, so the label is inherited

Evidence: `.agents` had the label; `DSH_FILES` and five siblings did not.