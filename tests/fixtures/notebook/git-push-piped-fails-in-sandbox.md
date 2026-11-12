---
status: candidate
updated: 2026-11-11
triggers: pipe, piping, 管道, 重定向, redirect, sandbox, 沙箱, named pipe, 命名管道, ResourceUnavailable, dotnet_ pipe denied, git push fails, python output capture
---

# Sandbox denies named pipes, so PowerShell cannot capture any external program's output (pipe OR redirection); cmd /c wor

## 现象

在 `pwsh` 里让 PowerShell **接管外部进程的输出**时，命令整体失败：

```
ResourceUnavailable: 程序'git.exe'运行失败： Access to the path '\\.\pipe\LOCAL\dotnet_...' is denied
[sandbox: file access denied under workspace-write mode]
```

受影响的写法（都失败）：
- `git push 2>&1 | Select-Object -Last 2`
- `& python script.py | Select-Object -First 1`
- `& python script.py > out.txt`（**重定向也失败**，不只管道）
- `git ls-files | Select-String "x"`

## 机制

PowerShell 要把子进程 stdout 变成自己的对象流，必须创建**命名管道**；沙箱（workspace-write）
拒绝创建命名管道。**与管道语法无关，与「谁接管子进程输出」有关。**

## 能用的写法

| 写法 | 结果 |
|---|---|
| PowerShell 自己的管道：`Get-ChildItem -Name \| Select-Object -First 1` | 可以（不涉及命名管道） |
| 外部进程直接运行，不接管：`python script.py` | 可以（输出直接到控制台/工具） |
| `cmd /c "python x.py \| findstr y"` | 可以（cmd 自己建管道） |
| `pwsh -Command "... \| ..."` 内的 PS 原生管道 | 可以 |

## 应对

1. **外部命令一律裸跑**，输出直接看；需要过滤时用 `cmd /c` 包一层。
2. 需要写文件时，**让程序自己写**（Python `open(...)`），不要在 PowerShell 里用 `>`。
3. 不要用 exclude/改 .gitignore 之类的方式绕环境限制（AGENTS §4.7）。

Evidence: `A: Get-ChildItem -Name | Select-Object -First 1 -> .github (ok)
B: python -c "print('B-ok')" -> B-ok (ok)
C: python -c "print('C-ok')" | Select-Object -First 1 -> ResourceUnavailable: '\\.\pipe\LOCAL\dotnet_6d95...' is denied
the workspace drive cmd /c "python -c ""print('D-ok')"" | findstr D-ok" -> D-ok (ok, exit 0`
