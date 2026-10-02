/* eslint-disable @typescript-eslint/no-explicit-any */
// 조금 오래된 휴대폰 브라우저(예: iOS 17 이하 Safari, 앱 안의 웹뷰)에서 PDF.js가 쓰는 최신 기능이 없어 화면이 죽는 것을 막는다.
// react-pdf를 불러오기 전에 가장 먼저 실행되어야 한다.
const g: any = globalThis;

if (typeof (Promise as any).withResolvers !== "function") {
  (Promise as any).withResolvers = function () {
    let resolve: any;
    let reject: any;
    const promise = new Promise((a, b) => {
      resolve = a;
      reject = b;
    });
    return { promise, resolve, reject };
  };
}

if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, "at", {
    value(this: any[], n: number) {
      const i = Math.trunc(n) || 0;
      return this[i < 0 ? this.length + i : i];
    },
    writable: true,
    configurable: true,
  });
}

if (typeof (Object as any).hasOwn !== "function") {
  (Object as any).hasOwn = (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k);
}

for (const [name, fromEnd] of [["findLast", false], ["findLastIndex", true]] as const) {
  if (!(Array.prototype as any)[name]) {
    Object.defineProperty(Array.prototype, name, {
      value(this: any[], cb: (v: any, i: number, a: any[]) => unknown, thisArg?: unknown) {
        for (let i = this.length - 1; i >= 0; i--) {
          if (cb.call(thisArg, this[i], i, this)) return fromEnd ? i : this[i];
        }
        return fromEnd ? -1 : undefined;
      },
      writable: true,
      configurable: true,
    });
  }
}

if (!(Array.prototype as any).toSorted) {
  Object.defineProperty(Array.prototype, "toSorted", {
    value(this: any[], cmp?: (a: any, b: any) => number) {
      return this.slice().sort(cmp);
    },
    writable: true,
    configurable: true,
  });
}

for (const C of [Map, WeakMap] as any[]) {
  if (typeof C.prototype.getOrInsert !== "function") {
    C.prototype.getOrInsert = function (key: unknown, value: unknown) {
      if (!this.has(key)) this.set(key, value);
      return this.get(key);
    };
  }
  if (typeof C.prototype.getOrInsertComputed !== "function") {
    C.prototype.getOrInsertComputed = function (key: unknown, cb: (k: unknown) => unknown) {
      if (!this.has(key)) this.set(key, cb(key));
      return this.get(key);
    };
  }
}

if (typeof g.URL?.parse !== "function") {
  g.URL.parse = (url: string, base?: string) => {
    try {
      return new URL(url, base);
    } catch {
      return null;
    }
  };
}

if (typeof g.structuredClone !== "function") {
  g.structuredClone = (v: unknown) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
}

if (typeof (Object as any).groupBy !== "function") {
  (Object as any).groupBy = (items: Iterable<unknown>, cb: (x: unknown, i: number) => PropertyKey) => {
    const out: Record<PropertyKey, unknown[]> = Object.create(null);
    let i = 0;
    for (const x of items) (out[cb(x, i++)] ??= []).push(x);
    return out;
  };
}

// 일부 브라우저의 ReadableStream에는 for await 반복이 없다.
if (typeof g.ReadableStream !== "undefined" && !g.ReadableStream.prototype[Symbol.asyncIterator]) {
  g.ReadableStream.prototype[Symbol.asyncIterator] = async function* (this: ReadableStream) {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
  g.ReadableStream.prototype.values = g.ReadableStream.prototype[Symbol.asyncIterator];
}

export {};
