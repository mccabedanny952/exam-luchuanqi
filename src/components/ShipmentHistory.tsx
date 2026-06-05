"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./ShipmentHistory.module.css";

interface OrderRecord {
  id: string;
  externalCode: string | null;
  storeName: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
  receiverAddress: string | null;
  skuCode: string;
  skuName: string;
  skuQuantity: number;
  skuSpec: string | null;
  createdAt: string;
}

type DateField = "from" | "to";

interface HistoryFilters {
  search: string;
  dateFrom: string;
  dateTo: string;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCalendarDays(value: string): string[] {
  const base = value ? new Date(`${value}T00:00:00`) : new Date();
  const year = base.getFullYear();
  const month = base.getMonth();
  const firstDay = new Date(year, month, 1);
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return toDateInputValue(day);
  });
}

export default function ShipmentHistory() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<HistoryFilters>({
    search: "",
    dateFrom: "",
    dateTo: "",
  });
  const [openCalendar, setOpenCalendar] = useState<DateField | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const take = 20;

  const activeDateValue = openCalendar === "from" ? dateFrom : openCalendar === "to" ? dateTo : "";
  const calendarDays = openCalendar ? getCalendarDays(activeDateValue) : [];

  const selectDate = (value: string) => {
    if (openCalendar === "from") {
      setDateFrom(value);
    }
    if (openCalendar === "to") {
      setDateTo(value);
    }
    setOpenCalendar(null);
  };

  const fetchOrders = useCallback(async (resetPage = false) => {
    setLoading(true);
    const nextPage = resetPage ? 0 : page;
    if (resetPage) {
      setPage(0);
    }

    const params = new URLSearchParams({
      skip: String(nextPage * take),
      take: String(take),
      search: appliedFilters.search,
    });
    if (appliedFilters.dateFrom) {
      params.set("dateFrom", appliedFilters.dateFrom);
    }
    if (appliedFilters.dateTo) {
      params.set("dateTo", appliedFilters.dateTo);
    }

    try {
      const response = await fetch(`/api/orders?${params.toString()}`);
      const payload = await response.json();
      setOrders(payload.data || []);
      setTotal(payload.total || 0);
    } catch {
      setOrders([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchOrders();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [fetchOrders]);

  return (
    <div className={styles.stack}>
      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          setPage(0);
          setOpenCalendar(null);
          setAppliedFilters({ search, dateFrom, dateTo });
        }}
      >
        <label>
          <span>关键词</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="外部编码 / 收件人 / 门店 / SKU"
          />
        </label>
        <label className={styles.dateField}>
          <span>提交时间（起）</span>
          <input
            readOnly
            type="text"
            placeholder="选择开始日期"
            value={dateFrom}
            onClick={() => setOpenCalendar(openCalendar === "from" ? null : "from")}
          />
        </label>
        <label className={styles.dateField}>
          <span>提交时间（止）</span>
          <input
            readOnly
            type="text"
            placeholder="选择结束日期"
            value={dateTo}
            onClick={() => setOpenCalendar(openCalendar === "to" ? null : "to")}
          />
        </label>
        {openCalendar && (
          <div className={styles.calendarPanel}>
            <div className={styles.calendarHeader}>
              <strong>{openCalendar === "from" ? "选择开始日期" : "选择结束日期"}</strong>
              <button type="button" onClick={() => setOpenCalendar(null)}>
                关闭
              </button>
            </div>
            <div className={styles.weekRow}>
              {["日", "一", "二", "三", "四", "五", "六"].map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <div className={styles.dayGrid}>
              {calendarDays.map((value) => {
                const selected = value === activeDateValue;
                const muted = new Date(`${value}T00:00:00`).getMonth() !== new Date(`${calendarDays[14]}T00:00:00`).getMonth();
                return (
                  <button
                    key={value}
                    data-date={value}
                    aria-label={`选择日期 ${value}`}
                    type="button"
                    className={`${styles.dayButton} ${selected ? styles.dayButton_active : ""} ${muted ? styles.dayButton_muted : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectDate(value)}
                  >
                    {Number(value.slice(8, 10))}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className={styles.filterActions}>
          <button type="submit" className={styles.primaryButton}>
            搜索
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              setSearch("");
              setDateFrom("");
              setDateTo("");
              setAppliedFilters({ search: "", dateFrom: "", dateTo: "" });
              setOpenCalendar(null);
              setPage(0);
            }}
          >
            重置
          </button>
        </div>
      </form>

      <div className={styles.tableCard}>
        {loading ? (
          <div className={styles.emptyState}>正在读取数据库中的入库记录...</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>外部编码</th>
                  <th>收货门店</th>
                  <th>收件人</th>
                  <th>收件电话</th>
                  <th>收件地址</th>
                  <th>SKU编码</th>
                  <th>SKU名称</th>
                  <th>数量</th>
                  <th>规格</th>
                  <th>提交时间</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={10} className={styles.emptyCell}>
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id}>
                      <td>{order.externalCode || "-"}</td>
                      <td>{order.storeName || "-"}</td>
                      <td>{order.receiverName || "-"}</td>
                      <td>{order.receiverPhone || "-"}</td>
                      <td>{order.receiverAddress || "-"}</td>
                      <td>{order.skuCode}</td>
                      <td>{order.skuName}</td>
                      <td>{order.skuQuantity}</td>
                      <td>{order.skuSpec || "-"}</td>
                      <td>{new Date(order.createdAt).toLocaleString("zh-CN")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={styles.pager}>
        <span>共 {total} 条记录</span>
        <div className={styles.pagerButtons}>
          <button disabled={page === 0} onClick={() => setPage((current) => current - 1)}>
            上一页
          </button>
          <strong>第 {page + 1} 页</strong>
          <button
            disabled={(page + 1) * take >= total}
            onClick={() => setPage((current) => current + 1)}
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
