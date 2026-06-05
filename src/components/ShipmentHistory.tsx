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

export default function ShipmentHistory() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const take = 20;

  const fetchOrders = useCallback(async (resetPage = false) => {
    setLoading(true);
    const nextPage = resetPage ? 0 : page;
    if (resetPage) {
      setPage(0);
    }

    const params = new URLSearchParams({
      skip: String(nextPage * take),
      take: String(take),
      search,
    });
    if (dateFrom) {
      params.set("dateFrom", dateFrom);
    }
    if (dateTo) {
      params.set("dateTo", dateTo);
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
  }, [dateFrom, dateTo, page, search]);

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
          void fetchOrders(true);
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
        <label>
          <span>提交时间（起）</span>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          <span>提交时间（止）</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
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
              setPage(0);
              setTimeout(() => void fetchOrders(true), 0);
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
