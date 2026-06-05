"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import type { MappingState, ParsingRule, RuleMode, SheetMode } from "@/utils/excel-tools";
import { SYSTEM_FIELDS, getMappingConfidence, normalizeRule } from "@/utils/excel-tools";
import styles from "./TemplateMappingDialog.module.css";

interface TemplateMappingDialogProps {
  isOpen: boolean;
  headers: string[];
  initialRule: ParsingRule;
  confirmLabel?: string;
  onConfirm: (rule: ParsingRule) => void;
  onCancel: () => void;
}

const MODE_OPTIONS: Array<{ value: RuleMode; label: string; desc: string }> = [
  { value: "column", label: "普通表格", desc: "表头 + 明细行 + 尾部补充信息" },
  { value: "card", label: "卡片式", desc: "每条记录有独立收货信息和小表格" },
  { value: "matrix", label: "矩阵转置", desc: "门店或日期横向展开，需要转明细" },
  { value: "text", label: "文本/PDF", desc: "Word、PDF 或多单纯文本解析" },
];

function toPrettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseJsonField<T>(value: string, fallback: T): T {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return JSON.parse(trimmed) as T;
}

export default function TemplateMappingDialog({
  isOpen,
  headers,
  initialRule,
  confirmLabel = "确认并生成明细",
  onConfirm,
  onCancel,
}: TemplateMappingDialogProps) {
  const [draftName, setDraftName] = useState(initialRule.name);
  const [mode, setMode] = useState<RuleMode>(initialRule.mode);
  const [sheetMode, setSheetMode] = useState<SheetMode>(initialRule.sheetMode);
  const [headerRowIndex, setHeaderRowIndex] = useState(
    typeof initialRule.headerRowIndex === "number" ? String(initialRule.headerRowIndex + 1) : "",
  );
  const [draftMapping, setDraftMapping] = useState<MappingState>(initialRule.mapping);
  const [footerJson, setFooterJson] = useState(toPrettyJson(initialRule.footerExtractors ?? []));
  const [defaultsJson, setDefaultsJson] = useState(toPrettyJson(initialRule.defaults ?? {}));
  const [notesText, setNotesText] = useState((initialRule.aiNotes ?? []).join("\n"));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timer = window.setTimeout(() => {
      setDraftName(initialRule.name);
      setMode(initialRule.mode);
      setSheetMode(initialRule.sheetMode);
      setHeaderRowIndex(
        typeof initialRule.headerRowIndex === "number" ? String(initialRule.headerRowIndex + 1) : "",
      );
      setDraftMapping(initialRule.mapping);
      setFooterJson(toPrettyJson(initialRule.footerExtractors ?? []));
      setDefaultsJson(toPrettyJson(initialRule.defaults ?? {}));
      setNotesText((initialRule.aiNotes ?? []).join("\n"));
      setError("");
    }, 0);

    return () => window.clearTimeout(timer);
  }, [initialRule, isOpen]);

  const coverage = useMemo(() => getMappingConfidence(draftMapping), [draftMapping]);

  const headerOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...headers.filter(Boolean),
          ...SYSTEM_FIELDS.map((field) => field.label),
        ]),
      ),
    [headers],
  );

  const handleConfirm = () => {
    try {
      const nextRule = normalizeRule(
        {
          ...initialRule,
          name: draftName,
          mode,
          sheetMode,
          mapping: draftMapping,
          headerRowIndex: headerRowIndex ? Math.max(0, Number(headerRowIndex) - 1) : undefined,
          footerExtractors: parseJsonField(footerJson, []),
          defaults: parseJsonField(defaultsJson, {}),
          aiNotes: notesText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
        },
        headers,
        draftName,
      );
      onConfirm(nextRule);
    } catch {
      setError("高级配置 JSON 格式不正确，请修正后再确认。");
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <div className={styles.hero}>
          <div>
            <p>Field Mapping Check</p>
            <h2>字段映射校准</h2>
            <span>确认来源字段、处理模式和补充参数；通过后可写入规则库并生成核对明细。</span>
          </div>
          <div className={styles.coverageCard}>
            <strong>{coverage.mapped}/{coverage.total}</strong>
            <span>字段覆盖</span>
          </div>
        </div>

        <div className={styles.metaGrid}>
          <label>
            <span>规则名称</span>
            <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
          </label>
          <label>
            <span>处理模式</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as RuleMode)}>
              {MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} - {option.desc}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Sheet 范围</span>
            <select value={sheetMode} onChange={(event) => setSheetMode(event.target.value as SheetMode)}>
              <option value="all">全部 Sheet 合并</option>
              <option value="first">仅首个匹配 Sheet</option>
            </select>
          </label>
          <label>
            <span>表头行号</span>
            <input
              value={headerRowIndex}
              onChange={(event) => setHeaderRowIndex(event.target.value)}
              placeholder="留空自动识别"
            />
          </label>
        </div>

        <div className={styles.mappingList}>
          {SYSTEM_FIELDS.map((field) => (
            <div key={field.key} className={styles.mappingRow}>
              <div className={styles.fieldBlock}>
                <strong>{field.label}</strong>
                <span>
                  {field.required ? "必填" : field.group === "receiver" ? "A/B 组校验" : "选填"}
                </span>
              </div>
              <select
                value={draftMapping[field.key] || ""}
                onChange={(event) =>
                  setDraftMapping((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              >
                <option value="">不映射</option>
                {headerOptions.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className={styles.advancedGrid}>
          <label>
            <span>补充信息提取</span>
            <textarea value={footerJson} onChange={(event) => setFooterJson(event.target.value)} />
          </label>
          <label>
            <span>默认值</span>
            <textarea value={defaultsJson} onChange={(event) => setDefaultsJson(event.target.value)} />
          </label>
        </div>

        <label className={styles.notesBox}>
          <span>字段判断说明</span>
          <textarea value={notesText} onChange={(event) => setNotesText(event.target.value)} />
        </label>

        {error && <div className={styles.errorText}>{error}</div>}

        <div className={styles.actions}>
          <button
            className={styles.secondaryButton}
            onClick={() => {
              setDraftName(initialRule.name);
              setMode(initialRule.mode);
              setSheetMode(initialRule.sheetMode);
              setDraftMapping(initialRule.mapping);
              setFooterJson(toPrettyJson(initialRule.footerExtractors ?? []));
              setDefaultsJson(toPrettyJson(initialRule.defaults ?? {}));
              setNotesText((initialRule.aiNotes ?? []).join("\n"));
              setError("");
            }}
          >
            <RotateCcw size={16} />
            恢复草稿
          </button>
          <button className={styles.secondaryButton} onClick={onCancel}>
            取消
          </button>
          <button className={styles.primaryButton} onClick={handleConfirm}>
            <Check size={16} />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
