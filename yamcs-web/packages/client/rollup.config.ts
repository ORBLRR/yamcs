import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import sourceMaps from 'rollup-plugin-sourcemaps';
import typescript from 'rollup-plugin-typescript2';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';

export default {
  input: 'src/index.ts',
  output: [
    { file: 'dist/yamcs-client.umd.js', name: 'yamcs-client', format: 'umd', sourcemap: true },
    { file: 'dist/yamcs-client.es5.js', format: 'es', sourcemap: true },
  ],
  watch: {
    include: 'src/**',
  },
  plugins: [
    // Add peerDependencies to its bundle's externals
    peerDepsExternal(),

    // Compile TypeScript files
    typescript({ useTsconfigDeclarationDir: true }),

    // Allow bundling cjs modules (unlike webpack, rollup doesn't understand cjs)
    commonjs(),

    // Allow node_modules resolution, so you can use 'external' to control
    // which external modules to include in the bundle
    // https://github.com/rollup/rollup-plugin-node-resolve#usage
    resolve(),

    // Resolve source maps to the original source
    sourceMaps(),
  ],
};
