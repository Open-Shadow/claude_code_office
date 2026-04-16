/**
 * Asset loader for the Electron main process.
 * Mirrors pixel-agents/src/assetLoader.ts but with all VS Code dependencies removed.
 */

import * as fs from 'fs';
import * as path from 'path';

import { CHAR_COUNT } from '../shared/assets/constants.js';
import type { FurnitureAsset, FurnitureManifest, InheritedProps, ManifestGroup } from '../shared/assets/manifestUtils.js';
import { flattenManifest } from '../shared/assets/manifestUtils.js';
import {
  decodeCharacterPng,
  decodeFloorPng,
  parseWallPng,
  pngToSpriteData,
} from '../shared/assets/pngDecoder.js';
import type { CharacterDirectionSprites } from '../shared/assets/types.js';
import { LAYOUT_REVISION_KEY } from './constants.js';

export type { FurnitureAsset };

export interface LoadedAssets {
  catalog: FurnitureAsset[];
  sprites: Map<string, string[][]>;
}

export interface LoadedCharacterSprites {
  characters: CharacterDirectionSprites[];
}

export interface LoadedFloorTiles {
  sprites: string[][][];
}

export interface LoadedWallTiles {
  sets: string[][][][];
}

// ── Furniture ────────────────────────────────────────────────

export async function loadFurnitureAssets(assetsRoot: string): Promise<LoadedAssets | null> {
  try {
    const furnitureDir = path.join(assetsRoot, 'assets', 'furniture');
    if (!fs.existsSync(furnitureDir)) return null;

    const entries = fs.readdirSync(furnitureDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    if (dirs.length === 0) return null;

    const catalog: FurnitureAsset[] = [];
    const sprites = new Map<string, string[][]>();

    for (const dir of dirs) {
      const itemDir = path.join(furnitureDir, dir.name);
      const manifestPath = path.join(itemDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as FurnitureManifest;
        const inherited: InheritedProps = {
          groupId: manifest.id,
          name: manifest.name,
          category: manifest.category,
          canPlaceOnWalls: manifest.canPlaceOnWalls,
          canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
          backgroundTiles: manifest.backgroundTiles,
        };

        let assets: FurnitureAsset[];
        if (manifest.type === 'asset') {
          assets = [{
            id: manifest.id,
            name: manifest.name,
            label: manifest.name,
            category: manifest.category,
            file: manifest.file ?? `${manifest.id}.png`,
            width: manifest.width!,
            height: manifest.height!,
            footprintW: manifest.footprintW!,
            footprintH: manifest.footprintH!,
            isDesk: manifest.category === 'desks',
            canPlaceOnWalls: manifest.canPlaceOnWalls,
            canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
            backgroundTiles: manifest.backgroundTiles,
            groupId: manifest.id,
          }];
        } else {
          if (manifest.rotationScheme) inherited.rotationScheme = manifest.rotationScheme;
          const rootGroup: ManifestGroup = {
            type: 'group',
            groupType: manifest.groupType as 'rotation' | 'state' | 'animation',
            rotationScheme: manifest.rotationScheme,
            members: manifest.members!,
          };
          assets = flattenManifest(rootGroup, inherited);
        }

        for (const asset of assets) {
          const assetPath = path.join(itemDir, asset.file);
          const resolvedAsset = path.resolve(assetPath);
          const resolvedDir = path.resolve(itemDir);
          if (!resolvedAsset.startsWith(resolvedDir + path.sep) && resolvedAsset !== resolvedDir) continue;
          if (!fs.existsSync(assetPath)) continue;
          try {
            sprites.set(asset.id, pngToSpriteData(fs.readFileSync(assetPath), asset.width, asset.height));
          } catch { /* skip bad PNG */ }
        }
        catalog.push(...assets);
      } catch { /* skip bad manifest */ }
    }

    return { catalog, sprites };
  } catch (err) {
    console.error('[AssetLoader] Error loading furniture:', err);
    return null;
  }
}

// ── Default layout ───────────────────────────────────────────

export function loadDefaultLayout(assetsRoot: string): Record<string, unknown> | null {
  const assetsDir = path.join(assetsRoot, 'assets');
  try {
    let bestRevision = 0;
    let bestPath: string | null = null;
    if (fs.existsSync(assetsDir)) {
      for (const file of fs.readdirSync(assetsDir)) {
        const match = /^default-layout-(\d+)\.json$/.exec(file);
        if (match) {
          const rev = parseInt(match[1], 10);
          if (rev > bestRevision) { bestRevision = rev; bestPath = path.join(assetsDir, file); }
        }
      }
    }
    if (!bestPath) {
      const fallback = path.join(assetsDir, 'default-layout.json');
      if (fs.existsSync(fallback)) bestPath = fallback;
    }
    if (!bestPath) return null;
    const layout = JSON.parse(fs.readFileSync(bestPath, 'utf-8')) as Record<string, unknown>;
    if (bestRevision > 0 && !layout[LAYOUT_REVISION_KEY]) layout[LAYOUT_REVISION_KEY] = bestRevision;
    return layout;
  } catch (err) {
    console.error('[AssetLoader] Error loading default layout:', err);
    return null;
  }
}

// ── Wall tiles ───────────────────────────────────────────────

export async function loadWallTiles(assetsRoot: string): Promise<LoadedWallTiles | null> {
  try {
    const wallsDir = path.join(assetsRoot, 'assets', 'walls');
    if (!fs.existsSync(wallsDir)) return null;
    const wallFiles: { index: number; filename: string }[] = [];
    for (const entry of fs.readdirSync(wallsDir)) {
      const match = /^wall_(\d+)\.png$/i.exec(entry);
      if (match) wallFiles.push({ index: parseInt(match[1], 10), filename: entry });
    }
    if (wallFiles.length === 0) return null;
    wallFiles.sort((a, b) => a.index - b.index);
    const sets: string[][][][] = wallFiles.map(({ filename }) =>
      parseWallPng(fs.readFileSync(path.join(wallsDir, filename)))
    );
    return { sets };
  } catch (err) {
    console.error('[AssetLoader] Error loading wall tiles:', err);
    return null;
  }
}

// ── Floor tiles ──────────────────────────────────────────────

export async function loadFloorTiles(assetsRoot: string): Promise<LoadedFloorTiles | null> {
  try {
    const floorsDir = path.join(assetsRoot, 'assets', 'floors');
    if (!fs.existsSync(floorsDir)) return null;
    const floorFiles: { index: number; filename: string }[] = [];
    for (const entry of fs.readdirSync(floorsDir)) {
      const match = /^floor_(\d+)\.png$/i.exec(entry);
      if (match) floorFiles.push({ index: parseInt(match[1], 10), filename: entry });
    }
    if (floorFiles.length === 0) return null;
    floorFiles.sort((a, b) => a.index - b.index);
    const sprites: string[][][] = floorFiles.map(({ filename }) =>
      decodeFloorPng(fs.readFileSync(path.join(floorsDir, filename)))
    );
    return { sprites };
  } catch (err) {
    console.error('[AssetLoader] Error loading floor tiles:', err);
    return null;
  }
}

// ── Character sprites ────────────────────────────────────────

export async function loadCharacterSprites(assetsRoot: string): Promise<LoadedCharacterSprites | null> {
  try {
    const charDir = path.join(assetsRoot, 'assets', 'characters');
    const characters: CharacterDirectionSprites[] = [];
    for (let ci = 0; ci < CHAR_COUNT; ci++) {
      const filePath = path.join(charDir, `char_${ci}.png`);
      if (!fs.existsSync(filePath)) return null;
      characters.push(decodeCharacterPng(fs.readFileSync(filePath)));
    }
    return { characters };
  } catch (err) {
    console.error('[AssetLoader] Error loading character sprites:', err);
    return null;
  }
}
