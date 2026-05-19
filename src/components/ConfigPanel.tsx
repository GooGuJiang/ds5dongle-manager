import { Gauge, Gamepad2, Volume2, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { UseDs5BridgeResult } from "../hooks/useDs5Bridge";
import { fieldIssue, ControllerMode, PollingRateMode } from "../protocol/config";
import { ControllerModeControl } from "./config/ControllerModeControl";
import { FloatControl } from "./config/FloatControl";
import { IntegerControl } from "./config/IntegerControl";
import { PollingRateControl } from "./config/PollingRateControl";
import { ToggleControl } from "./config/ToggleControl";
import { SwitchProgressDialog } from "./config/SwitchProgressDialog";

/** 进度条动画持续时间（毫秒），可修改此值调整等待时间 */
export const PROGRESS_ANIMATION_DURATION_MS = 5000;

interface ConfigPanelProps {
  bridge: UseDs5BridgeResult;
  /** 进度条对话框完全关闭后回调（用于通知 App 切换主页） */
  onProgressComplete?: () => void;
}

export function ConfigPanel({ bridge, onProgressComplete }: ConfigPanelProps) {
  const { t } = useTranslation();
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [progressTitle, setProgressTitle] = useState("");
  const [progressDescription, setProgressDescription] = useState("");
  const [progress, setProgress] = useState(0);

  const progressValueRef = useRef(0);
  const progressFrameRef = useRef<number | null>(null);
  const timeoutIdsRef = useRef<number[]>([]);
  const prevOperationRef = useRef(bridge.operation);
  const switchRunIdRef = useRef(0);
  const finishingRef = useRef(false);
  const onProgressCompleteRef = useRef(onProgressComplete);

  onProgressCompleteRef.current = onProgressComplete;

  const setProgressValue = useCallback((value: number) => {
    const nextValue = Math.max(0, Math.min(100, value));
    progressValueRef.current = nextValue;
    setProgress(nextValue);
  }, []);

  const setProgressValueMonotonic = useCallback((value: number) => {
    setProgressValue(Math.max(progressValueRef.current, value));
  }, [setProgressValue]);

  const clearManagedTimeouts = useCallback(() => {
    timeoutIdsRef.current.forEach((id) => window.clearTimeout(id));
    timeoutIdsRef.current = [];
  }, []);

  const delay = useCallback((ms: number) => {
    return new Promise<void>((resolve) => {
      const id = window.setTimeout(() => {
        timeoutIdsRef.current = timeoutIdsRef.current.filter(
          (timeoutId) => timeoutId !== id,
        );
        resolve();
      }, ms);

      timeoutIdsRef.current.push(id);
    });
  }, []);

  const stopProgressAnimation = useCallback(() => {
    if (progressFrameRef.current !== null) {
      window.cancelAnimationFrame(progressFrameRef.current);
      progressFrameRef.current = null;
    }
  }, []);

  const animateProgressTo = useCallback(
    (to: number, durationMs: number, runId: number): Promise<void> => {
      stopProgressAnimation();

      const from = progressValueRef.current;
      const startedAt = performance.now();

      return new Promise((resolve) => {
        const tick = (now: number) => {
          if (switchRunIdRef.current !== runId) {
            progressFrameRef.current = null;
            resolve();
            return;
          }

          const elapsed = now - startedAt;
          const ratio = durationMs <= 0 ? 1 : Math.min(1, elapsed / durationMs);
          setProgressValueMonotonic(from + (to - from) * ratio);

          if (ratio >= 1) {
            progressFrameRef.current = null;
            resolve();
            return;
          }

          progressFrameRef.current = window.requestAnimationFrame(tick);
        };

        progressFrameRef.current = window.requestAnimationFrame(tick);
      });
    },
    [setProgressValueMonotonic, stopProgressAnimation],
  );

  const startProgressAnimation = useCallback(
    (title: string, description: string) => {
      const runId = switchRunIdRef.current + 1;
      switchRunIdRef.current = runId;
      finishingRef.current = false;

      clearManagedTimeouts();
      stopProgressAnimation();

      setProgressTitle(title);
      setProgressDescription(description);
      setProgressValue(0);
      setShowProgressDialog(true);

      // 操作执行期间最多走到 90%，等待真正完成后再补到 100%
      animateProgressTo(90, PROGRESS_ANIMATION_DURATION_MS, runId);
    },
    [
      animateProgressTo,
      clearManagedTimeouts,
      setProgressValue,
      stopProgressAnimation,
    ],
  );

  const finishProgressAndReturnHome = useCallback(
    async (runId: number) => {
      if (finishingRef.current || switchRunIdRef.current !== runId) {
        return;
      }

      finishingRef.current = true;

      const remainingProgress = 100 - progressValueRef.current;
      const finishDurationMs = Math.max(300, remainingProgress * 10);

      await animateProgressTo(100, finishDurationMs, runId);

      if (switchRunIdRef.current !== runId) {
        return;
      }

      setProgressValue(100);

      // 让用户看到 100%
      await delay(800);

      if (switchRunIdRef.current !== runId) {
        return;
      }

      setShowProgressDialog(false);

      // 等待 Dialog 关闭动画结束
      await delay(250);

      if (switchRunIdRef.current !== runId) {
        return;
      }

      setProgressValue(0);
      finishingRef.current = false;

      // 只有这里允许通知 App 返回主页
      onProgressCompleteRef.current?.();
    },
    [animateProgressTo, delay, setProgressValue],
  );

  useEffect(() => {
    const prevOperation = prevOperationRef.current;
    prevOperationRef.current = bridge.operation;

    if (
      showProgressDialog &&
      bridge.operation === null &&
      prevOperation !== null
    ) {
      void finishProgressAndReturnHome(switchRunIdRef.current);
    }
  }, [bridge.operation, finishProgressAndReturnHome, showProgressDialog]);

  useEffect(() => {
    return () => {
      switchRunIdRef.current += 1;
      clearManagedTimeouts();
      stopProgressAnimation();
    };
  }, [clearManagedTimeouts, stopProgressAnimation]);

  // 处理回报率切换
  const handlePollingRateChange = (value: PollingRateMode) => {
    const isChanged = bridge.draft.pollingRateMode !== value;

    if (isChanged && bridge.isConnected) {
      startProgressAnimation(
        t("config.switchingPollingRate"),
        t("config.switchingPollingRateDescription"),
      );
    }

    bridge.setDraftField("pollingRateMode", value);
  };

  // 处理模式切换
  const handleControllerModeChange = (value: ControllerMode) => {
    const isChanged = bridge.draft.controllerMode !== value;

    if (isChanged && bridge.isConnected) {
      startProgressAnimation(
        t("config.switchingControllerMode"),
        t("config.switchingControllerModeDescription"),
      );
    }

    bridge.setDraftField("controllerMode", value);
  };

  return (
    <>
      <Card className="panel config-panel">
        <CardContent className="config-sections p-0">
          <section className="config-section config-section-featured">
            <div className="config-section-heading">
              <span className="config-section-icon">
                <Volume2 size={17} />
              </span>
              <div>
                <h3>{t("config.sections.feedback")}</h3>
                <p>{t("config.sections.feedbackDescription")}</p>
              </div>
            </div>
            <div className="control-stack">
              <FloatControl
                label={t("config.hapticsGain")}
                description={t("config.hapticsGainDescription")}
                value={bridge.draft.hapticsGain}
                min={1}
                max={2}
                step={0.05}
                issue={fieldIssue(bridge.issues, "hapticsGain")}
                onChange={(value) => bridge.setDraftField("hapticsGain", value)}
              />
              <FloatControl
                label={`${t("config.speakerVolume")} (%)`}
                description={t("config.speakerVolumeDescription")}
                value={bridge.draft.speakerVolume}
                min={-100}
                max={0}
                step={0.01}
                displayMin={0}
                displayMax={100}
                displayStep={1}
                valueToDisplay={speakerVolumeToPercent}
                displayToValue={percentToSpeakerVolume}
                fractionDigits={0}
                issue={fieldIssue(bridge.issues, "speakerVolume")}
                onChange={(value) => bridge.setDraftField("speakerVolume", value)}
              />
              <IntegerControl
                label={t("config.hapticsBufferLength")}
                description={t("config.hapticsBufferLengthDescription")}
                value={bridge.draft.hapticsBufferLength}
                min={16}
                max={128}
                issue={fieldIssue(bridge.issues, "hapticsBufferLength")}
                onChange={(value) => bridge.setDraftField("hapticsBufferLength", value)}
              />
            </div>
          </section>

          <section className="config-section">
            <div className="config-section-heading">
              <span className="config-section-icon">
                <Zap size={17} />
              </span>
              <div>
                <h3>{t("config.sections.power")}</h3>
                <p>{t("config.sections.powerDescription")}</p>
              </div>
            </div>
            <div className="control-stack compact-stack">
              <IntegerControl
                label={`${t("config.inactiveTime")} (${t("config.inactiveTimeUnit")})`}
                description={t("config.inactiveTimeDescription")}
                value={bridge.draft.inactiveTime}
                min={5}
                max={60}
                issue={fieldIssue(bridge.issues, "inactiveTime")}
                onChange={(value) => bridge.setDraftField("inactiveTime", value)}
              />
              <ToggleControl
                label={t("config.disableInactiveDisconnect")}
                value={bridge.draft.disableInactiveDisconnect}
                onChange={(value) => bridge.setDraftField("disableInactiveDisconnect", value)}
              />
              <ToggleControl
                label={t("config.disablePicoLed")}
                value={bridge.draft.disablePicoLed}
                onChange={(value) => bridge.setDraftField("disablePicoLed", value)}
              />
            </div>
          </section>

          <section className="config-section">
            <div className="config-section-heading">
              <span className="config-section-icon">
                <Gauge size={17} />
              </span>
              <div>
                <h3>{t("config.sections.performance")}</h3>
                <p>{t("config.sections.performanceDescription")}</p>
              </div>
            </div>
            <div className="control-stack compact-stack">
              <PollingRateControl
                value={bridge.draft.pollingRateMode}
                onChange={handlePollingRateChange}
              />
            </div>
          </section>

          <section className="config-section">
            <div className="config-section-heading">
              <span className="config-section-icon">
                <Gamepad2 size={17} />
              </span>
              <div>
                <h3>{t("config.sections.compatibility")}</h3>
                <p>{t("config.sections.compatibilityDescription")}</p>
              </div>
            </div>
            <div className="control-stack compact-stack">
              <ControllerModeControl
                value={bridge.draft.controllerMode}
                onChange={handleControllerModeChange}
              />
            </div>
          </section>
        </CardContent>
      </Card>
      <SwitchProgressDialog
        open={showProgressDialog}
        title={progressTitle}
        description={progressDescription}
        progress={progress}
      />
    </>
  );
}

function speakerVolumeToPercent(value: number): number {
  if (value <= -100) {
    return 0;
  }

  return Math.min(100, Math.max(0, 100 * 10 ** (value / 20)));
}

function percentToSpeakerVolume(value: number): number {
  if (value <= 0) {
    return -100;
  }

  return Math.min(0, Math.max(-100, 20 * Math.log10(value / 100)));
}
