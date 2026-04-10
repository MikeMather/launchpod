// Loads and parses backend/models.yaml
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export interface FieldDefinition {
  type: 'text' | 'email' | 'url' | 'richtext' | 'number' | 'boolean' | 'datetime' | 'select' | 'multiselect' | 'file' | 'list' | 'relation';
  required?: boolean;
  default?: any;
  max_length?: number;
  min?: number;
  max?: number;
  unique?: boolean;
  options?: string[];
}

export interface HookDefinition {
  action: 'email' | 'webhook';
  template?: string;
  to?: string;
  subject?: string;
  url?: string;
}

export interface CollectionDefinition {
  fields: Record<string, FieldDefinition>;
  access: {
    create: 'public' | 'admin';
    list: 'public' | 'admin';
    read: 'public' | 'admin';
    update: 'public' | 'admin';
    delete: 'public' | 'admin';
  };
  hooks?: {
    on_create?: HookDefinition[];
    on_update?: HookDefinition[];
  };
}

export interface ModelsConfig {
  collections: Record<string, CollectionDefinition>;
}

let cachedModels: ModelsConfig | null = null;

export function loadModels(projectRoot?: string): ModelsConfig {
  if (cachedModels) return cachedModels;

  const root = projectRoot || process.cwd();
  const modelsPath = path.join(root, 'backend', 'models.yaml');

  if (!fs.existsSync(modelsPath)) {
    cachedModels = { collections: {} };
    return cachedModels;
  }

  const content = fs.readFileSync(modelsPath, 'utf-8');
  cachedModels = YAML.parse(content) as ModelsConfig;
  return cachedModels;
}

export function clearModelsCache(): void {
  cachedModels = null;
}
