export interface OrderSkuIdentityInput {
  externalCode?: unknown;
  skuCode?: unknown;
}

export function normalizeOrderSkuPart(value: unknown): string {
  return String(value ?? "").trim();
}

export function buildOrderSkuKey(input: OrderSkuIdentityInput): string {
  const externalCode = normalizeOrderSkuPart(input.externalCode);
  const skuCode = normalizeOrderSkuPart(input.skuCode);

  if (!externalCode || !skuCode) {
    return "";
  }

  return JSON.stringify([externalCode.toLowerCase(), skuCode.toLowerCase()]);
}

export function formatOrderSkuIdentity(input: OrderSkuIdentityInput): string {
  const externalCode = normalizeOrderSkuPart(input.externalCode) || "-";
  const skuCode = normalizeOrderSkuPart(input.skuCode) || "-";
  return `外部订单号 ${externalCode} / SKU ${skuCode}`;
}
