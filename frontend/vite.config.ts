import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset paths, so the build works at any URL: GitHub Pages serves it
  // under /spatial-db-analyzer/, and hash routing means every route is this one page.
  base: "./",
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The default "threads" pool hangs on this machine: the run reports
    // "no tests" after about two minutes with worker timeout errors. Forked
    // processes are slightly slower to start and run the suite reliably.
    pool: "forks",
  },
});
