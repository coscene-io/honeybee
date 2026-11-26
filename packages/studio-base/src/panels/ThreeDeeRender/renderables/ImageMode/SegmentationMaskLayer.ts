// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import Logger from "@foxglove/log";
import type {
  SegmentationMaskStyle,
  SegmentationPanelBridge,
} from "@foxglove/studio-base/segmentation/imageSource";
import type { MaskPlaneCache } from "@foxglove/studio-base/segmentation/maskOverlay/maskPlaneCache";
import {
  MAX_MASK_SLOTS,
  planeBytes,
  type MaskPlanes,
} from "@foxglove/studio-base/segmentation/maskOverlay/maskPlanes";

import type { ImageRenderable } from "../Images/ImageRenderable";

const log = Logger.getLogger(__filename);
/** Each distinct mask error is logged once per page. */
const reportedErrors = new Set<string>();

/**
 * Planes ahead of the displayed frame are built off-thread. When rendering is slower than the
 * source (CPU load, throttling) the displayed frame skips several source frames, so the window is
 * time-based: about two observed display steps, at least PREFETCH_MIN_FRAMES and at most
 * PREFETCH_MAX_FRAMES, and never more than this panel's share of the shared plane cache.
 */
const PREFETCH_MIN_FRAMES = 8;
const PREFETCH_MAX_FRAMES = 24;
const PREFETCH_MIN_HORIZON_NS = 300_000_000n;
const PREFETCH_MAX_HORIZON_NS = 1_000_000_000n;

/** Fill opacity until the first style arrives (the source always sends its own). */
const DEFAULT_FILL_OPACITY = 0.35;
/** A selected instance's fill is this much more opaque than the others, capped at 1. */
const SELECTED_FILL_GAIN = 1.5;
/** Outline width in screen pixels at any zoom (never thinner than one image pixel). */
const OUTLINE_SCREEN_PX = 1.5;
/** Teal, for a slot whose class has no colour. */
const FALLBACK_COLOR: readonly [number, number, number] = [0, 0.54, 0.48];

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Planes are transposed: texel (column = y, row = x) holds image pixel (x, y), so each COCO RLE
// run is one contiguous span. One bit per instance slot, so overlaps keep every instance.
const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  precision highp int;
  precision highp usampler2D;
  uniform usampler2D uPlane0;
  uniform usampler2D uPlane1;
  uniform bool uTwoPlanes;
  uniform vec2 uImageSize;
  uniform vec3 uColors[${MAX_MASK_SLOTS}];
  uniform uint uVisLo;
  uniform uint uVisHi;
  uniform uint uSelLo;
  uniform uint uSelHi;
  uniform float uOpacity;
  varying vec2 vUv;

  uvec2 bitsAt(vec2 pixel) {
    ivec2 p = ivec2(clamp(floor(pixel), vec2(0.0), uImageSize - 1.0));
    ivec2 t = ivec2(p.y, p.x);
    uint lo = texelFetch(uPlane0, t, 0).r;
    uint hi = uTwoPlanes ? texelFetch(uPlane1, t, 0).r : 0u;
    return uvec2(lo & uVisLo, hi & uVisHi);
  }

  // GLSL ES 3.00 (WebGL2) has no findMSB; that is ES 3.10. Exact for all 32 bits.
  int highestBit(uint x) {
    int r = 0;
    if (x >= 0x10000u) { x >>= 16; r += 16; }
    if (x >= 0x100u) { x >>= 8; r += 8; }
    if (x >= 0x10u) { x >>= 4; r += 4; }
    if (x >= 0x4u) { x >>= 2; r += 2; }
    if (x >= 0x2u) { r += 1; }
    return r;
  }

  int topSlot(uvec2 bits) {
    return bits.y != 0u ? 32 + highestBit(bits.y) : highestBit(bits.x);
  }

  void main() {
    vec2 pixel = vUv * uImageSize;
    uvec2 here = bitsAt(pixel);
    if (here == uvec2(0u)) {
      discard;
    }
    // Outline about OUTLINE_SCREEN_PX wide at any zoom, never thinner than one image pixel.
    vec2 step = max(fwidth(pixel) * ${OUTLINE_SCREEN_PX.toFixed(2)}, vec2(1.0));
    uvec2 inner = bitsAt(pixel + vec2(step.x, 0.0)) & bitsAt(pixel - vec2(step.x, 0.0)) &
      bitsAt(pixel + vec2(0.0, step.y)) & bitsAt(pixel - vec2(0.0, step.y));
    uvec2 edge = here & ~inner;
    uvec2 sel = uvec2(uSelLo, uSelHi);
    float alpha;
    int slot;
    if (edge != uvec2(0u)) {
      uvec2 pick = (edge & sel) != uvec2(0u) ? edge & sel : edge;
      slot = topSlot(pick);
      alpha = 1.0;
    } else {
      // Overlaps: a selected instance is drawn on top, otherwise the highest slot.
      uvec2 pick = (here & sel) != uvec2(0u) ? here & sel : here;
      slot = topSlot(pick);
      alpha = (here & sel) != uvec2(0u) ? min(1.0, uOpacity * ${SELECTED_FILL_GAIN.toFixed(2)}) : uOpacity;
    }
    // Class colours are sRGB and a raw ShaderMaterial (no colorspace_fragment include) writes them
    // unconverted to the sRGB canvas, so they match the hex colours shown in the editor UI.
    gl_FragColor = vec4(uColors[slot], alpha);
  }
`;

function bitmask(flags: readonly boolean[], from: number): number {
  let mask = 0;
  for (let slot = from; slot < Math.min(flags.length, from + 32); slot++) {
    if (flags[slot] === true) {
      mask |= 1 << (slot - from);
    }
  }
  return mask >>> 0;
}

/**
 * Drop the texture's reference to the CPU plane once the GPU has it. The plane belongs to the
 * shared cache; holding it here would keep an evicted frame's buffer alive for as long as the
 * panel shows nothing newer. Width and height stay, so same-size frames still reuse the storage.
 */
function releaseAfterUpload(texture: THREE.DataTexture): void {
  texture.onUpdate = () => {
    (texture.image as { data: unknown }).data = ReactNull;
  };
}

function planeTexture(planes: MaskPlanes, index: number): THREE.DataTexture {
  const type =
    planes.format === "R8UI"
      ? THREE.UnsignedByteType
      : planes.format === "R16UI"
        ? THREE.UnsignedShortType
        : THREE.UnsignedIntType;
  const texture = new THREE.DataTexture(
    planes.planes[index],
    planes.height,
    planes.width,
    THREE.RedIntegerFormat,
    type,
  );
  texture.internalFormat = planes.format;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  releaseAfterUpload(texture);
  texture.needsUpdate = true;
  return texture;
}

/**
 * GPU mask overlay for one Image panel. It shares the image's geometry and UVs, so it follows
 * zoom, pan, rotation, flips and distortion. It is updated in the same render frame right after
 * the image commits, and shows masks only for exactly that topic + log time; when the planes for
 * that frame are not built yet it draws nothing rather than a neighbouring frame.
 */
export class SegmentationMaskLayer {
  readonly #cache: MaskPlaneCache;
  readonly #material: THREE.ShaderMaterial;
  #mesh: THREE.Mesh | undefined;
  #textures: THREE.DataTexture[] = [];
  #textureGeometryId: number | undefined;
  #lastLogTimeNs: bigint | undefined;
  #lastTopic: string | undefined;
  /** Smoothed log-time step between successive displayed frames. */
  #displayStepNs = 0;
  readonly #dummy: THREE.DataTexture;
  readonly #unsubscribe: (() => void)[];

  public constructor(
    private readonly bridge: Pick<
      SegmentationPanelBridge,
      "maskOverlay" | "maskOverlayControls" | "maskPlanes"
    >,
    private readonly maxTextureSize: () => number,
    onChange: () => void,
  ) {
    this.#cache = bridge.maskPlanes.get();
    this.#dummy = new THREE.DataTexture(
      new Uint8Array(1),
      1,
      1,
      THREE.RedIntegerFormat,
      THREE.UnsignedByteType,
    );
    this.#dummy.internalFormat = "R8UI";
    this.#dummy.needsUpdate = true;
    this.#material = new THREE.ShaderMaterial({
      name: "SegmentationMaskOverlay",
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uPlane0: { value: this.#dummy },
        uPlane1: { value: this.#dummy },
        uTwoPlanes: { value: false },
        uImageSize: { value: new THREE.Vector2(1, 1) },
        uColors: { value: new Float32Array(MAX_MASK_SLOTS * 3) },
        uVisLo: { value: 0 },
        uVisHi: { value: 0 },
        uSelLo: { value: 0 },
        uSelHi: { value: 0 },
        uOpacity: { value: DEFAULT_FILL_OPACITY },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.#unsubscribe = [
      bridge.maskOverlay.subscribe(onChange),
      this.#cache.onReady(onChange),
      this.#cache.addConsumer(this),
    ];
    if (bridge.maskOverlayControls) {
      this.#unsubscribe.push(bridge.maskOverlayControls.subscribe(onChange));
    }
  }

  /** Call after the image renderable committed this frame's image. */
  public update(renderable: ImageRenderable | undefined): void {
    const shown = this.#resolve(renderable);
    if (this.#mesh) {
      this.#mesh.visible = shown;
    }
  }

  #resolve(renderable: ImageRenderable | undefined): boolean {
    const source = this.bridge.maskOverlay.get();
    const imageMesh = renderable?.userData.mesh;
    const displayed = renderable?.userData.displayedFrameState;
    if (!source || !renderable || !imageMesh || !displayed || !renderable.visible) {
      this.#cache.updateConsumer(this, { active: false });
      return false;
    }
    const topic = renderable.userData.topic;
    // The frame identity masks use. Annotation frames take logTimeNs from the same receiveTime
    // (sourceFrames.framesFromStamps), and for the MCAP sources of cloud records receiveTime is
    // the MCAP log time (McapIndexedIterableSource), which is also the backend's frame_time.
    const logTimeNs = displayed.receiveTime.toString();
    const frame = source.frame(topic, logTimeNs, this.bridge.maskOverlayControls?.getState());
    const prefetch = this.#prefetchWindow(topic, displayed.receiveTime);
    const upcoming = source.upcoming(topic, logTimeNs, prefetch);
    // Pin the drawn frame and take a prefetch share only while this panel has masks to show.
    this.#cache.updateConsumer(this, {
      active: frame != undefined || upcoming.length > 0,
      displayed: frame?.geometry.id,
    });
    if (upcoming.length > 0) {
      // Never more than this panel's share of the shared cache (see MaskPlaneCache.framesAhead).
      const sample = upcoming[0]!;
      const ahead = this.#cache.framesAhead(
        planeBytes(sample.width, sample.height, sample.counts.length),
        upcoming.length,
      );
      for (const geometry of upcoming.slice(0, ahead)) {
        this.#cache.request(geometry);
      }
    }
    if (!frame) {
      return false;
    }
    const { geometry, style } = frame;
    const maxTextureSize = this.maxTextureSize();
    if (Math.max(geometry.width, geometry.height) > maxTextureSize) {
      this.#reportError(
        `Mask ${geometry.width}×${geometry.height} exceeds MAX_TEXTURE_SIZE ${maxTextureSize}`,
      );
      return false;
    }
    const planes = this.#cache.get(geometry);
    if (!planes) {
      const error = this.#cache.error(geometry);
      if (error) {
        this.#reportError(error);
      }
      return false;
    }
    this.#upload(geometry.id, planes);
    this.#applyStyle(style, planes.slots);
    this.#attach(renderable, imageMesh);
    return true;
  }

  #prefetchWindow(
    topic: string,
    time: bigint,
  ): { minFrames: number; maxFrames: number; horizonNs: bigint } {
    const last = this.#lastLogTimeNs;
    if (
      last != undefined &&
      topic === this.#lastTopic &&
      time > last &&
      time - last < 2_000_000_000n
    ) {
      const step = Number(time - last);
      this.#displayStepNs =
        this.#displayStepNs === 0 ? step : this.#displayStepNs * 0.7 + step * 0.3;
    } else if (topic !== this.#lastTopic || last == undefined || time < last) {
      // New topic or a seek back: forget the old rate.
      this.#displayStepNs = 0;
    }
    this.#lastLogTimeNs = time;
    this.#lastTopic = topic;
    const wanted = BigInt(Math.round(this.#displayStepNs * 2));
    const horizonNs =
      wanted < PREFETCH_MIN_HORIZON_NS
        ? PREFETCH_MIN_HORIZON_NS
        : wanted > PREFETCH_MAX_HORIZON_NS
          ? PREFETCH_MAX_HORIZON_NS
          : wanted;
    return { minFrames: PREFETCH_MIN_FRAMES, maxFrames: PREFETCH_MAX_FRAMES, horizonNs };
  }

  #upload(geometryId: number, planes: MaskPlanes): void {
    if (this.#textureGeometryId === geometryId) {
      return;
    }
    const reuse =
      this.#textures.length === planes.planes.length &&
      this.#textures[0]!.image.width === planes.height &&
      this.#textures[0]!.image.height === planes.width &&
      this.#textures[0]!.internalFormat === planes.format;
    if (reuse) {
      // Same size and format: three re-uploads with texSubImage2D into the same storage.
      this.#textures.forEach((texture, index) => {
        // three types DataTexture data as 8-bit; 16/32-bit integer planes are valid for R16UI/R32UI.
        texture.image.data = planes.planes[index] as unknown as Uint8Array;
        texture.needsUpdate = true;
      });
    } else {
      this.#disposeTextures();
      this.#textures = planes.planes.map((_, index) => planeTexture(planes, index));
    }
    this.#textureGeometryId = geometryId;
    const uniforms = this.#material.uniforms;
    uniforms.uPlane0!.value = this.#textures[0];
    uniforms.uPlane1!.value = this.#textures[1] ?? this.#dummy;
    uniforms.uTwoPlanes!.value = this.#textures.length > 1;
    (uniforms.uImageSize!.value as THREE.Vector2).set(planes.width, planes.height);
  }

  #applyStyle(style: SegmentationMaskStyle, slots: number): void {
    const uniforms = this.#material.uniforms;
    const colors = uniforms.uColors!.value as Float32Array;
    for (let slot = 0; slot < slots; slot++) {
      const color = style.colors[slot] ?? FALLBACK_COLOR;
      colors.set(color, slot * 3);
    }
    uniforms.uVisLo!.value = bitmask(style.visible, 0);
    uniforms.uVisHi!.value = bitmask(style.visible, 32);
    uniforms.uSelLo!.value = bitmask(style.selected, 0);
    uniforms.uSelHi!.value = bitmask(style.selected, 32);
    uniforms.uOpacity!.value = style.opacity;
  }

  #attach(renderable: ImageRenderable, imageMesh: THREE.Mesh): void {
    if (!this.#mesh) {
      this.#mesh = new THREE.Mesh(imageMesh.geometry, this.#material);
      this.#mesh.name = "SegmentationMaskOverlay";
    }
    if (this.#mesh.parent !== renderable) {
      this.#mesh.removeFromParent();
      renderable.add(this.#mesh);
    }
    // The image rebuilds its geometry when the camera model or settings change.
    this.#mesh.geometry = imageMesh.geometry;
    this.#mesh.renderOrder = imageMesh.renderOrder + 1;
  }

  #reportError(message: string): void {
    if (!reportedErrors.has(message)) {
      reportedErrors.add(message);
      log.warn(message);
    }
  }

  #disposeTextures(): void {
    for (const texture of this.#textures) {
      texture.dispose();
    }
    this.#textures = [];
    this.#textureGeometryId = undefined;
  }

  public dispose(): void {
    for (const unsubscribe of this.#unsubscribe) {
      unsubscribe();
    }
    this.#mesh?.removeFromParent();
    this.#disposeTextures();
    this.#dummy.dispose();
    this.#material.dispose();
  }
}
