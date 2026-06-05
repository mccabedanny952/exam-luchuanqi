type MatrixLike = {
  a?: number;
  b?: number;
  c?: number;
  d?: number;
  e?: number;
  f?: number;
  m11?: number;
  m12?: number;
  m21?: number;
  m22?: number;
  m41?: number;
  m42?: number;
};

type MatrixInit = MatrixLike | number[] | Float32Array | Float64Array | string;

function toFiniteNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

class ServerPdfDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: MatrixInit) {
    if (!init) {
      return;
    }

    if (typeof init === "string") {
      return;
    }

    if (Array.isArray(init) || ArrayBuffer.isView(init)) {
      this.a = toFiniteNumber(init[0], 1);
      this.b = toFiniteNumber(init[1], 0);
      this.c = toFiniteNumber(init[2], 0);
      this.d = toFiniteNumber(init[3], 1);
      this.e = toFiniteNumber(init[4], 0);
      this.f = toFiniteNumber(init[5], 0);
      return;
    }

    this.a = toFiniteNumber(init.a ?? init.m11, 1);
    this.b = toFiniteNumber(init.b ?? init.m12, 0);
    this.c = toFiniteNumber(init.c ?? init.m21, 0);
    this.d = toFiniteNumber(init.d ?? init.m22, 1);
    this.e = toFiniteNumber(init.e ?? init.m41, 0);
    this.f = toFiniteNumber(init.f ?? init.m42, 0);
  }

  get m11() {
    return this.a;
  }

  set m11(value: number) {
    this.a = value;
  }

  get m12() {
    return this.b;
  }

  set m12(value: number) {
    this.b = value;
  }

  get m21() {
    return this.c;
  }

  set m21(value: number) {
    this.c = value;
  }

  get m22() {
    return this.d;
  }

  set m22(value: number) {
    this.d = value;
  }

  get m41() {
    return this.e;
  }

  set m41(value: number) {
    this.e = value;
  }

  get m42() {
    return this.f;
  }

  set m42(value: number) {
    this.f = value;
  }

  get is2D() {
    return true;
  }

  get isIdentity() {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
  }

  multiplySelf(other?: MatrixInit) {
    const matrix = new ServerPdfDOMMatrix(other);
    const a = this.a * matrix.a + this.c * matrix.b;
    const b = this.b * matrix.a + this.d * matrix.b;
    const c = this.a * matrix.c + this.c * matrix.d;
    const d = this.b * matrix.c + this.d * matrix.d;
    const e = this.a * matrix.e + this.c * matrix.f + this.e;
    const f = this.b * matrix.e + this.d * matrix.f + this.f;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  preMultiplySelf(other?: MatrixInit) {
    const matrix = new ServerPdfDOMMatrix(other);
    return this.setMatrix(matrix.multiplySelf(this));
  }

  translateSelf(tx = 0, ty = 0) {
    return this.multiplySelf([1, 0, 0, 1, tx, ty]);
  }

  translate(tx = 0, ty = 0) {
    return this.clone().translateSelf(tx, ty);
  }

  scaleSelf(scaleX = 1, scaleY = scaleX, scaleZ = 1, originX = 0, originY = 0) {
    void scaleZ;
    return this.translateSelf(originX, originY)
      .multiplySelf([scaleX, 0, 0, scaleY, 0, 0])
      .translateSelf(-originX, -originY);
  }

  scale(scaleX = 1, scaleY = scaleX, scaleZ = 1, originX = 0, originY = 0) {
    return this.clone().scaleSelf(scaleX, scaleY, scaleZ, originX, originY);
  }

  invertSelf() {
    const determinant = this.a * this.d - this.b * this.c;

    if (determinant === 0) {
      this.a = Number.NaN;
      this.b = Number.NaN;
      this.c = Number.NaN;
      this.d = Number.NaN;
      this.e = Number.NaN;
      this.f = Number.NaN;
      return this;
    }

    const a = this.d / determinant;
    const b = -this.b / determinant;
    const c = -this.c / determinant;
    const d = this.a / determinant;
    const e = (this.c * this.f - this.d * this.e) / determinant;
    const f = (this.b * this.e - this.a * this.f) / determinant;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  inverse() {
    return this.clone().invertSelf();
  }

  toFloat32Array() {
    return new Float32Array([this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1]);
  }

  toFloat64Array() {
    return new Float64Array(this.toFloat32Array());
  }

  toString() {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
  }

  private clone() {
    return new ServerPdfDOMMatrix(this);
  }

  private setMatrix(matrix: ServerPdfDOMMatrix) {
    this.a = matrix.a;
    this.b = matrix.b;
    this.c = matrix.c;
    this.d = matrix.d;
    this.e = matrix.e;
    this.f = matrix.f;
    return this;
  }
}

export function ensurePdfDomMatrix() {
  const scope = globalThis as unknown as {
    DOMMatrix?: unknown;
  };

  if (!scope.DOMMatrix) {
    scope.DOMMatrix = ServerPdfDOMMatrix;
  }
}
