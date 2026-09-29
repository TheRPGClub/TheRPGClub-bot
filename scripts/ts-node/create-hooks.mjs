import tsNode from "ts-node";

// TypeScript 7 ships a native compiler with no JS API, so ts-node cannot load `typescript`.
// It needs the compiler before it can read tsconfig.json, so the choice has to be made here.
const TS_NODE_COMPILER = "@typescript/typescript6";

export function createHooks(options = {}) {
  return tsNode.createEsmHooks(tsNode.register({ compiler: TS_NODE_COMPILER, ...options }));
}
