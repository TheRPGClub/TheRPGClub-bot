import { createHooks } from "./create-hooks.mjs";

export const { resolve, load } = createHooks({ transpileOnly: true });
