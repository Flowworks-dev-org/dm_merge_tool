import { defineConfig } from "vite";

// GitHub Pages (https://<org>.github.io/dm_merge_tool/) でサブパス配信されるため base を明示する。
export default defineConfig({
  base: "/dm_merge_tool/",
});
