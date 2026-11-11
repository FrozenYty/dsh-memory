---
triggers: camera, 相机, 摄像头, 白平衡, 曝光, 黑帧, 打不开, 黑屏, 相机 打不开
---

# The USB camera on this machine — 2026-11-10

Device: `MF200 Camera` (`usbvideo.inf`, VID_0C45), connected by USB 2.0. **Index 1.** Index 0 is the
laptop's Integrated Camera and maxes out at 1280×720.

## Sandbox

Opening a camera needs **elevated permission**: under the sandbox every `VideoCapture` fails with
`VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index`, and WMI device
queries (`Get-CimInstance Win32_PnPEntity`, `Get-PnpDevice`) return "access denied" rather than an empty
list — which reads like "no camera attached" if the error is skimmed. `pnputil /enum-devices /class
Camera` works without elevation and is the honest way to check what is plugged in.

## What the device does

| Mode | Result |
|---|---|
| 1920×1080 | **5 fps** — 17 MB/s, the USB 2.0 ceiling for uncompressed video |
| 1280×720 | **1 fps, broken** — stalls even after warm-up |
| 640×480 | 30 fps |
| MJPEG requested | ignored; it answers YUY2 regardless |

## Two driver lies

- **Manual white balance does nothing.** `CAP_PROP_WB_TEMPERATURE` reads back what was written while the
  applied gains stay wrong: automatic gave R/G/B 146/153/148 and a colour-cast score of 83, manual at
  4600 K gave 108/158/132 and a score of 0. It also *remembers* the manual setting across opens, so
  "leave it alone" inherits the last session's mistake. Ask for automatic explicitly.
- **The sensor returns black frames while settling.** Several frames of mean 0.0 follow any exposure
  change; measuring immediately reports a huge false drift on a perfectly locked exposure.

## Defaults on open

Exposure lands wherever auto-exposure last left it — on arrival −12, dark enough that every frame failed
the quality gate at 15/100. Use `--exposure -6` (log2 seconds on DirectShow, about 1/64 s) and let gain
sit at 0.

Evidence: `frame quality 15/100 at exposure -12; --exposure -6 reached 88/100 on the same scene.`
