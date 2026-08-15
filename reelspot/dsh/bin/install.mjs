#!/usr/bin/env node
/*
 * dsh-reelspot installer — one-command persistent install for DSH Web.
 *
 *   npx dsh-reelspot install      # 安装（幂等）
 *   npx dsh-reelspot uninstall    # 卸载
 *
 * What it does (zero dependencies, no pnpm required):
 *   1. copies this package into <DSH_HOME>/profiles/web/node_modules/dsh-reelspot
 *      (the profile's Node resolution root — our package has no dependencies)
 *   2. inserts one loader row into <DSH_HOME>/profiles/web/cordis.patch.yml
 *      (the user patch layer, which survives dsh upgrades)
 *   3. prints the restart instruction
 */
import { existsSync, mkdirSync, readFileSync, copyFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PKG_NAME = 'dsh-reelspot'
const ROW_ID = 'reelspot'
const PATCH_BLOCK = [
  '',
  '# dsh-reelspot: ReelSpot screen recorder (https://github.com/zrt-ai-lab/open-dsh-plugins/tree/main/reelspot)',
  '- insert:',
  `    - id: ${ROW_ID}`,
  `      name: '${PKG_NAME}'`,
  '',
].join('\n')

const command = process.argv[2] || 'install'
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', 'web')
const patchFile = join(profileDir, 'cordis.patch.yml')
const targetDir = join(profileDir, 'node_modules', PKG_NAME)

function fail(message) {
  console.error(`dsh-reelspot: ${message}`)
  process.exit(1)
}

function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    const from = join(src, entry)
    const to = join(dst, entry)
    if (statSync(from).isDirectory()) copyDir(from, to)
    else copyFileSync(from, to)
  }
}

function install() {
  if (!existsSync(patchFile)) fail(`profile not found: ${patchFile} — run \`dsh web\` once first`)
  mkdirSync(targetDir, { recursive: true })
  copyFileSync(join(PKG_ROOT, 'package.json'), join(targetDir, 'package.json'))
  copyDir(join(PKG_ROOT, 'lib'), join(targetDir, 'lib'))

  const text = readFileSync(patchFile, 'utf8')
  if (text.includes(PKG_NAME)) {
    console.log('dsh-reelspot: loader row already present in cordis.patch.yml (files refreshed)')
  } else if (/\[\s*\]/.test(text)) {
    // fresh patch file: replace the empty array with our insert block
    writeFileSync(patchFile, text.replace(/\[\s*\]/, PATCH_BLOCK.trim()))
    console.log('dsh-reelspot: loader row added to cordis.patch.yml')
  } else {
    writeFileSync(patchFile, text.replace(/\s*$/, '') + '\n' + PATCH_BLOCK)
    console.log('dsh-reelspot: loader row appended to cordis.patch.yml')
  }

  console.log(`dsh-reelspot: installed into ${targetDir}`)
  console.log('dsh-reelspot: restart DSH to activate — stop the current `dsh web` process and start it again, then hard-refresh the page.')
}

function uninstall() {
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true })
    console.log(`dsh-reelspot: removed ${targetDir}`)
  }
  if (existsSync(patchFile)) {
    const text = readFileSync(patchFile, 'utf8')
    if (text.includes(PKG_NAME)) {
      const cleaned = text
        .replace(/\n?# dsh-reelspot:[^\n]*\n- insert:\n {4}- id: reelspot\n {6}name: 'dsh-reelspot'\n?/, '\n')
        .replace(/^\s*$(?![\s\S]*\S)/m, '[]') // nothing left -> back to empty array
      writeFileSync(patchFile, /\S/.test(cleaned) ? cleaned : '[]\n')
      console.log('dsh-reelspot: loader row removed from cordis.patch.yml')
    }
  }
  console.log('dsh-reelspot: uninstalled. Restart DSH to apply.')
}

if (command === 'install') install()
else if (command === 'uninstall') uninstall()
else fail(`unknown command "${command}" — use install | uninstall`)
