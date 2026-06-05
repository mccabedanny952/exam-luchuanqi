"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Database,
  Download,
  FileJson,
  FileText,
  FileUp,
  Home,
  ListChecks,
  Loader2,
  Menu,
  PackageCheck,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import type {
  FileStructureSummary,
  ParsedRow,
  ParsingRule,
  ValidationIssue,
} from "@/utils/excel-tools";
import {
  SYSTEM_FIELDS,
  createDefaultRule,
  createSummaryFingerprint,
  createSystemMapping,
  getMappingConfidence,
  inferHeadersFromSummary,
  normalizeRule,
  parseExcelFile,
  summarizeExcelFile,
  toSystemRow,
} from "@/utils/excel-tools";
import EditableGrid from "./EditableGrid";
import RuleManagementPanel from "./RuleManagementPanel";
import ShipmentHistory from "./ShipmentHistory";
import TemplateMappingDialog from "./TemplateMappingDialog";
import styles from "./OperationsWorkbench.module.css";

type ActiveView = "home" | "ingest" | "preview" | "rules" | "history";
type RuleDialogPurpose = "parse" | "manage";
type NoticeType = "success" | "error" | "warning";
type FileKind = "spreadsheet" | "word" | "pdf";

interface SubmitResult {
  success: number;
  fail: number;
}

interface ToastNotice {
  type: NoticeType;
  message: string;
}

interface SavedRuleRecord {
  id: string;
  fingerprint: string;
  name: string;
  fileType: string;
  mode: string;
  rule: string;
  updatedAt: string;
}

interface TextExtractState {
  text: string;
  summary: FileStructureSummary;
}

interface ManagedRuleDraft {
  fingerprint: string;
  fileType: string;
  rule: ParsingRule;
  headers: string[];
}

function getFileKind(file: File): FileKind | null {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    return "spreadsheet";
  }
  if (/\.docx$/i.test(file.name)) {
    return "word";
  }
  if (/\.pdf$/i.test(file.name)) {
    return "pdf";
  }
  return null;
}

function safeParseRule(record: SavedRuleRecord): ParsingRule | null {
  try {
    return normalizeRule(JSON.parse(record.rule), [], record.name);
  } catch {
    return null;
  }
}

export default function OperationsWorkbench() {
  const [activeView, setActiveView] = useState<ActiveView>("ingest");
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileKind, setFileKind] = useState<FileKind | null>(null);
  const [fileSummary, setFileSummary] = useState<FileStructureSummary | null>(null);
  const [textExtract, setTextExtract] = useState<TextExtractState | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fingerprint, setFingerprint] = useState("");
  const [currentRule, setCurrentRule] = useState<ParsingRule | null>(null);
  const [isRuleReady, setIsRuleReady] = useState(false);
  const [savedRules, setSavedRules] = useState<SavedRuleRecord[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isGeneratingRule, setIsGeneratingRule] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState({ pct: 0, current: 0, total: 0 });
  const [isValid, setIsValid] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState(0);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [ruleDialogPurpose, setRuleDialogPurpose] = useState<RuleDialogPurpose>("parse");
  const [managedRuleDraft, setManagedRuleDraft] = useState<ManagedRuleDraft | null>(null);
  const [rulesStorageWarning, setRulesStorageWarning] = useState("");
  const [toast, setToast] = useState<ToastNotice | null>(null);
  const [llmWarnings, setLlmWarnings] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);

  const mapping = currentRule?.mapping ?? {};
  const coverage = getMappingConfidence(mapping);

  const pushToast = useCallback((type: NoticeType, message: string) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ type, message });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const loadRules = useCallback(async () => {
    try {
      const response = await fetch("/api/mappings");
      const payload = await response.json();
      setSavedRules(payload.data || []);
      setRulesStorageWarning(payload.warning || "");
    } catch {
      setSavedRules([]);
      setRulesStorageWarning("规则库读取失败，请检查数据库连接");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRules();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadRules]);

  const resetToUpload = () => {
    setActiveView("ingest");
    setRows([]);
    setHeaders([]);
    setFingerprint("");
    setFileSummary(null);
    setTextExtract(null);
    setCurrentRule(null);
    setIsRuleReady(false);
    setIssues([]);
    setIsValid(false);
    setSelectedFile(null);
    setFileKind(null);
    setSubmitResult(null);
    setSubmitProgress(0);
    setParseProgress({ pct: 0, current: 0, total: 0 });
    setRuleDialogOpen(false);
    setManagedRuleDraft(null);
    setLlmWarnings([]);
  };

  const readTextFile = async (file: File): Promise<TextExtractState> => {
    const formData = new FormData();
    formData.set("file", file);
    const response = await fetch("/api/files/extract", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "文件抽取失败");
    }
    return { text: payload.text, summary: payload.summary };
  };

  const handleFileSelection = async (file: File) => {
    const kind = getFileKind(file);
    if (!kind) {
      pushToast("error", "仅支持 .xlsx/.xls、.docx、.pdf 文件接入");
      return;
    }

    setSelectedFile(file);
    setFileKind(kind);
    setRows([]);
    setIssues([]);
    setIsValid(false);
    setSubmitResult(null);
    setCurrentRule(null);
    setIsRuleReady(false);
    setIsReadingFile(true);
    setParseProgress({ pct: 0, current: 0, total: 0 });
    setLlmWarnings([]);

    try {
      let summary: FileStructureSummary;
      let nextHeaders: string[];
      let extract: TextExtractState | null = null;

      if (kind === "spreadsheet") {
        summary = await summarizeExcelFile(file);
        nextHeaders = inferHeadersFromSummary(summary);
      } else {
        extract = await readTextFile(file);
        summary = extract.summary;
        nextHeaders = SYSTEM_FIELDS.map((field) => field.label);
        setTextExtract(extract);
      }

      const nextFingerprint = createSummaryFingerprint(summary, nextHeaders);
      const defaultRule = normalizeRule(
        {
          ...createDefaultRule(nextHeaders, file.name),
          mode: kind === "spreadsheet" ? "column" : "text",
          sheetMode: kind === "spreadsheet" ? "all" : "first",
          aiNotes:
            kind === "spreadsheet"
              ? ["系统已按表头关键字起草字段映射，请核对收货信息和 SKU 字段是否准确。"]
              : ["文本类文件会交由 LLM 按已确认规则生成明细，请核对记录分隔、收货信息和 SKU 行格式。"],
        },
        nextHeaders,
        file.name,
      );
      setFileSummary(summary);
      setHeaders(nextHeaders);
      setFingerprint(nextFingerprint);
      setCurrentRule(defaultRule);
      setIsRuleReady(false);
      setIsReadingFile(false);

      const matchedRecord = savedRules.find((record) => record.fingerprint === nextFingerprint);
      if (matchedRecord) {
        pushToast("success", `规则库中有相同结构：${matchedRecord.name}，请手动点击选择后生成明细`);
        return;
      }

      pushToast("warning", "结构识别完成，请在规则栏确认映射或让 AI 起草一版");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      pushToast("error", `读取失败：${message}`);
      setIsReadingFile(false);
    }
  };

  const saveRule = async (rule: ParsingRule): Promise<string | null> => {
    if (!fingerprint || !fileSummary) {
      return null;
    }

    const response = await fetch("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fingerprint,
        name: rule.name,
        fileType: fileSummary.fileType,
        mode: rule.mode,
        rule,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    await loadRules();
    if (payload.warning) {
      return String(payload.warning);
    }
    if (!response.ok) {
      return payload.error ? String(payload.error) : "规则保存失败";
    }
    return null;
  };

  const saveManagedRule = async (draft: ManagedRuleDraft, rule: ParsingRule): Promise<string | null> => {
    const response = await fetch("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fingerprint: draft.fingerprint,
        name: rule.name,
        fileType: draft.fileType,
        mode: rule.mode,
        rule,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    await loadRules();
    if (payload.warning) {
      return String(payload.warning);
    }
    if (!response.ok) {
      return payload.error ? String(payload.error) : "规则保存失败";
    }
    return null;
  };

  const openParseRuleDialog = () => {
    if (!currentRule) {
      return;
    }
    setRuleDialogPurpose("parse");
    setManagedRuleDraft(null);
    setRuleDialogOpen(true);
  };

  const openManagedRuleDialog = (draft: ManagedRuleDraft) => {
    setRuleDialogPurpose("manage");
    setManagedRuleDraft(draft);
    setRuleDialogOpen(true);
  };

  const createManualFingerprint = (prefix: string) => {
    const randomId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}:${randomId}`;
  };

  const openCreateRule = () => {
    const defaultHeaders = SYSTEM_FIELDS.map((field) => field.label);
    openManagedRuleDialog({
      fingerprint: createManualFingerprint("manual-rule"),
      fileType: "manual",
      headers: defaultHeaders,
      rule: normalizeRule(
        {
          ...createDefaultRule(defaultHeaders, "人工规则草稿"),
          mapping: createSystemMapping(),
          aiNotes: ["人工维护规则，请根据实际文件结构调整映射、尾部提取器、默认值和处理模式。"],
        },
        defaultHeaders,
        "人工规则草稿",
      ),
    });
  };

  const openEditRule = (record: SavedRuleRecord, rule: ParsingRule) => {
    openManagedRuleDialog({
      fingerprint: record.fingerprint,
      fileType: record.fileType,
      headers: Array.from(
        new Set([
          ...SYSTEM_FIELDS.map((field) => field.label),
          ...Object.values(rule.mapping).filter((value): value is string => Boolean(value)),
        ]),
      ),
      rule,
    });
  };

  const openCopyRule = (record: SavedRuleRecord, rule: ParsingRule) => {
    openManagedRuleDialog({
      fingerprint: createManualFingerprint(`copy-${record.fingerprint.slice(0, 32)}`),
      fileType: record.fileType,
      headers: Array.from(
        new Set([
          ...SYSTEM_FIELDS.map((field) => field.label),
          ...Object.values(rule.mapping).filter((value): value is string => Boolean(value)),
        ]),
      ),
      rule: {
        ...rule,
        name: `${rule.name || record.name} 副本`,
        aiNotes: [...(rule.aiNotes ?? []), "由规则库复制生成，请确认后保存。"],
      },
    });
  };

  const deleteRule = async (record: SavedRuleRecord) => {
    const response = await fetch(`/api/mappings?id=${encodeURIComponent(record.id)}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      pushToast("error", payload.error || "删除规则失败");
      return;
    }
    await loadRules();
    pushToast("success", `已删除规则：${record.name}`);
  };

  const generateRuleByAi = async () => {
    if (!fileSummary) {
      pushToast("warning", "请先接入文件");
      return;
    }

    setIsGeneratingRule(true);
    try {
      const response = await fetch("/api/rules/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: fileSummary }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "AI 生成失败");
      }

      const aiRule = normalizeRule(payload.rule, headers, selectedFile?.name || "新建规则");
      setCurrentRule(aiRule);
      setIsRuleReady(false);
      setRuleDialogPurpose("parse");
      setManagedRuleDraft(null);
      setRuleDialogOpen(true);
      pushToast("success", "AI 已起草字段映射，请核对关键字段");
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 生成规则失败";
      pushToast("error", message);
    } finally {
      setIsGeneratingRule(false);
    }
  };

  const executeCurrentRule = async (rule = currentRule, allowDraft = false) => {
    if (!selectedFile || !rule) {
      pushToast("warning", "请先接入文件并确认规则");
      return;
    }

    if (!allowDraft && !isRuleReady) {
      pushToast("warning", "请先手动选择规则，或进入校准弹窗确认当前草稿");
      return;
    }

    setIsParsing(true);
    setParseProgress({ pct: 0, current: 0, total: 0 });
    setSubmitResult(null);
    setLlmWarnings([]);

    try {
      if (fileKind === "spreadsheet") {
        const result = await parseExcelFile(selectedFile, rule, (pct, current, total) => {
          setParseProgress({ pct, current, total });
        });

        const normalizedRule = normalizeRule(
          { ...rule, mapping: rule.mapping && Object.keys(rule.mapping).length ? rule.mapping : createSystemMapping() },
          result.headers,
          selectedFile.name,
        );
        setHeaders(result.headers);
        setCurrentRule(normalizedRule);
        setIsRuleReady(true);
        startTransition(() => {
          setRows(result.data);
          setActiveView("preview");
        });
      } else {
        if (!textExtract) {
          throw new Error("文本内容尚未抽取，请重新接入文件");
        }

        setParseProgress({ pct: 10, current: 0, total: 1 });
        const response = await fetch("/api/rules/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: selectedFile.name,
            text: textExtract.text,
            rule,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "明细生成失败");
        }
        setParseProgress({ pct: 100, current: payload.rows?.length ?? 0, total: payload.rows?.length ?? 0 });
        setLlmWarnings(payload.warnings || []);
        startTransition(() => {
          setRows(payload.rows || []);
          setActiveView("preview");
        });
      }

      const saveWarning = await saveRule(rule);
      pushToast(
        saveWarning ? "warning" : "success",
        saveWarning ? `明细生成完成，但${saveWarning}` : "明细生成完成，规则已留存，可继续核对表格",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      pushToast("error", `生成失败：${message}`);
    } finally {
      setIsParsing(false);
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
      const payload = chunk.map((row) => {
        const systemRow = toSystemRow(row, mapping);
        return {
          externalCode: systemRow.externalCode || null,
          storeName: systemRow.storeName || null,
          receiverName: systemRow.receiverName || null,
          receiverPhone: systemRow.receiverPhone || null,
          receiverAddress: systemRow.receiverAddress || null,
          skuCode: systemRow.skuCode,
          skuName: systemRow.skuName,
          skuQuantity: Number(systemRow.skuQuantity) || 0,
          skuSpec: systemRow.skuSpec || null,
          remark: systemRow.remark || null,
        };
      });

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

    setIsSubmitting(false);
    setSubmitResult({ success: successCount, fail: failCount });

    if (failCount === 0) {
      pushToast("success", `提交成功，共 ${successCount} 条明细已写入数据库`);
    } else {
      pushToast("warning", `提交完成：成功 ${successCount} 条，失败 ${failCount} 条`);
    }
  };

  const handleExport = () => {
    const exportRows = [
      SYSTEM_FIELDS.map((field) => field.label),
      ...rows.map((row) => {
        const systemRow = toSystemRow(row, mapping);
        return SYSTEM_FIELDS.map((field) => systemRow[field.key] ?? "");
      }),
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "核对明细");
    XLSX.writeFile(workbook, `transfer-details-${new Date().toISOString().slice(0, 10)}.xlsx`);
    pushToast("success", "核对明细已导出为 Excel");
  };

  const handleAddRow = () => {
    const nextIndex =
      rows.length > 0 ? Math.max(...rows.map((item) => item._originalRowIndex)) + 1 : 1;
    const nextMapping = Object.keys(mapping).length ? mapping : createSystemMapping();
    const newRow: ParsedRow = { _originalRowIndex: nextIndex };

    SYSTEM_FIELDS.forEach((field) => {
      const header = nextMapping[field.key] || field.label;
      newRow[header] = "";
    });

    startTransition(() => {
      setRows((current) => [...current, newRow]);
    });
  };

  const savedRuleOptions = useMemo(
    () =>
      savedRules
        .map((record) => ({ record, rule: safeParseRule(record) }))
        .filter((item): item is { record: SavedRuleRecord; rule: ParsingRule } => Boolean(item.rule)),
    [savedRules],
  );

  const statCards = [
    { label: "明细行", value: rows.length || "-", icon: PackageCheck },
    { label: "映射字段", value: `${coverage.mapped}/${coverage.total}`, icon: FileJson },
    { label: "待修正", value: issues.length, icon: AlertCircle },
  ];

  const currentTabTitle =
    activeView === "home"
      ? "概览"
      : activeView === "rules"
        ? "规则校准"
        : activeView === "history"
          ? "入库记录"
          : "文件接入";
  const currentBreadcrumb =
    activeView === "home"
      ? "业务概览"
      : activeView === "rules"
        ? "规则校准"
        : activeView === "history"
          ? "入库记录"
          : "转运文件接入";
  const dialogRule =
    ruleDialogPurpose === "manage" && managedRuleDraft
      ? managedRuleDraft.rule
      : currentRule ?? createDefaultRule(headers, selectedFile?.name || "新建规则");
  const dialogHeaders =
    ruleDialogPurpose === "manage" && managedRuleDraft ? managedRuleDraft.headers : headers;

  return (
    <div className={`${styles.shell} page-enter`}>
      {toast && (
        <div className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}>
          {toast.type === "success" && <CheckCircle2 size={16} />}
          {toast.type === "error" && <AlertCircle size={16} />}
          {toast.type === "warning" && <AlertCircle size={16} />}
          <span>{toast.message}</span>
        </div>
      )}

      <TemplateMappingDialog
        key={`${ruleDialogPurpose}-${managedRuleDraft?.fingerprint ?? fingerprint}-${dialogRule.name}-${ruleDialogOpen ? "open" : "closed"}`}
        isOpen={ruleDialogOpen}
        headers={dialogHeaders}
        initialRule={dialogRule}
        confirmLabel={ruleDialogPurpose === "manage" ? "写入规则库" : "确认并生成明细"}
        onCancel={() => {
          setRuleDialogOpen(false);
          setManagedRuleDraft(null);
        }}
        onConfirm={(rule) => {
          if (ruleDialogPurpose === "manage" && managedRuleDraft) {
            void saveManagedRule(managedRuleDraft, rule).then((warning) => {
              setRuleDialogOpen(false);
              setManagedRuleDraft(null);
              pushToast(
                warning ? "warning" : "success",
                warning ? `规则已确认，但${warning}` : `规则已写入：${rule.name}`,
              );
            });
            return;
          }

          setCurrentRule(rule);
          setIsRuleReady(true);
          setRuleDialogOpen(false);
          void executeCurrentRule(rule, true);
        }}
      />

      <aside className={styles.sidebar}>
        <div className={styles.siteSelect}>
          <Menu size={16} />
          <span>转运业务台</span>
        </div>
        <button
          className={`${styles.navItem} ${activeView === "home" ? styles.navItem_active : ""}`}
          onClick={() => setActiveView("home")}
        >
          <Home size={16} />
          工作总览
        </button>
        <button
          className={`${styles.navItem} ${activeView === "ingest" || activeView === "preview" ? styles.navItem_active : ""}`}
          onClick={() => setActiveView(rows.length > 0 ? "preview" : "ingest")}
        >
          <UploadCloud size={16} />
          文件接入
        </button>
        <button
          className={`${styles.navItem} ${activeView === "rules" ? styles.navItem_active : ""}`}
          onClick={() => {
            void loadRules();
            setActiveView("rules");
          }}
        >
          <ListChecks size={16} />
          规则校准
        </button>
        <button
          className={`${styles.navItem} ${activeView === "history" ? styles.navItem_active : ""}`}
          onClick={() => setActiveView("history")}
        >
          <Database size={16} />
          入库记录
        </button>
      </aside>

      <main className={styles.main}>
        <div className={styles.tabbar}>
          <button title="返回">
            <ChevronLeft size={16} />
          </button>
          <span className={styles.tabActive}>{currentTabTitle}</span>
        </div>

        <div className={styles.breadcrumb}>
          <span>鲸天系统</span>
          <span>/</span>
          <strong>{currentBreadcrumb}</strong>
        </div>

        {activeView === "home" && (
          <section className={styles.homePanel}>
            <div className={styles.homeHero}>
              <p>Whale Transfer Desk</p>
              <h1>转运文件处理台</h1>
              <span>围绕文件接入、规则校准、明细核对和入库记录组织页面，左侧菜单可直接切换各业务区。</span>
            </div>
            <div className={styles.homeGrid}>
              <button onClick={() => setActiveView("ingest")}>
                <UploadCloud size={22} />
                <strong>文件接入</strong>
                <span>接入考试附件文件，识别结构并生成待核对明细。</span>
              </button>
              <button onClick={() => setActiveView("rules")}>
                <ListChecks size={22} />
                <strong>规则校准</strong>
                <span>维护字段映射、处理模式、默认值和补充提取参数。</span>
              </button>
              <button onClick={() => setActiveView("history")}>
                <Database size={22} />
                <strong>入库记录</strong>
                <span>查看已提交的转运明细，并按单号、门店和时间查询。</span>
              </button>
            </div>
          </section>
        )}

        {(activeView === "ingest" || activeView === "preview") && (
          <>
            <section className={styles.heroPanel}>
              <div className={styles.heroTitleBlock}>
                <p>Waybill Console / File Intake</p>
                <h1>转运文件接入台</h1>
                <span>
                  先识别附件结构，再校准字段映射，最后生成可检查的转运明细。
                </span>
              </div>
              <div className={styles.heroCards}>
                <div>
                  <strong>{selectedFile ? "已接入" : "待接入"}</strong>
                  <span>文件状态</span>
                </div>
                <div>
                  <strong>{isRuleReady ? "已确认" : currentRule ? "待确认" : "未校准"}</strong>
                  <span>字段映射</span>
                </div>
                <div>
                  <strong>{rows.length || "-"}</strong>
                  <span>明细行数</span>
                </div>
              </div>
            </section>

            <section className={styles.workspace}>
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.stepBadge}>A</div>
                  <div>
                    <h2>接入附件文件</h2>
                    <p>支持表格、Word 和 PDF；接入后先抽取结构摘要，再进入规则校准。</p>
                  </div>
                </div>

                <div
                  className={`${styles.dropZone} ${isDragging ? styles.dropZone_active : ""}`}
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
                    accept=".xlsx,.xls,.docx,.pdf"
                    className={styles.hiddenInput}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void handleFileSelection(file);
                      }
                    }}
                  />
                  {isReadingFile ? (
                    <div className={styles.dropCopy}>
                      <Loader2 className={styles.spin} size={42} />
                      <strong>正在识别附件结构</strong>
                      <span>提取 Sheet、样例行、文本片段和结构指纹...</span>
                    </div>
                  ) : (
                    <div className={styles.dropCopy}>
                      <UploadCloud size={46} />
                      <strong>拖入文件或点击选择</strong>
                      <span>支持 .xlsx/.xls、.docx、.pdf；字段不准时可进入规则栏校正。</span>
                    </div>
                  )}
                </div>

                {selectedFile && (
                  <div className={styles.fileInfo}>
                    <FileText size={16} />
                    <strong>{selectedFile.name}</strong>
                    <span>{fileSummary?.fileType ?? fileKind}</span>
                    <span>{fileSummary?.sheets.length ?? 0} 个结构块</span>
                  </div>
                )}
              </div>

              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.stepBadge}>B</div>
                  <div>
                    <h2>规则栏</h2>
                    <p>可从规则库点选，也可让 AI 先起草字段映射，最终以人工确认为准。</p>
                  </div>
                </div>

                <div className={styles.ruleToolbar}>
                  <button
                    className={styles.primaryGhost}
                    onClick={generateRuleByAi}
                    disabled={!fileSummary || isGeneratingRule}
                  >
                    {isGeneratingRule ? <Loader2 className={styles.spin} size={16} /> : <Sparkles size={16} />}
                    AI 起草映射
                  </button>
                  <button
                    className={styles.plainButton}
                    onClick={openParseRuleDialog}
                    disabled={!currentRule}
                  >
                    <FileJson size={16} />
                    校准当前规则
                  </button>
                  <button className={styles.plainButton} onClick={() => void loadRules()}>
                    <RefreshCw size={16} />
                    刷新
                  </button>
                </div>

                <div className={styles.ruleList}>
                  {savedRuleOptions.length === 0 ? (
                    <div className={styles.emptyRule}>规则库暂时为空，接入文件后可让 AI 起草一版。</div>
                  ) : (
                    savedRuleOptions.map(({ record, rule }) => (
                      <div
                        key={record.id}
                        role="button"
                        tabIndex={0}
                        className={`${styles.ruleItem} ${record.fingerprint === fingerprint ? styles.ruleItem_current : ""}`}
                        onClick={() => {
                          setCurrentRule(rule);
                          setIsRuleReady(true);
                          pushToast("success", `已手动选择规则：${rule.name}`);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            setCurrentRule(rule);
                            setIsRuleReady(true);
                            pushToast("success", `已手动选择规则：${rule.name}`);
                          }
                        }}
                      >
                        <div>
                          <strong>{record.name}</strong>
                          <span>{record.fileType} · {record.mode} · {new Date(record.updatedAt).toLocaleString("zh-CN")}</span>
                        </div>
                        <button
                          className={styles.iconButton}
                          title="删除规则"
                          onClick={async (event) => {
                            event.stopPropagation();
                            await fetch(`/api/mappings?id=${encodeURIComponent(record.id)}`, { method: "DELETE" });
                            await loadRules();
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className={styles.ruleSummary}>
                  <span>{isRuleReady ? "当前生效规则" : "当前规则草案"}</span>
                  <strong>{currentRule?.name ?? "未选择"}</strong>
                  <small>{isRuleReady ? "已人工确认" : "待人工确认"} · 已映射 {coverage.mapped}/{coverage.total}</small>
                </div>
              </div>
            </section>

            <section className={styles.confirmPanel}>
              <div className={styles.cardHeader}>
                <div className={styles.stepBadge}>C</div>
                <div>
                  <h2>结构快照与明细生成</h2>
                  <p>核对字段来源、模式和补充参数后生成明细；生成结果进入下方表格继续修正。</p>
                </div>
              </div>

              <div className={styles.confirmGrid}>
                <div className={styles.rulePreview}>
                  <div className={styles.previewTitle}>附件结构快照</div>
                  {fileSummary ? (
                    <pre>{JSON.stringify(fileSummary, null, 2).slice(0, 2600)}</pre>
                  ) : (
                    <div className={styles.emptyText}>请先接入一个考试附件文件。</div>
                  )}
                </div>
                <div className={styles.actionBox}>
                  {statCards.map((card) => (
                    <div key={card.label} className={styles.statCard}>
                      <card.icon size={17} />
                      <span>{card.label}</span>
                      <strong>{card.value}</strong>
                    </div>
                  ))}

                  {(isParsing || isSubmitting) && (
                    <div className={styles.progressBox}>
                      <div>
                        <strong>{isSubmitting ? "提交进度" : "生成进度"}</strong>
                        <span>{isSubmitting ? submitProgress : parseProgress.pct}%</span>
                      </div>
                      <div className={styles.progressTrack}>
                        <div
                          className={styles.progressFill}
                          style={{ width: `${isSubmitting ? submitProgress : parseProgress.pct}%` }}
                        />
                      </div>
                      {!isSubmitting && (
                        <small>{parseProgress.current}/{parseProgress.total} 条</small>
                      )}
                    </div>
                  )}

                  <button
                    className={styles.primaryButton}
                    onClick={() => void executeCurrentRule()}
                    disabled={!selectedFile || !currentRule || isParsing}
                  >
                    {isParsing ? <Loader2 className={styles.spin} size={16} /> : <PackageCheck size={16} />}
                    生成核对明细
                  </button>
                  <button className={styles.plainButton} onClick={resetToUpload}>
                    <FileUp size={16} />
                    更换文件
                  </button>
                </div>
              </div>
            </section>

            {activeView === "preview" && (
              <section className={styles.previewPanel}>
                <div className={styles.previewHeader}>
                  <div>
                    <h2>明细核对台</h2>
                    <p>共 {rows.length} 条明细，可横向滚动检查；单元格点击后直接修正。</p>
                  </div>
                  <div className={styles.previewActions}>
                    <button onClick={handleAddRow}>
                      <Plus size={16} />
                      补一行
                    </button>
                    <button onClick={handleExport} disabled={rows.length === 0}>
                      <Download size={16} />
                      导出核对表
                    </button>
                    <button
                      className={styles.primaryButtonSmall}
                      onClick={() => void handleSubmitOrders()}
                      disabled={isSubmitting || rows.length === 0}
                    >
                      <Save size={16} />
                      {isSubmitting ? "提交中..." : "写入转运明细"}
                    </button>
                  </div>
                </div>

                {llmWarnings.length > 0 && (
                  <div className={styles.warningStrip}>
                    {llmWarnings.map((warning, index) => (
                      <span key={`${warning}-${index}`}>{warning}</span>
                    ))}
                  </div>
                )}

                {issues.length > 0 && (
                  <div className={styles.issueBoard}>
                    <div className={styles.issueBoardHeader}>
                      <AlertCircle size={16} />
                      <strong>待修正清单（共 {issues.length} 处）</strong>
                    </div>
                    <div className={styles.issueList}>
                      {issues.slice(0, 80).map((issue, index) => {
                        const field = SYSTEM_FIELDS.find((item) => item.key === issue.fieldKey);
                        const sourceRow = rows[issue.rowIndex]?._originalRowIndex ?? issue.rowIndex + 1;
                        return (
                          <p key={`${issue.rowIndex}-${issue.fieldKey}-${index}`}>
                            第 {sourceRow} 行，{field?.label ?? issue.fieldKey}：{issue.msg}
                          </p>
                        );
                      })}
                      {issues.length > 80 && <p>... 还有 {issues.length - 80} 处错误未展开</p>}
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

                {submitResult && (
                  <div className={styles.summaryStrip}>
                    入库结果：成功 <strong>{submitResult.success}</strong> 条，失败{" "}
                    <strong>{submitResult.fail}</strong> 条
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {activeView === "rules" && (
          <RuleManagementPanel
            records={savedRules}
            storageWarning={rulesStorageWarning}
            onCreate={openCreateRule}
            onEdit={openEditRule}
            onCopy={openCopyRule}
            onDelete={(record) => void deleteRule(record)}
            onRefresh={() => void loadRules()}
          />
        )}

        {activeView === "history" && (
          <section className={styles.previewPanel}>
            <div className={styles.previewHeader}>
              <div>
                <h2>入库记录</h2>
                <p>从数据库读取已写入明细，支持按外部编码、收件人、门店和提交时间筛选。</p>
              </div>
            </div>
            <ShipmentHistory />
          </section>
        )}
      </main>
    </div>
  );
}
