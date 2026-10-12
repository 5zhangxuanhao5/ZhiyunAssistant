# 自生成媒体回归样本

这是用 FFmpeg 的 `testsrc2` 彩色视频发生器和 `sine` 音频发生器生成的测试资料，没有真实课件、用户信息、教师影像或第三方课程内容。文件仅供自动回归测试；正式 APP 的 staging 目录只包含 dist/assets/package，不包含本目录。

2026-10-12 使用 PyPI 的 `imageio-ffmpeg` 0.6.0 wheel 所带 FFmpeg 7.1（Mac ARM64）生成。编码为 24 秒、640×360、12fps、H.264 Constrained Baseline/yuv420p 视频，加 AAC-LC/44.1kHz/单声道短音频。MP4 已启用 faststart。HLS 从同一文件无损重封装，2秒分段，完整 VOD 清单。

重建命令（`ffmpeg` 指向本机可用的可信 FFmpeg 工具）：

```sh
ffmpeg -f lavfi -i testsrc2=size=640x360:rate=12 -f lavfi -i sine=frequency=440:sample_rate=44100 -t 24 -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p -profile:v baseline -level 3.0 -g 24 -keyint_min 24 -sc_threshold 0 -c:a aac -b:a 64k -movflags +faststart -shortest -y test-pattern.mp4
ffmpeg -i test-pattern.mp4 -c copy -hls_time 2 -hls_list_size 0 -hls_playlist_type vod -hls_flags independent_segments -hls_segment_filename hls/segment-%03d.ts -f hls -y hls/index.m3u8
```

FFmpeg 完整解码检查已通过（288帧、24秒视频及AAC音频均解码成功）。`tests/e2e/media.spec.ts` 进一步在真实 Electron 窗口测试受控协议下的 MP4/HLS 解码、时间推进、寻址、倍速、键盘、概览保持播放及全窗口几何；2026-10-12 已在当前 Mac 的原生 Electron 窗口实际运行并 4/4 通过（11.1秒，日志位于工作区 work/windows-media-e2e-recheck.log）。首次运行发现 HLS 构造参数冲突，修复后重新构建并完整通过。该结果不等同实际校园课程视频验证或 Windows 真机验证；没有使用真实校园资源或用户凭据。
