# 语义分割 Mask 的 GPU 渲染

Mask 观测（COCO 压缩 RLE）直接画在 Image 面板里，和图像在同一个 three.js 场景、同一帧提交。几何模型见 [segmentation-geometry-model.md](segmentation-geometry-model.md)。

## 为什么是 WebGL2

Image 面板（ThreeDeeRender 的 ImageMode）本身就是 WebGL2 场景。Mask 作为共享图像几何的一个 mesh（`SegmentationMaskLayer`），自动跟随缩放、平移、旋转、翻转和去畸变，不会和图像错位。改用 WebGPU 需要另起画布和合成层（有一帧以上的错位风险），或者把整个 Image 面板迁到 WebGPU。

做选型时在同一台机器上对比过两者：GPU pass 都很便宜（每相机约 0.07–0.13 ms），但 WebGPU 在大批量纹理上传时帧时间不稳定，覆盖面也比 WebGL2 小（约 89% 对 97%）。所以 WebGL2 是唯一路径，等 Image 面板整体迁移时再考虑 WebGPU。

## 数据流

```
document (RLE counts)            Worker                     GPU（每个 Image 面板）
  overlaySource:                 buildMaskPlanes            SegmentationMaskLayer
  topic + logTimeNs → geometry   RLE → 转置整数位平面   →   DataTexture R8/R16/R32UI
  稳定 geometry id               LRU 96 MB（各面板共享）    texelFetch + 最高可见 bit
  style: visible / selected      按时间窗预取               与图像同一帧提交
```

- **转置位平面**（`maskOverlay/maskPlanes.ts`）：每个实例占一个 bit，≤ 8 个实例用 R8UI，≤ 16 用 R16UI，≤ 32 用 R32UI，≤ 64 用两张 R32UI。纹理第 x 行第 y 列存像素 (x, y)，所以列主序 RLE 的每段 run 是连续内存，构建是 O(runs + 像素)。
- **重叠**：每个实例一个 bit，重叠区域不会丢实例。着色时选中的实例优先，否则取最高 slot；描边约 1.5 个屏幕像素，任何缩放下至少 1 个图像像素。
- **精确到帧**：叠加层按 `topic + logTimeNs` 匹配显示帧；当前帧的位平面还没就绪就这一帧不画，绝不显示相邻帧的 mask。
- **稳定 id**：geometry id 只随 counts 变化，播放中不断注册新帧不会让已构建的位平面失效。
- **构建与缓存**（`maskOverlay/maskPlaneCache.ts`）：位平面在 Worker 里构建，CPU 侧 LRU 上限 96 MB，各面板按份额共享；预取按时间窗而不是固定帧数。

## 降级

都会记在叠加层的诊断计数里，不会悄悄发生。

| 情况                               | 行为                                    |
| ---------------------------------- | --------------------------------------- |
| Worker 不可用或出错                | 改在主线程构建（仍不在渲染帧内）        |
| 当前帧位平面还在构建               | 本帧不画 mask，计入缓存的 `misses`      |
| 单帧超过 64 个实例                 | 只画前 64 个，计入 `truncatedFrames`    |
| mask 尺寸和该 topic 的解码尺寸不符 | 跳过该实例，计入 `sizeMismatches`       |
| mask 边长超过 `MAX_TEXTURE_SIZE`   | 不画，记录错误                          |
| 没有 WebGL2                        | Image 面板本身就不能用，mask 没有新要求 |

整数纹理只用 `texelFetch`（不能线性过滤），是 WebGL2 核心能力，不需要扩展。规范只保证 `MAX_TEXTURE_SIZE` ≥ 2048：1280×720 转置后是 720×1280 没有问题，4K 源在只支持 2048 的设备上会被拒绝并计数。

## 已验证与未验证

- 已在 macOS 上的 Chromium（Apple Silicon，ANGLE Metal）验证：R8UI/R16UI/R32UI `texelFetch`、五路相机播放和暂停、上下文丢失后由 three.js 恢复（只在微基准里触发过）。
- 未验证：Windows、Linux（尤其是无 GPU 时的软件渲染）、Safari、Firefox；产品页面里的 WebGL 上下文丢失；4K 源和超过 64 个实例的真实数据。
- 已知瓶颈：多实例播放时主要开销在侧栏实例树（`SpatialTree`、`CameraFrameStrip`、`AnnotationPreview`），不在 GPU，mask 和多边形一样受影响。

## 需要和后端对齐

- **重叠语义**：同一帧多个实例的 mask 可以重叠，前端全部保留。契约需要说明是否允许重叠、谁在上面。
- **尺寸来源**：`Mask` 没有宽高，前端用该 topic 的解码帧尺寸。建议在 `Mask` 或 `Frame` 上加宽高，至少在服务端校验。
- **单帧实例上限**：前端单帧最多画 64 个实例；业务会超过的话需要提前沟通。
