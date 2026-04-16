/**
 * Plugin loader for the Electron main process.
 * Scans <appRoot>/plugins/ for plugin folders, reads their manifest.json,
 * and provides furniture catalog entries and sprite data for each plugin.
 */

import * as fs from 'fs';
import * as path from 'path';

import { pngToSpriteData } from '../shared/assets/pngDecoder.js';
import type { FurnitureAsset } from '../shared/assets/manifestUtils.js';

// ── Plugin manifest types ────────────────────────────────────

export interface PluginFurniture {
  id: string;
  sprite: string;
  footprint: number[][];
  category: string;
  canPlaceOnWalls?: boolean;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  furniture: PluginFurniture;
  panel: string;
  panelSize?: { width: number; height: number };
}

interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
}

// ── PluginLoader class ───────────────────────────────────────

export class PluginLoader {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private appRoot: string;

  constructor(appRoot: string) {
    this.appRoot = appRoot;
  }

  /**
   * Scan <appRoot>/plugins/ for plugin folders, read each manifest.json.
   * Returns an array of all successfully loaded plugin manifests.
   */
  loadPlugins(): PluginManifest[] {
    this.plugins.clear();
    const pluginsDir = path.join(this.appRoot, 'plugins');
    if (!fs.existsSync(pluginsDir)) return [];

    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    const manifests: PluginManifest[] = [];

    for (const dir of dirs) {
      const pluginDir = path.join(pluginsDir, dir.name);
      const manifestPath = path.join(pluginDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PluginManifest;
        if (!manifest.id || !manifest.furniture || !manifest.panel || !manifest.furniture.id || !manifest.furniture.sprite) {
          console.warn(`[PluginLoader] Invalid manifest in ${dir.name}, skipping`);
          continue;
        }
        this.plugins.set(manifest.id, { manifest, dir: pluginDir });
        manifests.push(manifest);
        console.log(`[PluginLoader] Loaded plugin: ${manifest.name} (${manifest.id})`);
      } catch (err) {
        console.warn(`[PluginLoader] Error reading manifest in ${dir.name}:`, err);
      }
    }

    return manifests;
  }

  /** Returns plugin info by ID. */
  getPlugin(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id);
  }

  /** Returns the absolute path to the plugin's panel HTML file. */
  getPluginPanelPath(id: string): string | null {
    const plugin = this.plugins.get(id);
    if (!plugin) return null;
    const resolved = path.resolve(plugin.dir, plugin.manifest.panel);
    const pluginDirResolved = path.resolve(plugin.dir);
    // Prevent path traversal outside the plugin directory
    if (!resolved.startsWith(pluginDirResolved + path.sep) && resolved !== pluginDirResolved) {
      console.warn(`[PluginLoader] Path traversal blocked for plugin ${id}: ${plugin.manifest.panel}`);
      return null;
    }
    return resolved;
  }

  /**
   * Returns FurnitureAsset catalog entries for all loaded plugins.
   * These entries are compatible with the renderer's buildDynamicCatalog.
   */
  getFurnitureEntries(): FurnitureAsset[] {
    const entries: FurnitureAsset[] = [];
    for (const { manifest } of this.plugins.values()) {
      const furn = manifest.furniture;
      const footprintW = furn.footprint[0]?.[0] ?? 1;
      const footprintH = furn.footprint[0]?.[1] ?? 1;
      entries.push({
        id: furn.id,
        name: manifest.name,
        label: manifest.name,
        category: furn.category,
        file: furn.sprite,
        width: footprintW * 16,
        height: footprintH * 16,
        footprintW,
        footprintH,
        isDesk: false,
        canPlaceOnWalls: furn.canPlaceOnWalls ?? false,
        groupId: furn.id,
      });
    }
    return entries;
  }

  /** Returns the plugin ID that owns the given furniture ID, or undefined. */
  getPluginIdByFurnitureId(furnitureId: string): string | undefined {
    for (const [pluginId, { manifest }] of this.plugins) {
      if (manifest.furniture.id === furnitureId) return pluginId;
    }
    return undefined;
  }

  /**
   * Reads the plugin's sprite PNG and converts it to SpriteData format
   * (2D array of hex color strings). Returns null if the sprite cannot be read.
   */
  getSpriteData(pluginId: string): string[][] | null {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return null;

    const spritePath = path.join(plugin.dir, plugin.manifest.furniture.sprite);
    if (!fs.existsSync(spritePath)) {
      console.warn(`[PluginLoader] Sprite not found: ${spritePath}`);
      return null;
    }

    try {
      const furn = plugin.manifest.furniture;
      const footprintW = furn.footprint[0]?.[0] ?? 1;
      const footprintH = furn.footprint[0]?.[1] ?? 1;
      const width = footprintW * 16;
      const height = footprintH * 16;
      return pngToSpriteData(fs.readFileSync(spritePath), width, height);
    } catch (err) {
      console.warn(`[PluginLoader] Error reading sprite for ${pluginId}:`, err);
      return null;
    }
  }

  /**
   * Returns a map of furniture ID → SpriteData for all plugins that have valid sprites.
   */
  getAllSpriteData(): Map<string, string[][]> {
    const sprites = new Map<string, string[][]>();
    for (const [pluginId, { manifest }] of this.plugins) {
      const data = this.getSpriteData(pluginId);
      if (data) {
        sprites.set(manifest.furniture.id, data);
      }
    }
    return sprites;
  }
}
