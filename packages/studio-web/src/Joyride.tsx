// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Joyride, { Step } from "react-joyride";

export function JoyrideWrapper(): JSX.Element {
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const { t } = useTranslation("cosGuide");
  const isDemoSite =
    localStorage.getItem("demoSite") === "true" &&
    localStorage.getItem("honeybeeDemoStatus") === "start";

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
              {t("playbackRecord")}
            </span>{" "}
            （1/10）
          </div>
          <div>{t("clickToStartPlaying")}</div>
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
              {t("threeDeeView")}
            </span>{" "}
            （2/10）
          </div>
          <div>{t("threeDeeViewDesc")}</div>
        </div>
      ),
      target:
        ".mosaic-tile .mosaic-tile ~ .mosaic-tile ~ .mosaic-tile ~ .mosaic-tile ~ .mosaic-tile",
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
              {t("liveVideo")}
            </span>{" "}
            （3/10）
          </div>
          <div>{t("liveVideoDesc")}</div>
        </div>
      ),
      target: ".mosaic-tile .mosaic-tile .mosaic-tile .mosaic-tile",
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
              {t("log")}
            </span>{" "}
            （4/10）
          </div>
          <div>{t("logDesc")}</div>
        </div>
      ),
      target:
        ".mosaic-root > .mosaic-tile:last-child > div > div > .mosaic-root > .mosaic-tile:last-child",
      placement: "left",
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
              {t("planningInformation")}
            </span>{" "}
            （5/10）
          </div>
          <div>{t("planningInformationDesc")}</div>
        </div>
      ),
      target: ".mosaic-root  .mosaic-root > .mosaic-tile",
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
              {t("dispatchSpeed")}
            </span>{" "}
            （6/10）
          </div>
          <div>{t("dispatchSpeedDesc")}</div>
        </div>
      ),
      target: ".mosaic-root  .mosaic-root > .mosaic-tile",
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
              {t("originalMessage")}
            </span>{" "}
            （7/10）
          </div>
          <div>{t("originalMessageDesc")}</div>
        </div>
      ),
      target: ".mosaic-root  .mosaic-root > .mosaic-tile",
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
              {t("createMoment")}
            </span>{" "}
            （8/10）
          </div>
          <div>{t("createMomentDesc")}</div>
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
              {t("createMoment")}
            </span>{" "}
            （9/10）
          </div>
          <div>{t("createMomentFormDesc")}</div>
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
              {t("createTask")}
            </span>{" "}
            （10/10）
          </div>
          <div>{t("createTaskDesc")}</div>
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
        back: t("previousStep"),
        next: t("nextStep"),
        skip: t("skipAll"),
        last: t("nextStep"),
      }}
      callback={(data) => {
        const { action, index, lifecycle } = data;
        // switch tab
        if (action === "next" && lifecycle === "complete" && index === stepIndex) {
          if (stepIndex === 3) {
            document
              .querySelector("[title=规划]")
              ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          }
          if (stepIndex === 4) {
            document
              .querySelector("[title=控制]")
              ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          }
          if (stepIndex === 5) {
            document
              .querySelector("[title=诊断]")
              ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          }
          setTimeout(() => {
            setStepIndex((ele) => ele + 1);
          }, 100);
        }
        if (action === "prev" && lifecycle === "complete" && index === stepIndex) {
          if (stepIndex === 4) {
            document
              .querySelector("[title=洞察]")
              ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          }
          if (stepIndex === 5) {
            document
              .querySelector("[title=规划]")
              ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          }
          if (stepIndex === 6) {
            document
              .querySelector("[title=控制]")
              ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          }
          if (stepIndex === 7) {
            document
              .querySelector("[title=诊断]")
              ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          }
          setTimeout(() => {
            setStepIndex((ele) => ele - 1);
          }, 100);
        }
        if (action === "skip") {
          localStorage.setItem("honeybeeDemoStatus", "skip");
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
