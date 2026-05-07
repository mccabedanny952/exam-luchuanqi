"use client";

import { startTransition, useCallback, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlarmClockCheck,
  ArrowUpDown,
  CheckCircle2,
  DatabaseZap,
  FileUp,
  NotebookTabs,
  PackageOpen,
  Plus,
  Save,
  SearchCheck,
  ShieldAlert,
  Sparkles,
  Upload,
} from "lucide-react";
import type { MappingState, ParsedRow, ValidationIssue } from "@/utils/excel-tools";
import {
  SYSTEM_FIELDS,
  getMappingConfidence,
  heuristicMapHeaders,
  parseExcelFile,
} from "@/utils/excel-tools";
import EditableGrid from "./EditableGrid";
import ShipmentHistory from "./ShipmentHistory";
import TemplateMappingDialog from "./TemplateMappingDialog";
import styles from "./OperationsWorkbench.module.css";

type ActiveView = "ingest" | "preview" | "history";
type NoticeType = "success" | "error" | "warning";

interface SubmitResult {
  success: number;
  fail: number;
}

interface ToastNotice {
  type: NoticeType;
  message: string;
}

interface PendingParseResult {
  headers: string[];
  data: ParsedRow[];
  fingerprint: string;
}

export default function OperationsWorkbench() {
  const [activeView, setActiveView] = useState<ActiveView>("ingest");
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<MappingState>({});
  const [fingerprint, setFingerprint] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [parseProgress, setParseProgress] = useState({ pct: 0, current: 0, total: 0 });
  const [isValid, setIsValid] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState(0);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [pendingParseResult, setPendingParseResult] = useState<PendingParseResult | null>(null);
  const [toast, setToast] = useState<ToastNotice | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);

  const pushToast = useCallback((type: NoticeType, message: string) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ type, message });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const resetToUpload = () => {
    setActiveView("ingest");
    setRows([]);
    setHeaders([]);
    setMapping({});
    setFingerprint("");
    setIssues([]);
    setIsValid(false);
    setSelectedFile(null);
    setSubmitResult(null);
    setSubmitProgress(0);
    setPendingParseResult(null);
    setMappingOpen(false);
  };

  const handleFileSelection = async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      pushToast("error", "请上传 .xlsx 或 .xls 格式的 Excel 文件");
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      pushToast("warning", "文件体积较大，系统会继续解析，请稍候");
    }

    setSelectedFile(file);
    setIsProcessing(true);
    setParseProgress({ pct: 0, current: 0, total: 0 });
    setSubmitResult(null);

    try {
      const result = await parseExcelFile(file, (pct, current, total) => {
        setParseProgress({ pct, current, total });
      });

      let savedMapping: MappingState | null = null;
      try {
        const response = await fetch(
          `/api/mappings?fingerprint=${encodeURIComponent(result.fingerprint)}`,
        );
        const payload = await response.json();
        if (payload?.mapping) {
          savedMapping = JSON.parse(payload.mapping) as MappingState;
        }
      } catch {
        savedMapping = null;
      }

      const guessedMapping = savedMapping ?? heuristicMapHeaders(result.headers);
      const confidence = getMappingConfidence(guessedMapping);

      setHeaders(result.headers);
      setFingerprint(result.fingerprint);
      setMapping(guessedMapping);

      if (confidence.score < 0.7) {
        setPendingParseResult(result);
        setMappingOpen(true);
        setIsProcessing(false);
        return;
      }

      startTransition(() => {
        setRows(result.data);
        setActiveView("preview");
      });

      setIsProcessing(false);

      if (savedMapping) {
        pushToast(
          "success",
          `已自动套用记忆模板，必填字段匹配 ${confidence.mapped}/${confidence.total}`,
        );
      } else {
        pushToast(
          "success",
          `智能识别完成，必填字段匹配 ${confidence.mapped}/${confidence.total}`,
        );
        try {
          await fetch("/api/mappings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fingerprint: result.fingerprint,
              mapping: JSON.stringify(guessedMapping),
            }),
          });
        } catch {
          // ignore auto-save failures
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      pushToast("error", `解析失败：${message}`);
      setIsProcessing(false);
    }
  };

  const handleSubmitOrders = async () => {
    if (!isValid) {
      pushToast("error", `存在 ${issues.length} 处校验问题，请先修正后再提交`);
      return;
    }

    if (rows.length === 0) {
      pushToast("warning", "当前没有可提交的数据");
      return;
    }

    setIsSubmitting(true);
    setSubmitProgress(0);

    let successCount = 0;
    let failCount = 0;
    const chunkSize = 200;

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const payload = chunk.map((row) => ({
        externalCode: mapping.externalCode
          ? String(row[mapping.externalCode] ?? "").trim() || null
          : null,
        senderName: String(row[mapping.senderName ?? ""] ?? ""),
        senderPhone: String(row[mapping.senderPhone ?? ""] ?? ""),
        senderAddress: String(row[mapping.senderAddress ?? ""] ?? ""),
        receiverName: String(row[mapping.receiverName ?? ""] ?? ""),
        receiverPhone: String(row[mapping.receiverPhone ?? ""] ?? ""),
        receiverAddress: String(row[mapping.receiverAddress ?? ""] ?? ""),
        weight: parseFloat(String(row[mapping.weight ?? ""] ?? "")) || 0,
        count: parseInt(String(row[mapping.count ?? ""] ?? ""), 10) || 0,
        tempZone: String(row[mapping.tempZone ?? ""] ?? ""),
        remark: mapping.remark ? String(row[mapping.remark] ?? "") || null : null,
      }));

      try {
        const response = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          successCount += chunk.length;
        } else {
          failCount += chunk.length;
        }
      } catch {
        failCount += chunk.length;
      }

      setSubmitProgress(Math.round(((i + chunk.length) / rows.length) * 100));
    }

    if (successCount > 0 && fingerprint) {
      try {
        await fetch("/api/mappings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fingerprint,
            mapping: JSON.stringify(mapping),
          }),
        });
      } catch {
        // ignore save failure
      }
    }

    setIsSubmitting(false);
    setSubmitResult({ success: successCount, fail: failCount });

    if (failCount === 0) {
      pushToast("success", `提交成功，共 ${successCount} 条运单已写入数据库`);
    } else {
      pushToast("warning", `提交完成：成功 ${successCount} 条，失败 ${failCount} 条`);
    }
  };

  const handleExport = () => {
    const exportRows = [
      SYSTEM_FIELDS.map((field) => field.label),
      ...rows.map((row) =>
        SYSTEM_FIELDS.map((field) => {
          const sourceHeader = mapping[field.key];
          return sourceHeader ? row[sourceHeader] ?? "" : "";
        }),
      ),
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "订单导出");
    XLSX.writeFile(workbook, `cargo-flow-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
    pushToast("success", "当前预览数据已导出为 Excel");
  };

  const handleMappingConfirm = async (confirmedMapping: MappingState) => {
    setMapping(confirmedMapping);
    setMappingOpen(false);

    if (pendingParseResult) {
      startTransition(() => {
        setRows(pendingParseResult.data);
        setActiveView("preview");
      });
      setPendingParseResult(null);
    }

    try {
      await fetch("/api/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint,
          mapping: JSON.stringify(confirmedMapping),
        }),
      });
      pushToast("success", "映射规则已记忆，下次遇到相同模板会自动应用");
    } catch {
      pushToast("warning", "映射已生效，但模板记忆保存失败");
    }
  };

  const handleAddRow = () => {
    const nextIndex =
      rows.length > 0 ? Math.max(...rows.map((item) => item._originalRowIndex)) + 1 : 1;

    const newRow: ParsedRow = { _originalRowIndex: nextIndex };
    headers.forEach((header) => {
      newRow[header] = "";
    });

    startTransition(() => {
      setRows((current) => [...current, newRow]);
    });
  };

  const mappedRequired = getMappingConfidence(mapping);
  const statCards = [
    {
      label: "当前数据量",
      value: `${rows.length}`,
      tone: "accent",
      icon: PackageOpen,
    },
    {
      label: "映射完成度",
      value: `${mappedRequired.mapped}/${mappedRequired.total}`,
      tone: "teal",
      icon: ArrowUpDown,
    },
    {
      label: "待修正问题",
      value: `${issues.length}`,
      tone: issues.length > 0 ? "danger" : "gold",
      icon: ShieldAlert,
    },
  ] as const;

  return (
    <div className={`${styles.shell} page-enter`}>
      {toast && (
        <div className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}>
          {toast.type === "success" && <CheckCircle2 size={18} />}
          {toast.type === "error" && <ShieldAlert size={18} />}
          {toast.type === "warning" && <AlarmClockCheck size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      <TemplateMappingDialog
        key={`${fingerprint}-${mappingOpen ? "open" : "closed"}`}
        isOpen={mappingOpen}
        headers={headers}
        initialMapping={mapping}
        onCancel={() => {
          setMappingOpen(false);
          setPendingParseResult(null);
          setIsProcessing(false);
          setActiveView("ingest");
        }}
        onConfirm={handleMappingConfirm}
      />

      <aside className={styles.sidebar}>
        <div className={styles.brandPanel}>
          <div className={styles.brandMark}>
            <Sparkles size={22} />
          </div>
          <div>
            <p className={styles.eyebrow}>Cargo Flow Console</p>
            <h1>多模板运单导入中枢</h1>
            <p className={styles.lead}>
              保留参考项目的业务规则，但以完全不同的排版和视觉系统组织导入、校验与历史查看。
            </p>
          </div>
        </div>

        <div className={styles.navBlock}>
          <button
            className={`${styles.navButton} ${activeView === "ingest" ? styles.navButton_active : ""}`}
            onClick={() => setActiveView(rows.length > 0 ? "preview" : "ingest")}
          >
            <FileUp size={18} />
            <span>导入工位</span>
          </button>
          <button
            className={`${styles.navButton} ${activeView === "history" ? styles.navButton_active : ""}`}
            onClick={() => setActiveView("history")}
          >
            <NotebookTabs size={18} />
            <span>历史运单</span>
          </button>
        </div>

        <div className={styles.statStack}>
          {statCards.map((card) => (
            <div key={card.label} className={`${styles.statCard} ${styles[`tone_${card.tone}`]}`}>
              <div className={styles.statIcon}>
                <card.icon size={18} />
              </div>
              <div>
                <p>{card.label}</p>
                <strong>{card.value}</strong>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.storyCard}>
          <div className={styles.storyHead}>
            <DatabaseZap size={18} />
            <span>关键要求已锁定</span>
          </div>
          <ul>
            <li>自动识别多模板 Excel</li>
            <li>手动映射后自动记忆模板</li>
            <li>全量错误一次性展示</li>
            <li>提交成功后持久化到 Neon</li>
          </ul>
        </div>
      </aside>

      <main className={styles.stage}>
        <section className={styles.heroPanel}>
          <div>
            <p className={styles.eyebrow}>Exam Workflow</p>
            <h2>上传、校验、入库一条链完成</h2>
            <p className={styles.heroText}>
              支持拖拽上传、模板学习、类 Excel 在线修正、导出回传，以及历史运单分页筛选。
            </p>
          </div>
          <div className={styles.heroMeta}>
            <span>数据库：Neon PostgreSQL</span>
            <span>引擎：Next.js App Router + Prisma</span>
          </div>
        </section>

        {activeView !== "history" && (
          <section className={styles.workspace}>
            <div className={styles.uploadPanel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelTag}>Step 01</p>
                  <h3>模板导入工位</h3>
                </div>
                {selectedFile && <span className={styles.fileChip}>{selectedFile.name}</span>}
              </div>

              <div
                className={`${styles.dropZone} ${isDragging ? styles.dropZone_active : ""} ${isProcessing ? styles.dropZone_busy : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  if (event.dataTransfer.files?.[0]) {
                    void handleFileSelection(event.dataTransfer.files[0]);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className={styles.hiddenInput}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleFileSelection(file);
                    }
                  }}
                />

                {isProcessing ? (
                  <div className={styles.progressBox}>
                    <div className={styles.loaderOrbit} />
                    <strong>正在解析 Excel 并识别模板结构</strong>
                    <p>
                      {parseProgress.pct}% · {parseProgress.current}/{parseProgress.total} 条
                    </p>
                    <div className={styles.progressTrack}>
                      <div
                        className={styles.progressFill}
                        style={{ width: `${parseProgress.pct}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className={styles.dropCopy}>
                    <div className={styles.dropBadge}>
                      <Upload size={24} />
                    </div>
                    <strong>拖拽 Excel 文件到这里，或点击选择文件</strong>
                    <p>支持 .xlsx / .xls，多种列名、多种列序、说明页和多 Sheet 模板。</p>
                  </div>
                )}
              </div>

              <div className={styles.quickNotes}>
                <div>
                  <span>模板记忆</span>
                  <p>手动校正一次映射后，下次同结构模板自动套用。</p>
                </div>
                <div>
                  <span>异常提示</span>
                  <p>空文件、找不到表头、Sheet 无效等异常会明确提示。</p>
                </div>
              </div>
            </div>

            <div className={styles.commandPanel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelTag}>Step 02</p>
                  <h3>当前动作面板</h3>
                </div>
                <span className={styles.fileChip}>
                  {activeView === "preview" ? "预览校验中" : "等待导入"}
                </span>
              </div>

              <div className={styles.commandGrid}>
                <button className={styles.commandButton} onClick={handleAddRow} disabled={rows.length === 0}>
                  <Plus size={17} />
                  <span>新增空行</span>
                </button>
                <button
                  className={styles.commandButton}
                  onClick={handleExport}
                  disabled={rows.length === 0}
                >
                  <SearchCheck size={17} />
                  <span>导出当前数据</span>
                </button>
                <button className={styles.commandButton} onClick={resetToUpload}>
                  <Upload size={17} />
                  <span>重新上传</span>
                </button>
                <button
                  className={`${styles.commandButton} ${styles.commandButton_primary}`}
                  onClick={() => void handleSubmitOrders()}
                  disabled={isSubmitting || rows.length === 0}
                >
                  <Save size={17} />
                  <span>{isSubmitting ? "提交中..." : "提交下单"}</span>
                </button>
              </div>

              {isSubmitting && (
                <div className={styles.submitCard}>
                  <div className={styles.submitMeta}>
                    <strong>批量入库进度</strong>
                    <span>{submitProgress}%</span>
                  </div>
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${submitProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {submitResult && (
                <div className={styles.summaryStrip}>
                  提交结果：成功 <strong>{submitResult.success}</strong> 条，失败{" "}
                  <strong>{submitResult.fail}</strong> 条
                </div>
              )}
            </div>
          </section>
        )}

        {activeView === "preview" && (
          <section className={styles.previewPanel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.panelTag}>Step 03</p>
                <h3>预览与在线修正</h3>
                <p className={styles.helperText}>
                  共 {rows.length} 条数据，单元格点击即可编辑，支持 Tab/回车切换。
                </p>
              </div>
              <div className={styles.healthLine}>
                {isValid && rows.length > 0 ? (
                  <span className={styles.stateOk}>
                    <CheckCircle2 size={16} />
                    校验通过
                  </span>
                ) : (
                  <span className={styles.stateWarn}>
                    <ShieldAlert size={16} />
                    待修正 {issues.length} 项
                  </span>
                )}
              </div>
            </div>

            {issues.length > 0 && (
              <div className={styles.issueBoard}>
                <div className={styles.issueBoardHeader}>
                  <ShieldAlert size={16} />
                  <strong>全部错误列表（共 {issues.length} 处）</strong>
                </div>
                <div className={styles.issueList}>
                  {issues.slice(0, 50).map((issue, index) => {
                    const field = SYSTEM_FIELDS.find((item) => item.key === issue.fieldKey);
                    const sourceRow = rows[issue.rowIndex]?._originalRowIndex ?? issue.rowIndex + 1;
                    return (
                      <p key={`${issue.rowIndex}-${issue.fieldKey}-${index}`}>
                        第 {sourceRow} 行，{field?.label ?? issue.fieldKey}：{issue.msg}
                      </p>
                    );
                  })}
                  {issues.length > 50 && <p>... 还有 {issues.length - 50} 处错误未展开</p>}
                </div>
              </div>
            )}

            <EditableGrid
              data={rows}
              mapping={mapping}
              onDataChange={setRows}
              onValidationComplete={(valid, nextIssues) => {
                setIsValid(valid);
                setIssues(nextIssues);
              }}
            />
          </section>
        )}

        {activeView === "history" && (
          <section className={styles.previewPanel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.panelTag}>Archive</p>
                <h3>历史运单记录</h3>
                <p className={styles.helperText}>
                  支持按外部编码、收件人姓名和提交日期区间筛选，并分页查看数据库中的运单。
                </p>
              </div>
            </div>
            <ShipmentHistory />
          </section>
        )}
      </main>
    </div>
  );
}
