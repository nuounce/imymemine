import { defineConfig } from 'vite';

// 심사위원이 정적 파일로 바로 열 수 있어야 한다 (SPEC §0).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
