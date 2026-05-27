import { readFileSync } from "node:fs";
import vm from "node:vm";

export function loadExtensionScripts(paths, extras = {}) {
  const sandbox = {
    atob,
    btoa,
    console,
    crypto: {
      randomUUID: () => "00000000-0000-4000-8000-000000000000",
    },
    TextDecoder,
    TextEncoder,
    clearTimeout,
    setTimeout,
    Uint8Array,
    globalThis: {},
    URL,
    ...extras,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    vm.runInContext(source, context, { filename: path });
  }

  return sandbox.NvimView;
}
