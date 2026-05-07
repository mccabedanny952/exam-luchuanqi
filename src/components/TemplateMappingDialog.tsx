"use client";

import { useMemo, useState } from "react";
import type { MappingState } from "@/utils/excel-tools";
import { SYSTEM_FIELDS, getMappingConfidence } from "@/utils/excel-tools";
import styles from "./TemplateMappingDialog.module.css";

interface TemplateMappingDialogProps {
  isOpen: boolean;
  headers: string[];
  initialMapping: MappingState;
  onConfirm: (mapping: MappingState) => void;
  onCancel: () => void;
}

export default function TemplateMappingDialog({
  isOpen,
  headers,
  initialMapping,
  onConfirm,
  onCancel,
}: TemplateMappingDialogProps) {
  const [draftMapping, setDraftMapping] = useState<MappingState>(initialMapping);

  const coverage = useMemo(() => getMappingConfidence(draftMapping), [draftMapping]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <div className={styles.hero}>
          <div>
            <p>需要人工辅助映射</p>
            <h2>请指定 Excel 列与系统字段的对应关系</h2>
            <span>你的选择会被自动记忆，下次同结构模板将直接套用。</span>
          </div>
          <div className={styles.coverageCard}>
            <strong>{coverage.mapped}/{coverage.total}</strong>
            <span>必填字段已匹配</span>
          </div>
        </div>

        <div className={styles.mappingList}>
          {SYSTEM_FIELDS.map((field) => (
            <div key={field.key} className={styles.mappingRow}>
              <div className={styles.fieldBlock}>
                <strong>{field.label}</strong>
                <span>{field.required ? "必填" : "选填"}</span>
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
                <option value="">请选择 Excel 列</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className={styles.actions}>
          <button className={styles.secondaryButton} onClick={onCancel}>
            取消上传
          </button>
          <button className={styles.primaryButton} onClick={() => onConfirm(draftMapping)}>
            确认映射并导入
          </button>
        </div>
      </div>
    </div>
  );
}
