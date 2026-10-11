import { mock } from "bun:test";
import * as solid from "solid-js/dist/solid.js";

// Use one reactive Solid runtime for both compiled JavaScript and transformed
// TSX. Bun's test resolver otherwise selects Solid's server entrypoint.
mock.module("solid-js", () => solid);
mock.module("solid-js/dist/server.js", () => solid);
