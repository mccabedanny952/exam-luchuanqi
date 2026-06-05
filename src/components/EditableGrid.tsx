"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MappingState, ParsedRow, ValidationIssue } from "@/utils/excel-tools";
import { SYSTEM_FIELDS, getMappedValue } from "@/utils/excel-tools";
import styles from "./EditableGrid.module.css";

interface EditableGridProps {
  data: ParsedRow[];
  mapping: MappingState;
  onDataChange: (rows: ParsedRow[]) => void;
  onValidationComplete: (isValid: boolean, issues: ValidationIssue[]) => void;
}

const ROW_HEIGHT = 58;
const OVERSCAN = 12;

export default function EditableGrid({
  data,
  mapping,
  onDataChange,
  onValidationComplete,
}: EditableGridProps) {
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; fieldKey: string } | null>(null);
  const [dbDuplicates, setDbDuplicates] = useState<Set<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const lastCodesKeyRef = useRef("");
  const deferredData = useDeferredValue(data);

  useEffect(() => {
    const codes = deferredData
      .map((row) => getMappedValue(row, mapping, "externalCode"))
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

    fetch("/api/orders/check-duplicates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: [...new Set(codes)] }),
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
    const externalCodeMap = new Map<string, number[]>();

    deferredData.forEach((row, rowIndex) => {
      const code = getMappedValue(row, mapping, "externalCode");
      if (!code) {
        return;
      }
      const group = externalCodeMap.get(code) ?? [];
      group.push(rowIndex);
      externalCodeMap.set(code, group);
    });

    deferredData.forEach((row, rowIndex) => {
      const storeName = getMappedValue(row, mapping, "storeName");
      const receiverName = getMappedValue(row, mapping, "receiverName");
      const receiverPhone = getMappedValue(row, mapping, "receiverPhone");
      const receiverAddress = getMappedValue(row, mapping, "receiverAddress");
      const hasStoreGroup = storeName !== "";
      const hasReceiverGroup = receiverName !== "" && receiverPhone !== "" && receiverAddress !== "";

      if (!hasStoreGroup && !hasReceiverGroup) {
        nextIssues.push({
          rowIndex,
          fieldKey: "storeName",
          msg: "收货门店或收件人姓名+电话+地址需二选一",
        });
      }

      for (const field of SYSTEM_FIELDS) {
        const textValue = getMappedValue(row, mapping, field.key);

        if (field.required && textValue === "") {
          nextIssues.push({ rowIndex, fieldKey: field.key, msg: "必填字段缺失" });
          continue;
        }

        if (textValue === "") {
          continue;
        }

        if (field.key === "receiverPhone") {
          const digits = textValue.replace(/\D/g, "");
          if (digits.length < 7 || digits.length > 15) {
            nextIssues.push({ rowIndex, fieldKey: field.key, msg: "电话格式错误" });
          }
        }

        if (field.key === "skuQuantity") {
          const quantity = Number(textValue);
          if (Number.isNaN(quantity) || quantity <= 0) {
            nextIssues.push({ rowIndex, fieldKey: field.key, msg: "必须为正数" });
          }
        }

        if (field.key === "externalCode") {
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

          if (dbDuplicates.has(textValue)) {
            nextIssues.push({
              rowIndex,
              fieldKey: field.key,
              msg: "与数据库中已有数据重复",
            });
          }
        }
      }
    });

    return nextIssues;
  }, [dbDuplicates, deferredData, mapping]);

  useEffect(() => {
    onValidationComplete(validationIssues.length === 0, validationIssues);
  }, [onValidationComplete, validationIssues]);

  const virtualState = useMemo(() => {
    if (data.length <= 220) {
      return {
        startIndex: 0,
        endIndex: data.length,
        topHeight: 0,
        bottomHeight: 0,
      };
    }

    const visibleCount = 42;
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const endIndex = Math.min(data.length, startIndex + visibleCount + OVERSCAN * 2);
    return {
      startIndex,
      endIndex,
      topHeight: startIndex * ROW_HEIGHT,
      bottomHeight: Math.max(0, (data.length - endIndex) * ROW_HEIGHT),
    };
  }, [data.length, scrollTop]);

  const issuesByRow = useMemo(() => {
    const map = new Map<number, ValidationIssue[]>();
    validationIssues.forEach((issue) => {
      const bucket = map.get(issue.rowIndex) ?? [];
      bucket.push(issue);
      map.set(issue.rowIndex, bucket);
    });
    return map;
  }, [validationIssues]);

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

  const visibleRows = data.slice(virtualState.startIndex, virtualState.endIndex);

  return (
    <div className={styles.frame}>
      <div
        className={styles.tableWrap}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
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
            {virtualState.topHeight > 0 && (
              <tr aria-hidden="true">
                <td colSpan={SYSTEM_FIELDS.length + 2} style={{ height: virtualState.topHeight, padding: 0 }} />
              </tr>
            )}

            {visibleRows.map((row, offsetIndex) => {
              const rowIndex = virtualState.startIndex + offsetIndex;
              const rowIssues = issuesByRow.get(rowIndex) ?? [];
              return (
                <tr
                  key={`${row._originalRowIndex}-${rowIndex}`}
                  className={rowIssues.length ? styles.rowWarn : ""}
                >
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

            {virtualState.bottomHeight > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={SYSTEM_FIELDS.length + 2}
                  style={{ height: virtualState.bottomHeight, padding: 0 }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
