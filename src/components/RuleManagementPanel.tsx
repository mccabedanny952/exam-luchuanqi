"use client";

import {
  AlertCircle,
  Copy,
  Database,
  FileJson,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  SYSTEM_FIELDS,
  getMappingConfidence,
  normalizeRule,
  type ParsingRule,
} from "@/utils/excel-tools";
import styles from "./RuleManagementPanel.module.css";

interface SavedRuleRecord {
  id: string;
  fingerprint: string;
  name: string;
  fileType: string;
  mode: string;
  rule: string;
  updatedAt: string;
}

interface RuleManagementPanelProps {
  records: SavedRuleRecord[];
  storageWarning: string;
  onCreate: () => void;
  onEdit: (record: SavedRuleRecord, rule: ParsingRule) => void;
  onCopy: (record: SavedRuleRecord, rule: ParsingRule) => void;
  onDelete: (record: SavedRuleRecord) => void;
  onRefresh: () => void;
}

function safeParseRule(record: SavedRuleRecord): ParsingRule | null {
  try {
    return normalizeRule(JSON.parse(record.rule), SYSTEM_FIELDS.map((field) => field.label), record.name);
  } catch {
    return null;
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("zh-CN");
}

export default function RuleManagementPanel({
  records,
  storageWarning,
  onCreate,
  onEdit,
  onCopy,
  onDelete,
  onRefresh,
}: RuleManagementPanelProps) {
  const parsedRecords = records
    .map((record) => ({ record, rule: safeParseRule(record) }))
    .filter((item): item is { record: SavedRuleRecord; rule: ParsingRule } => Boolean(item.rule));
  const latestRecord = parsedRecords
    .map(({ record }) => new Date(record.updatedAt).getTime())
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => b - a)[0];

  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <div>
          <span>规则台账</span>
          <h2>解析规则校准台</h2>
          <p>沉淀不同附件结构的字段映射，AI 只负责起草，最终解析口径由人工确认。</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.secondaryButton} onClick={onRefresh}>
            <RefreshCw size={16} />
            刷新
          </button>
          <button className={styles.primaryButton} onClick={onCreate}>
            <Plus size={16} />
            新增草稿
          </button>
        </div>
      </div>

      <div className={styles.ledger}>
        <aside className={styles.ruleRail}>
          {storageWarning && (
            <div className={styles.warning}>
              <AlertCircle size={16} />
              <span>{storageWarning}</span>
            </div>
          )}
          <div className={styles.railItem}>
            <Database size={17} />
            <span>规则总数</span>
            <strong>{records.length}</strong>
          </div>
          <div className={styles.railItem}>
            <FileJson size={17} />
            <span>可解析项</span>
            <strong>{parsedRecords.length}</strong>
          </div>
          <div className={styles.railItem}>
            <Copy size={17} />
            <span>最近维护</span>
            <strong>{latestRecord ? formatDate(new Date(latestRecord).toISOString()) : "-"}</strong>
          </div>
        </aside>

        {parsedRecords.length === 0 ? (
          <div className={styles.emptyState}>
            <FileJson size={42} />
            <strong>规则台账暂无可用项</strong>
            <span>可以先创建一条通用字段映射，也可以在文件接入页让 AI 起草后写入规则库。</span>
            <button className={styles.primaryButton} onClick={onCreate}>
              <Plus size={16} />
              创建第一条草稿
            </button>
          </div>
        ) : (
          <div className={styles.ruleTableWrap}>
            <table className={styles.ruleTable}>
              <thead>
                <tr>
                  <th>规则名称 / 指纹</th>
                  <th>附件类型</th>
                  <th>模式</th>
                  <th>字段覆盖</th>
                  <th>更新时间</th>
                  <th>维护动作</th>
                </tr>
              </thead>
              <tbody>
                {parsedRecords.map(({ record, rule }) => {
                  const coverage = getMappingConfidence(rule.mapping);
                  return (
                    <tr key={record.id || record.fingerprint}>
                      <td>
                        <strong>{rule.name || record.name}</strong>
                        <span>{record.fingerprint}</span>
                      </td>
                      <td>{record.fileType}</td>
                      <td>{rule.mode}</td>
                      <td>{coverage.mapped}/{coverage.total}</td>
                      <td>{formatDate(record.updatedAt)}</td>
                      <td>
                        <div className={styles.rowActions}>
                          <button title="校准规则" onClick={() => onEdit(record, rule)}>
                            <Pencil size={14} />
                          </button>
                          <button title="复用为新规则" onClick={() => onCopy(record, rule)}>
                            <Copy size={14} />
                          </button>
                          <button title="移除规则" className={styles.dangerButton} onClick={() => onDelete(record)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
