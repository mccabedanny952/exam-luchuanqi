"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { MappingState, ParsedRow, ValidationIssue } from "@/utils/excel-tools";
import { SYSTEM_FIELDS } from "@/utils/excel-tools";
import styles from "./EditableGrid.module.css";

interface EditableGridProps {
  data: ParsedRow[];
  mapping: MappingState;
  onDataChange: (rows: ParsedRow[]) => void;
  onValidationComplete: (isValid: boolean, issues: ValidationIssue[]) => void;
}

export default function EditableGrid({
  data,
  mapping,
  onDataChange,
  onValidationComplete,
}: EditableGridProps) {
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; fieldKey: string } | null>(null);
  const [dbDuplicates, setDbDuplicates] = useState<Set<string>>(new Set());
  const lastCodesKeyRef = useRef("");
  const deferredData = useDeferredValue(data);

  useEffect(() => {
    if (!mapping.externalCode) {
      return;
    }

    const codes = deferredData
      .map((row) => String(row[mapping.externalCode ?? ""] ?? "").trim())
      .filter((value) => value !== "");

    const codesKey = [...codes].sort().join(",");
    if (codesKey === lastCodesKeyRef.current) {
      return;
    }
    lastCodesKeyRef.current = codesKey;

    if (codes.length === 0) {
      Promise.resolve().then(() => setDbDuplicates(new Set()));
      return;
    }

    const uniqueCodes = [...new Set(codes)];
    fetch("/api/orders/check-duplicates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: uniqueCodes }),
    })
      .then((response) => response.json())
      .then((payload) => {
        setDbDuplicates(new Set(payload.duplicates || []));
      })
      .catch(() => {
        setDbDuplicates(new Set());
      });
  }, [deferredData, mapping]);

  const validationIssues = useMemo<ValidationIssue[]>(() => {
    const nextIssues: ValidationIssue[] = [];
    const activeDbDuplicates = mapping.externalCode ? dbDuplicates : new Set<string>();

    const externalCodeMap = new Map<string, number[]>();
    if (mapping.externalCode) {
      deferredData.forEach((row, rowIndex) => {
        const code = String(row[mapping.externalCode ?? ""] ?? "").trim();
        if (!code) {
          return;
        }
        const group = externalCodeMap.get(code) ?? [];
        group.push(rowIndex);
        externalCodeMap.set(code, group);
      });
    }

    deferredData.forEach((row, rowIndex) => {
      SYSTEM_FIELDS.forEach((field) => {
        const sourceHeader = mapping[field.key];
        if (!sourceHeader) {
          if (field.required) {
            nextIssues.push({ rowIndex, fieldKey: field.key, msg: "字段未映射" });
          }
          return;
        }

        const rawValue = row[sourceHeader];
        const textValue = String(rawValue ?? "").trim();

        if (field.required && textValue === "") {
          nextIssues.push({ rowIndex, fieldKey: field.key, msg: "必填字段缺失" });
          return;
        }

        if (textValue === "") {
          return;
        }

        if (field.key === "senderPhone" || field.key === "receiverPhone") {
          const digits = textValue.replace(/\D/g, "");
          if (digits.length < 7 || digits.length > 15) {
            nextIssues.push({ rowIndex, fieldKey: field.key, msg: "电话格式错误" });
          }
        }

        if (field.key === "weight") {
          const weight = parseFloat(textValue);
          if (Number.isNaN(weight) || weight <= 0) {
            nextIssues.push({ rowIndex, fieldKey: field.key, msg: "必须为正数" });
          }
        }

        if (field.key === "count") {
          const count = Number(textValue);
          if (Number.isNaN(count) || !Number.isInteger(count) || count <= 0) {
            nextIssues.push({ rowIndex, fieldKey: field.key, msg: "必须为正整数" });
          }
        }

        if (field.key === "tempZone") {
          const allowed = ["常温", "冷藏", "冷冻"];
          if (!allowed.includes(textValue)) {
            nextIssues.push({
              rowIndex,
              fieldKey: field.key,
              msg: "不在允许范围内(常温/冷藏/冷冻)",
            });
          }
        }

        if (field.key === "externalCode" && textValue) {
          const duplicateRows = externalCodeMap.get(textValue);
          if (duplicateRows && duplicateRows.length > 1) {
            const rowLabels = duplicateRows
              .filter((index) => index !== rowIndex)
              .map((index) => deferredData[index]?._originalRowIndex ?? index + 1);
            nextIssues.push({
              rowIndex,
              fieldKey: field.key,
              msg: `批次内重复，与第 ${rowLabels.join(", ")} 行重复`,
            });
          }

          if (activeDbDuplicates.has(textValue)) {
            nextIssues.push({
              rowIndex,
              fieldKey: field.key,
              msg: "与数据库中已有数据重复",
            });
          }
        }
      });
    });

    return nextIssues;
  }, [dbDuplicates, deferredData, mapping]);

  useEffect(() => {
    onValidationComplete(validationIssues.length === 0, validationIssues);
  }, [onValidationComplete, validationIssues]);

  const updateCell = (rowIndex: number, fieldKey: string, nextValue: string) => {
    const sourceHeader = mapping[fieldKey as keyof MappingState];
    if (!sourceHeader) {
      return;
    }

    if (String(data[rowIndex]?.[sourceHeader] ?? "") === nextValue) {
      return;
    }

    startTransition(() => {
      const nextRows = [...data];
      nextRows[rowIndex] = {
        ...nextRows[rowIndex],
        [sourceHeader]: nextValue,
      };
      onDataChange(nextRows);
    });
  };

  const jumpToNextCell = (rowIndex: number, fieldKey: string, reverse = false) => {
    const fieldIndex = SYSTEM_FIELDS.findIndex((field) => field.key === fieldKey);
    if (fieldIndex === -1) {
      return;
    }

    if (reverse) {
      const prevField = SYSTEM_FIELDS[fieldIndex - 1];
      if (prevField) {
        setTimeout(() => setEditingCell({ rowIndex, fieldKey: prevField.key }), 30);
      }
      return;
    }

    const nextField = SYSTEM_FIELDS[fieldIndex + 1];
    if (nextField) {
      setTimeout(() => setEditingCell({ rowIndex, fieldKey: nextField.key }), 30);
    } else if (rowIndex + 1 < data.length) {
      setTimeout(() => setEditingCell({ rowIndex: rowIndex + 1, fieldKey: SYSTEM_FIELDS[0].key }), 30);
    }
  };

  return (
    <div className={styles.frame}>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.indexCol}>行号</th>
              {SYSTEM_FIELDS.map((field) => (
                <th key={field.key}>
                  {field.label}
                  {field.required && <span className={styles.required}>*</span>}
                  {!mapping[field.key] && <span className={styles.unmapped}> 未映射</span>}
                </th>
              ))}
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIndex) => {
              const rowIssues = validationIssues.filter((issue) => issue.rowIndex === rowIndex);
              return (
                <tr key={`${row._originalRowIndex}-${rowIndex}`} className={rowIssues.length ? styles.rowWarn : ""}>
                  <td className={styles.indexCol}>{row._originalRowIndex}</td>
                  {SYSTEM_FIELDS.map((field) => {
                    const sourceHeader = mapping[field.key];
                    const cellValue = sourceHeader ? row[sourceHeader] ?? "" : "";
                    const issuesForCell = rowIssues.filter((issue) => issue.fieldKey === field.key);
                    const isEditing =
                      editingCell?.rowIndex === rowIndex && editingCell?.fieldKey === field.key;

                    return (
                      <td
                        key={field.key}
                        className={issuesForCell.length ? styles.cellWarn : ""}
                        onClick={() => setEditingCell({ rowIndex, fieldKey: field.key })}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            className={styles.editor}
                            defaultValue={String(cellValue)}
                            onBlur={(event) => {
                              setEditingCell(null);
                              updateCell(rowIndex, field.key, event.target.value);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.currentTarget.blur();
                              }
                              if (event.key === "Tab") {
                                event.preventDefault();
                                event.currentTarget.blur();
                                jumpToNextCell(rowIndex, field.key, event.shiftKey);
                              }
                            }}
                          />
                        ) : (
                          <div className={styles.cellBox}>
                            <span className={styles.value}>{String(cellValue)}</span>
                            {issuesForCell.length > 0 && (
                              <div className={styles.errorStack}>
                                {issuesForCell.map((issue, index) => (
                                  <span key={`${issue.msg}-${index}`}>{issue.msg}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className={styles.actionCol}>
                    <button
                      className={styles.deleteButton}
                      onClick={(event) => {
                        event.stopPropagation();
                        startTransition(() => {
                          onDataChange(data.filter((_, index) => index !== rowIndex));
                        });
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
