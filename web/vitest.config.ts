import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
    resolve: { alias: { "@": path.resolve(__dirname) } },
    // React 17+ JSX runtime, so tests can render components (react-dom/server) in node.
    esbuild: { jsx: "automatic" },
    test: {
        include: ["lib/**/*.test.ts"],
        environment: "node",
    },
})
