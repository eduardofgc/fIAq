// @ts-check
import js from '@eslint/js'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: [
      '.svelte-kit/**',
      '**/.svelte-kit/**',
      // Sobra da versão Nuxt; o eslint.config.mjs de lá quebra o ESLint 10.
      '.nuxt/**',
      '.vercel/**',
      '**/.vercel/**',
      'build/**',
      '**/build/**',
      'dist/**',
      '**/dist/**',
      'dist-server/**',
      '**/dist-server/**',
      'node_modules/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser
      }
    }
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,svelte}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-undef': 'off',
      'svelte/no-at-html-tags': 'off',
      'svelte/no-navigation-without-resolve': 'off'
    }
  }
]
