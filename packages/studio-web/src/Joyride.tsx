// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useState } from "react";
import Joyride, { Step } from "react-joyride";

export function JoyrideWrapper(): JSX.Element {
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const isDemoSite =
    localStorage.getItem("demoSite") === "true" && localStorage.getItem("joyrideStepIndex") === "5";

  useEffect(() => {
    if (isDemoSite) {
      window.nextStep = () => {
        setStepIndex((prev) => prev + 1);
      };
    }
  }, [isDemoSite]);

  const steps: Step[] = [
    {
      disableBeacon: true,
      spotlightClicks: true,
      styles: {
        buttonNext: {
          display: "none",
        },
      },
      content: (
        <div style={{ textAlign: "left", fontSize: "14px", lineHeight: "20px" }}>
          <div
            style={{
              paddingBottom: "8px",
            }}
          >
            <span
              style={{
                fontWeight: "700",
              }}
            >
              播放记录
            </span>{" "}
            （1/9）
          </div>
          <div>点击开始播放</div>
        </div>
      ),
      target: "#play-pause-button",
    },
    {
      disableBeacon: true,
      content: (
        <div style={{ textAlign: "left", fontSize: "14px", lineHeight: "20px" }}>
          <div
            style={{
              paddingBottom: "8px",
            }}
          >
            <span
              style={{
                fontWeight: "700",
              }}
            >
              三维视图
            </span>{" "}
            （2/9）
          </div>
          <div>展示激光点云，运动状态，地图等信息</div>
        </div>
      ),
      target: ".mosaic-tile .mosaic-tile ~ .mosaic-tile ~ .mosaic-tile ~ .mosaic-tile",
    },
    {
      content: (
        <div style={{ textAlign: "left", fontSize: "14px", lineHeight: "20px" }}>
          <div
            style={{
              paddingBottom: "8px",
            }}
          >
            <span
              style={{
                fontWeight: "700",
              }}
            >
              实时视频
            </span>{" "}
            （3/9）
          </div>
          <div>展示摄像头信息</div>
        </div>
      ),
      target: ".mosaic-tile .mosaic-tile",
    },
    {
      content: (
        <div style={{ textAlign: "left", fontSize: "14px", lineHeight: "20px" }}>
          <div
            style={{
              paddingBottom: "8px",
            }}
          >
            <span
              style={{
                fontWeight: "700",
              }}
            >
              下发速度
            </span>{" "}
            （4/9）
          </div>
          <div>机器速度曲线图</div>
        </div>
      ),
      target: ".mosaic-tile .mosaic-tile ~ .mosaic-tile",
    },
    {
      content: (
        <div style={{ textAlign: "left", fontSize: "14px", lineHeight: "20px" }}>
          <div
            style={{
              paddingBottom: "8px",
            }}
          >
            <span
              style={{
                fontWeight: "700",
              }}
            >
              原始消息
            </span>{" "}
            （5/9）
          </div>
          <div>机器原始数据</div>
        </div>
      ),
      target: ".mosaic-tile .mosaic-tile ~ .mosaic-tile ~ .mosaic-tile",
    },
    {
      content: (
        <div style={{ textAlign: "left", fontSize: "14px", lineHeight: "20px" }}>
          <div
            style={{
              paddingBottom: "8px",
            }}
          >
            <span
              style={{
                fontWeight: "700",
              }}
            >
              日志
            </span>{" "}
            （6/9）
          </div>
          <div>机器日志，实时滚动播放</div>
        </div>
      ),
      target:
        ".mosaic-tile .mosaic-tile ~ .mosaic-tile ~ .mosaic-tile ~ .mosaic-tile ~ .mosaic-tile",
      placement: "left",
    },
    {
      spotlightClicks: true,
      styles: {
        buttonNext: {
          display: "none",
        },
      },
      content: (
        <div style={{ textAlign: "left", fontSize: "14px", lineHeight: "20px" }}>
          <div
            style={{
              paddingBottom: "8px",
            }}
          >
            <span
              style={{
                fontWeight: "700",
              }}
            >
              创建一刻
            </span>{" "}
            （7/9）
          </div>
          <div>点击创建“一刻”，标记发生故障的关键帧</div>
        </div>
      ),
      target: "#create-moment-dialog-button",
      placement: "top",
    },
    {
      spotlightClicks: true,
      content: (
        <div style={{ textAlign: "left", fontSize: "14px", lineHeight: "20px" }}>
          <div
            style={{
              paddingBottom: "8px",
            }}
          >
            <span
              style={{
                fontWeight: "700",
              }}
            >
              创建一刻
            </span>{" "}
            （8/9）
          </div>
          <div>在弹窗中填写一刻的名称、持续时间、描述等信息，即可完成一刻的创建</div>
        </div>
      ),
      target: "#create-moment",
    },
    {
      spotlightClicks: true,
      hideFooter: true,
      content: (
        <div style={{ textAlign: "left", fontSize: "14px", lineHeight: "20px" }}>
          <div
            style={{
              paddingBottom: "8px",
            }}
          >
            <span
              style={{
                fontWeight: "700",
              }}
            >
              创建任务
            </span>{" "}
            （9/9）
          </div>
          <div>
            在弹窗中填写任务的名称、描述、经办人等信息，即完成任务的创建；默认“经办人”为您自己
          </div>
        </div>
      ),
      target: "#create-task-btn",
    },
  ];

  useEffect(() => {
    setTimeout(() => {
      setRun(true);
    }, 2000);
  }, []);

  return (
    <Joyride
      steps={steps}
      stepIndex={stepIndex}
      run={isDemoSite ? run : false}
      locale={{
        back: "上一步",
        next: "下一步",
        skip: "全部跳过",
        last: "下一步",
      }}
      callback={(data) => {
        const { action, index, lifecycle } = data;
        if (action === "next" && lifecycle === "complete" && index === stepIndex) {
          setStepIndex((ele) => ele + 1);
        }
        if (action === "prev" && lifecycle === "complete" && index === stepIndex) {
          setStepIndex((ele) => ele - 1);
        }
        if (action === "skip") {
          localStorage.setItem("joyrideStepIndex", "7");
        }
      }}
      showSkipButton
      disableOverlayClose
      disableCloseOnEsc
      hideCloseButton
      continuous
      styles={{
        options: {
          arrowColor: "#3B82F6",
          backgroundColor: "#3B82F6",
          overlayColor: "rgba(0, 0, 0, 0.5)",
          spotlightShadow: "0 0 15px rgba(255, 0, 0, 0.5)",
          textColor: "#ffffff",
          zIndex: 9999999,
        },
        buttonBack: {
          color: "#FFF",
          borderRadius: "4px",
          border: "1px solid var(--default-white, #FFF)",
          display: "inline-flex",
          height: "24px",
          padding: "6px 10px",
          justifyContent: "center",
          alignItems: "center",
          gap: "5px",
          flexShrink: 0,
          fontSize: "12px",
          lineHeight: "20px",
        },
        buttonNext: {
          backgroundColor: "#FFF",
          borderRadius: "4px",
          border: "1px solid var(--default-white, #FFF)",
          display: "inline-flex",
          height: "24px",
          padding: "6px 10px",
          justifyContent: "center",
          alignItems: "center",
          gap: "5px",
          flexShrink: 0,
          color: "var(--default-purple-800, #5B21B6)",
          fontSize: "12px",
          lineHeight: "20px",
        },
      }}
    />
  );
}
